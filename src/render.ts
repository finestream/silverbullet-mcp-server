// The render path (docs/architecture.md, section 5; docs/security.md,
// section 12): render-note and screenshot-note over SilverBullet's Runtime
// API, as the calling user, so that the runtime is that user's for that
// space. One queue per (user, space): renders and screenshots on one runtime
// run one at a time, because the `_CTX` shim and navigate-then-capture are
// not concurrent-safe. A global cap bounds the Runtime API calls in flight,
// and every call has a deadline. Before a render, the index of the runtime is
// checked for the pages written through the server since that runtime last
// confirmed them; after a bounded wait the fallback is `system.reboot()` on
// that runtime, which re-indexes the space. The render script shadows the
// writing functions of `space` for the call; that is best-effort, documented
// as such: what makes rendering safe is that pages hold no code. What a
// render loaded is read from the browser's resource timing (the render check
// of docs/security.md, section 12): every file the client fetched from the
// space while the page was expanded or shown, judged against the caller's
// `r` rights before anything is returned.

import { RuntimeError, type SilverBullet } from "./sb.ts";
import type { Credential } from "./credentials.ts";
import type { State, RuntimeInfo } from "./state.ts";
import type { Config } from "./config.ts";
import type { Log } from "./log.ts";

export type RenderDeps = { sb: SilverBullet; state: State; config: Config; log: Log };

export class RenderTimeout extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderTimeout";
  }
}

/** A Lua long-bracket string literal that cannot be closed by its content. */
export function luaString(s: string): string {
  let level = 0;
  while (s.includes("]" + "=".repeat(level) + "]")) level++;
  const eq = "=".repeat(level);
  return `[${eq}[\n${s}]${eq}]`; // Lua drops a newline right after the opening bracket
}

/**
 * The render check (docs/security.md, section 12). The headless client reads every page and file
 * over HTTP, so the browser's resource timing holds what a render loaded. Measured on 2.12.1:
 * there is no service worker and no page cache (a second navigation fetches again); navigating
 * to the page already shown re-fetches the page but not its transclusions, so a screenshot
 * leaves the page first; fetches of a page one leaves can land after the navigation returned,
 * so the runtime is parked on a blank page between screenshots.
 */
export const LOADS_BUFFER = 5000;
/** A page that does not exist, shown between screenshots; SilverBullet creates nothing for it (measured on 2.12.1). */
export const BLANK_PAGE = "_sbmcp/blank";
const LOADS_BEGIN_JS = `(() => { const p = performance; p.setResourceTimingBufferSize(${LOADS_BUFFER}); p.clearResourceTimings(); window.__sbmcpFull = false; p.onresourcetimingbufferfull = () => { window.__sbmcpFull = true; }; return true; })()`;
const LOADS_READ_JS = `(() => { const es = performance.getEntriesByType("resource"); return JSON.stringify({full: window.__sbmcpFull === true, urls: es.map((e) => e.name), initiators: es.map((e) => e.initiatorType)}); })()`;
const LOADS_BEGIN = `js.window.eval(${luaString(LOADS_BEGIN_JS)})`;
const LOADS_READ = `js.window.eval(${luaString(LOADS_READ_JS)})`;

/**
 * What a render loaded: the files of the space the client fetched, in order and without repeats, and whether the browser dropped entries.
 * `presented`: those of them that the document fetched to show them (a stylesheet, a font, an image), not the client's own reads (`fetch`).
 */
export type Loads = { files: string[]; full: boolean; entries: number; presented?: string[] };

/** Resource-timing initiators of the client's own reads; every other initiator is the document fetching something it shows. */
const CLIENT_READS = new Set(["fetch", "xmlhttprequest", "beacon"]);

/** The path of a file of `space` behind a resource-timing URL, decoded; null for anything else (the listing, another origin's resource, the blank page). */
export function loadedPath(url: string, space: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const prefix = `/${space}/.fs/`;
  if (!pathname.startsWith(prefix) || pathname.length === prefix.length) return null;
  let path: string;
  try {
    path = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null;
  }
  return path === `${BLANK_PAGE}.md` ? null : path;
}

/** The loads as the read script returns them (a JSON string) turned into paths of the space. */
export function parseLoads(raw: unknown, space: string): Loads {
  if (typeof raw !== "string") throw new Error("the runtime returned no resource timing");
  const json = JSON.parse(raw) as { full?: unknown; urls?: unknown; initiators?: unknown };
  const urls = Array.isArray(json.urls) ? json.urls.filter((u): u is string => typeof u === "string") : [];
  const files = [...new Set(urls.map((u) => loadedPath(u, space)).filter((p): p is string => p !== null))];
  const out: Loads = { files, full: json.full === true, entries: urls.length };
  const initiators = json.initiators;
  if (Array.isArray(initiators) && initiators.length === urls.length) {
    const presented = urls.filter((u, i) => !CLIENT_READS.has(String(initiators[i]))).map((u) => loadedPath(u, space));
    out.presented = [...new Set(presented.filter((p): p is string => p !== null))];
  }
  return out;
}

export type LoadsJudgement = {
  /** Why the loads cannot be trusted, or null: the check then fails closed (docs/security.md, section 12). */
  blind: string | null;
  /** The files loaded that the caller may not read, the rendered page itself excepted (`x` suffices for it). */
  denied: string[];
};

/**
 * Judges what a render of `file` loaded against `mayRead`. Blind when the rendered page's own read
 * is missing (the client no longer reads over HTTP, or not from `/.fs/`) or the buffer overflowed.
 */
export function judgeLoads(loads: Loads, file: string, mayRead: (file: string) => boolean): LoadsJudgement {
  let blind: string | null = null;
  if (loads.full) blind = `the browser dropped entries: more than ${LOADS_BUFFER} resources were loaded`;
  else if (!loads.files.includes(file)) blind = `the page's own read is missing from the browser's resource timing (${loads.entries} entries)`;
  return { blind, denied: loads.files.filter((f) => f !== file && !mayRead(f)) };
}

/** Called with what a render loaded before anything is returned; throws to refuse. */
export type VerifyLoads = (loads: Loads) => void;

/**
 * Files a screenshot shows without their being page content (docs/security.md, section 12): a
 * denied one is redacted in the client instead of refusing the screenshot. Every other file
 * type, pages among them, refuses as before.
 */
export type AssetKind = "font" | "style" | "image";
const ASSET_KINDS: Record<string, AssetKind> = {
  woff: "font",
  woff2: "font",
  ttf: "font",
  otf: "font",
  css: "style",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  svg: "image",
  bmp: "image",
  ico: "image",
};

export function assetKind(file: string): AssetKind | null {
  const m = /\.([^./]+)$/.exec(file);
  return m ? (ASSET_KINDS[m[1].toLowerCase()] ?? null) : null;
}

/**
 * What the shown document uses of the space, read from the document itself rather than from
 * the resource timing: an image the browser shows again from its memory cache leaves no new
 * timing entry (measured on 2.12.1). `via`: `sheet` (a stylesheet or an `@import`), `font` (an
 * `@font-face` source), `css` (a `url()` in a declaration or a `style` attribute), `element`
 * (an image the redaction replaces: `img`, `source`, a `video` poster, an image input, an SVG
 * `image`), `fixed` (a use the redaction cannot reach: a frame, object or embed, `audio`, `track`,
 * a `video` source, a `link` other than a stylesheet, and anything inside a frame or a shadow root).
 */
export type Use = { path: string; via: "sheet" | "font" | "css" | "element" | "fixed" };
/** `blob`: a `blob:` URL is shown, whose source the server cannot tell; `canvas`: the page has a canvas, whose drawing it cannot tell either. */
export type Uses = { uses: Use[]; blob: boolean; canvas: boolean };
export type Redactions = Record<AssetKind, string[]>;

/** What one look at the shown page found: the cumulative resource timing, the uses, and what earlier rounds redacted. */
export type Seen = { loads: Loads; uses: Uses; redacted: ReadonlySet<string> };

export type ScreenJudgement = {
  blind: string | null;
  /** Denied files that cannot be redacted: pages and other files, assets the redaction cannot reach, and assets loaded but neither in use nor redacted. */
  denied: string[];
  /** Denied fonts, stylesheets and images the document uses, to be redacted. */
  redact: Redactions;
};

/**
 * Judges a screenshot. The resource timing says what was fetched since the navigation, the uses
 * what the document shows now. A denied asset the document fetched to show it (`presented`) must
 * either be in use (and is then redacted), or have been redacted; one that is neither shows
 * in a way the inventory cannot see, and refuses. A denied asset loaded any other way (the
 * client's own `fetch`) refuses, as every denied load does for `render-note`. Without the
 * initiators the check is blind.
 */
export function judgeScreen(seen: Seen, file: string, mayRead: (file: string) => boolean): ScreenJudgement {
  const { blind, denied: loaded } = judgeLoads(seen.loads, file, mayRead);
  const redact: Redactions = { font: [], style: [], image: [] };
  const denied = new Set<string>();
  const inUse = new Set<string>();
  for (const u of seen.uses.uses) {
    if (u.path === file || mayRead(u.path)) continue;
    const kind = assetKind(u.path);
    if (!kind || u.via === "fixed") denied.add(u.path);
    else if (!redact[kind].includes(u.path)) redact[kind].push(u.path);
    inUse.add(u.path);
  }
  const presented = new Set(seen.loads.presented ?? []);
  for (const f of loaded) {
    if (!assetKind(f) || !presented.has(f)) denied.add(f);
    else if (!inUse.has(f) && !seen.redacted.has(f)) denied.add(f);
  }
  const why =
    blind ??
    (seen.loads.presented === undefined ? "the browser's resource timing gave no initiators, so what the page fetched to show it cannot be told" : null) ??
    (seen.uses.blob ? "the page shows a blob: URL, whose source cannot be told" : null) ??
    (seen.uses.canvas ? "the page shows a canvas, whose drawing cannot be told" : null);
  return { blind: why, denied: [...denied], redact };
}

/**
 * Called with what a screenshot shows, before the capture (after each redaction round) and after
 * it; throws to refuse and returns what to redact. `last`: no redaction round follows, so
 * anything left to redact refuses too.
 */
export type VerifyScreen = (seen: Seen, last: boolean) => Redactions;

/** Redaction rounds before the capture; a page whose redaction has not settled by then is refused. */
export const REDACT_ROUNDS = 3;

/**
 * The client side of the inventory and the redaction, evaluated in the runtime's window. Its
 * changes are logged in `window.__sbmcpUndo` and undone by `undo()` after the screenshot and,
 * for a log left behind, before the next one. Stylesheets are walked through the CSSOM, imports
 * and grouping rules included; Chrome serialises the strings of `image-set()` as `url()`
 * (measured on 2.12.1), so `url()` is every reference a declaration can hold.
 */
const CLIENT_LIB = String.raw`const sbmcp = (() => {
  const W = window;
  const PLACEHOLDER = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="48"><rect width="100%" height="100%" fill="#eee" stroke="#999"/><text x="50%" y="50%" font-family="sans-serif" font-size="13" text-anchor="middle" dominant-baseline="middle" fill="#444">Image withheld: no read permission</text></svg>');
  const URL_RE = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)\s"']*))\s*\)/g;
  const abs = (u, base) => { try { return new URL(u, base).href; } catch { return null; } };
  const key = (href) => { try { return decodeURIComponent(new URL(href).pathname); } catch { return null; } };
  const urls = (value, base) => [...String(value).matchAll(URL_RE)].map((m) => ({ text: m[0], href: abs(m[1] ?? m[2] ?? m[3] ?? "", base) })).filter((x) => x.href);
  const log = () => (W.__sbmcpUndo = W.__sbmcpUndo || []);
  const sheetsOf = (doc) => [...doc.styleSheets, ...(doc.adoptedStyleSheets || [])];
  /** Every rule of a sheet, depth first, with the base its URLs resolve against; imports followed. */
  const rules = (sheet, out, seen) => {
    if (!sheet || sheet.disabled || seen.has(sheet)) return out;
    seen.add(sheet);
    let list;
    try { list = sheet.cssRules; } catch { out.push({ opaque: sheet }); return out; }
    const base = sheet.href || document.baseURI;
    const walk = (rs) => {
      for (const r of rs) {
        out.push({ rule: r, sheet: r.parentStyleSheet, base });
        if (r.styleSheet) rules(r.styleSheet, out, seen);
        if (r.cssRules) walk(r.cssRules);
      }
    };
    walk(list);
    return out;
  };
  const allRules = (doc) => { const out = []; const seen = new Set(); for (const s of sheetsOf(doc)) rules(s, out, seen); return out; };
  const declarations = (style) => { const out = []; if (!style) return out; for (let i = 0; i < style.length; i++) { const p = style[i]; out.push({ p, v: style.getPropertyValue(p), prio: style.getPropertyPriority(p) }); } return out; };
  const srcset = (v) => String(v || "").split(",").map((c) => c.trim().split(/\s+/)[0]).filter(Boolean);
  // The elements whose images the redaction replaces, and those it cannot reach.
  const IMAGE_ATTRS = [["img", ["src"], ["srcset"]], ["source", ["src"], ["srcset"]], ["video", ["poster"], []], ["input", ["src"], []]];
  const FIXED_ATTRS = [["iframe", "src"], ["frame", "src"], ["object", "data"], ["embed", "src"], ["audio", "src"], ["track", "src"], ["video", "src"], ["link", "href"]];
  const svgHref = (el) => el.getAttribute("href") || el.getAttributeNS("http://www.w3.org/1999/xlink", "href");

  function inventory(doc = document, fixed = false) {
    const uses = [];
    let blob = false, canvas = false;
    const add = (href, via) => { if (!href) return; if (href.startsWith("blob:")) blob = true; else uses.push({ u: href, via: fixed ? "fixed" : via }); };
    const inner = (root) => { const r = inventory(root, true); uses.push(...r.uses); blob = blob || r.blob; canvas = canvas || r.canvas; };
    for (const s of sheetsOf(doc)) if (!s.disabled && s.href) add(s.href, "sheet");
    for (const x of allRules(doc)) {
      if (x.opaque) { if (x.opaque.href) add(x.opaque.href, "sheet"); continue; }
      const r = x.rule;
      if (r.styleSheet !== undefined && r.href) add(abs(r.href, x.base), "sheet");
      const isFont = r.constructor && r.constructor.name === "CSSFontFaceRule";
      for (const d of declarations(r.style)) for (const u of urls(d.v, x.base)) add(u.href, isFont ? "font" : "css");
    }
    for (const el of doc.querySelectorAll("*")) {
      if (el.hasAttribute("style")) for (const d of declarations(el.style)) for (const u of urls(d.v, doc.baseURI)) add(u.href, "css");
      const tag = el.localName;
      if (tag === "canvas") canvas = true;
      for (const [t, attrs, sets] of IMAGE_ATTRS) {
        if (tag !== t) continue;
        for (const a of attrs) if (el.getAttribute(a)) add(abs(el.getAttribute(a), doc.baseURI), "element");
        for (const a of sets) for (const c of srcset(el.getAttribute(a))) add(abs(c, doc.baseURI), "element");
        if (t === "img" && el.currentSrc) add(el.currentSrc, "element");
      }
      if (el.namespaceURI === "http://www.w3.org/2000/svg" && svgHref(el)) add(abs(svgHref(el), doc.baseURI), "element");
      for (const [t, a] of FIXED_ATTRS) {
        if (tag !== t || !el.getAttribute(a)) continue;
        if (t === "link" && /\bstylesheet\b/i.test(el.rel || "")) continue;
        add(abs(el.getAttribute(a), doc.baseURI), "fixed");
      }
      if (el.shadowRoot) inner(el.shadowRoot);
      if ((tag === "iframe" || tag === "frame") && el.contentDocument) inner(el.contentDocument);
    }
    return { uses, blob, canvas };
  }

  /** denied: absolute paths ("/space/.fs/file") per kind. Returns the URLs redacted and those withdrawn with a sheet turned off. */
  function redact(denied) {
    const deny = (kind) => new Set(denied[kind] || []);
    const fonts = deny("font"), styles = deny("style"), images = deny("image");
    const hit = (set, href) => href && set.has(key(href));
    const acted = [], withdrawn = [];
    let stylesOff = false;
    const off = (sheet) => {
      if (!sheet || sheet.disabled) return;
      for (const x of rules(sheet, [], new Set())) { if (x.opaque) continue; if (x.rule.href) withdrawn.push(abs(x.rule.href, x.base)); for (const d of declarations(x.rule.style)) for (const u of urls(d.v, x.base)) withdrawn.push(u.href); }
      if (sheet.href) withdrawn.push(sheet.href);
      sheet.disabled = true;
      log().push(() => { sheet.disabled = false; });
    };
    const spaceStylesOff = () => { stylesOff = true; for (const el of document.querySelectorAll("#custom-styles style, #custom-styles link")) off(el.sheet); };
    const treeHas = (sheet, set) => hit(set, sheet.href) || rules(sheet, [], new Set()).some((x) => (x.opaque ? hit(set, x.opaque.href) : x.rule.href && hit(set, abs(x.rule.href, x.base))));
    // A denied stylesheet: space styles off, and any other sheet that loads it.
    if (styles.size) {
      spaceStylesOff();
      for (const s of sheetsOf(document)) if (!s.disabled && treeHas(s, styles)) off(s);
    }
    // A denied font: its @font-face rules removed; a sheet whose rules cannot be changed is turned off, and with it the space styles.
    if (fonts.size) {
      const remove = [];
      for (const x of allRules(document)) {
        if (x.opaque || x.rule.constructor.name !== "CSSFontFaceRule") continue;
        const found = urls(x.rule.style.getPropertyValue("src"), x.base).filter((u) => hit(fonts, u.href));
        if (found.length) remove.push({ x, found });
      }
      for (const { x, found } of remove.reverse()) {
        const parent = x.rule.parentRule || x.sheet;
        const index = [...parent.cssRules].indexOf(x.rule);
        const text = x.rule.cssText;
        try {
          parent.deleteRule(index);
          log().push(() => parent.insertRule(text, index));
          acted.push(...found.map((u) => u.href));
        } catch {
          spaceStylesOff();
          off(x.sheet);
        }
      }
    }
    // A denied image: replaced by the placeholder wherever it is referenced.
    if (images.size) {
      const swap = (style, base) => {
        for (const d of declarations(style)) {
          const found = urls(d.v, base).filter((u) => hit(images, u.href));
          if (!found.length) continue;
          let v = d.v;
          for (const u of found) v = v.split(u.text).join('url("' + PLACEHOLDER + '")');
          style.setProperty(d.p, v, d.prio);
          log().push(() => style.setProperty(d.p, d.v, d.prio));
          acted.push(...found.map((u) => u.href));
        }
      };
      for (const x of allRules(document)) if (!x.opaque && x.rule.style) swap(x.rule.style, x.base);
      const setAttr = (el, a, v) => { const old = el.getAttribute(a); el.setAttribute(a, v); log().push(() => (old === null ? el.removeAttribute(a) : el.setAttribute(a, old))); };
      const dropAttr = (el, a) => { const old = el.getAttribute(a); if (old === null) return; el.removeAttribute(a); log().push(() => el.setAttribute(a, old)); };
      for (const el of document.querySelectorAll("*")) {
        if (el.hasAttribute("style")) swap(el.style, document.baseURI);
        const tag = el.localName;
        if (tag === "img" || tag === "source") {
          const set = srcset(el.getAttribute("srcset")).map((c) => abs(c, document.baseURI));
          const src = el.getAttribute("src") && abs(el.getAttribute("src"), document.baseURI);
          const bad = [src, el.currentSrc, ...set].filter((h) => hit(images, h));
          if (!bad.length) continue;
          dropAttr(el, "srcset");
          if (tag === "img") { setAttr(el, "src", PLACEHOLDER); setAttr(el, "alt", "Image withheld: no read permission"); }
          else dropAttr(el, "src");
          acted.push(...bad);
        } else if (tag === "video" || tag === "input") {
          const a = tag === "video" ? "poster" : "src";
          const h = el.getAttribute(a) && abs(el.getAttribute(a), document.baseURI);
          if (hit(images, h)) { setAttr(el, a, PLACEHOLDER); acted.push(h); }
        } else if (el.namespaceURI === "http://www.w3.org/2000/svg" && svgHref(el)) {
          const h = abs(svgHref(el), document.baseURI);
          if (hit(images, h)) { dropAttr(el, "xlink:href"); setAttr(el, "href", PLACEHOLDER); acted.push(h); }
        }
      }
    }
    return { acted, withdrawn, stylesOff };
  }

  /** Undoes every logged change, last first; returns how many. */
  function undo() {
    const l = W.__sbmcpUndo || [];
    W.__sbmcpUndo = [];
    let n = 0;
    while (l.length) { try { l.pop()(); n++; } catch {} }
    return n;
  }

  return { inventory, redact, undo };
})();`;

const INVENTORY_JS = `(() => { ${CLIENT_LIB}\nconst r = sbmcp.inventory(); return JSON.stringify({ urls: r.uses.map((x) => x.u), via: r.uses.map((x) => x.via), blob: r.blob, canvas: r.canvas }); })()`;
const UNDO_JS = `(() => { ${CLIENT_LIB}\nreturn sbmcp.undo(); })()`;
const redactJs = (denied: Record<AssetKind, string[]>) => `(() => { ${CLIENT_LIB}\nreturn JSON.stringify(sbmcp.redact(${JSON.stringify(denied)})); })()`;

/**
 * A Lua expression that evaluates `code` in the runtime's window. The code travels as base64 of its UTF-8, decoded
 * in the window, so that file names outside ASCII arrive intact; base64 also keeps it out of the Lua parser, which
 * rejects a level-1 long-bracket string that holds `]]]` and a later `]]` (measured on 2.12.1), as nested arrays do.
 */
export function jsEval(code: string): string {
  const b64 = Buffer.from(code, "utf8").toString("base64");
  return `js.window.eval(${luaString(`eval(new TextDecoder().decode(Uint8Array.from(atob("${b64}"), (c) => c.charCodeAt(0))))`)})`;
}

/** The current page, what the client has loaded since the timing began, and what the shown document uses. */
export const INSPECT_SCRIPT = `return {page = editor.getCurrentPage(), loads = js.window.eval(${luaString(LOADS_READ_JS)}), uses = ${jsEval(INVENTORY_JS)}}`;
/** Undoes the redactions of a screenshot; also run before a screenshot, for a log an interrupted one left behind. */
export const UNDO_SCRIPT = `return ${jsEval(UNDO_JS)}`;
/** Redacts the denied files of `space`, given per kind as paths of the space. */
export function redactScript(space: string, denied: Redactions): string {
  const abs = (paths: string[]) => paths.map((p) => `/${space}/.fs/${p}`);
  return `return ${jsEval(redactJs({ font: abs(denied.font), style: abs(denied.style), image: abs(denied.image) }))}`;
}

/** The inventory script's answer turned into uses of the space; anything unparseable throws, so that the check fails closed. */
export function parseUses(raw: unknown, space: string): Uses {
  if (typeof raw !== "string") throw new Error("the runtime returned no inventory of the shown page");
  const json = JSON.parse(raw) as { urls?: unknown; via?: unknown; blob?: unknown; canvas?: unknown };
  const via = json.via;
  if (!Array.isArray(json.urls) || !Array.isArray(via) || json.urls.length !== via.length) throw new Error("the runtime returned a malformed inventory of the shown page");
  const vias = new Set(["sheet", "font", "css", "element", "fixed"]);
  const uses: Use[] = [];
  json.urls.forEach((u: unknown, i) => {
    const v: unknown = via[i];
    if (typeof u !== "string" || typeof v !== "string" || !vias.has(v)) throw new Error(`the runtime returned a malformed inventory of the shown page (entry ${i})`);
    // Another origin's resource or a client asset is not a file of the space.
    const path = loadedPath(u, space);
    if (path !== null) uses.push({ path, via: v as Use["via"] });
  });
  return { uses, blob: json.blob === true, canvas: json.canvas === true };
}

/** The redaction script's answer: the paths it redacted, those it withdrew with a sheet turned off, and whether space styles are off. */
export function parseRedaction(raw: unknown, space: string): { paths: string[]; stylesOff: boolean } {
  if (typeof raw !== "string") throw new Error("the runtime returned no result of the redaction");
  const json = JSON.parse(raw) as { acted?: unknown; withdrawn?: unknown; stylesOff?: unknown };
  const all = [...(Array.isArray(json.acted) ? json.acted : []), ...(Array.isArray(json.withdrawn) ? json.withdrawn : [])];
  const paths = all.map((u) => (typeof u === "string" ? loadedPath(u, space) : null)).filter((p): p is string => p !== null);
  return { paths: [...new Set(paths)], stylesOff: json.stylesOff === true };
}

/** The functions of `space` that write; shadowed for the duration of a render or screenshot. */
const WRITING_FUNCTIONS = ["writePage", "deletePage", "writeFile", "deleteFile", "writeDocument", "deleteDocument"];

/**
 * Shadows the writing functions once (idempotent: a shadow left behind by an interrupted call is
 * not saved as the original). Globals are written through `_G`: in SilverBullet's Lua an
 * assignment to a bare name inside a function lands in a function-local environment that the
 * directives of the page do not see (measured on 2.12.1).
 */
const SHADOW = `
local function sbmcp_shadow()
  if _G.__sbmcp_saved == nil then
    local saved = {}
    for _, f in ipairs({${WRITING_FUNCTIONS.map((f) => JSON.stringify(f)).join(", ")}}) do
      saved[f] = space[f]
      space[f] = function() error("rendering is read-only") end
    end
    _G.__sbmcp_saved = saved
  end
end
local function sbmcp_restore()
  if _G.__sbmcp_saved ~= nil then
    for f, fn in pairs(_G.__sbmcp_saved) do space[f] = fn end
    _G.__sbmcp_saved = nil
  end
end`;

/**
 * The render script of the spike: `markdown.expandMarkdown` of the page's source, with the
 * writing functions shadowed. `expandMarkdown(text, {pageName})` is tried first (the edge
 * release); when the instance ignores it, `_CTX` is set by hand around the call (2.12.1 sets
 * none inside `expandMarkdown`), which is why calls on one runtime are serialised.
 */
export function renderScript(page: string): string {
  return `${SHADOW}
local name = ${luaString(page)}
sbmcp_shadow()
${LOADS_BEGIN}
local ok, result = pcall(function()
  local text = space.readPage(name)
  local probeOk, probe = pcall(markdown.expandMarkdown, "\${_CTX.currentPage.name}", {pageName = name})
  if probeOk and type(probe) == "string" and string.find(probe, name, 1, true) ~= nil then
    return {markdown = markdown.expandMarkdown(text, {pageName = name}), shim = false}
  end
  local meta = index.getObjectByRef(name, "page", name) or space.getPageMeta(name)
  _G._CTX = {currentPage = meta}
  local expandOk, md = pcall(markdown.expandMarkdown, text)
  _G._CTX = nil
  if not expandOk then error(md) end
  return {markdown = md, shim = true}
end)
local loads = ${LOADS_READ}
sbmcp_restore()
if not ok then error(result) end
result.loads = loads
return result`;
}

/**
 * Shadows the writing functions, starts the resource timing and shows the page in the runtime's
 * editor; the loads are then read until they settle, and the screenshot follows as a separate request.
 */
export function navigateScript(page: string): string {
  return `${SHADOW}
sbmcp_shadow()
${LOADS_BEGIN}
editor.navigate(${luaString(page)})
return editor.getCurrentPage()`;
}

/** Shows the blank page, so that what the page shown before still loads lands outside the next capture. */
export const PARK_SCRIPT = `editor.navigate(${luaString(BLANK_PAGE)})
return editor.getCurrentPage()`;
export const CURRENT_PAGE_SCRIPT = `return editor.getCurrentPage()`;
/** The current page and what the client has loaded since the timing began. */
export const LOADS_SCRIPT = `return {page = editor.getCurrentPage(), loads = ${LOADS_READ}}`;
/** Undoes the redactions of a screenshot, restores the writing functions and parks the runtime on the blank page. */
export const RESTORE_SCRIPT = `${SHADOW}
pcall(function() ${jsEval(UNDO_JS)} end)
sbmcp_restore()
editor.navigate(${luaString(BLANK_PAGE)})
return true`;

/**
 * Which of the pages are not current in the runtime's index: the page object's `lastModified`
 * differs from the file's (both formatted by the client, so they are compared as they are),
 * or a deleted page still has an object.
 */
export function indexCheckScript(pages: string[]): string {
  return `local pages = {${pages.map(luaString).join(", ")}}
local stale = {}
for _, name in ipairs(pages) do
  local ok, meta = pcall(space.getPageMeta, name)
  local o = index.getObjectByRef(name, "page", name)
  if ok and meta ~= nil then
    if o == nil or o.lastModified ~= meta.lastModified then stale[#stale + 1] = name end
  elseif o ~= nil then
    stale[#stale + 1] = name
  end
end
return {count = #stale, pages = stale}`;
}

export const REBOOT_SCRIPT = `system.reboot()
return true`;

/** Serialises jobs: each starts when the previous one has settled. */
class Queue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.tail.then(job, job);
    this.tail = next.catch(() => {});
    return next;
  }
}

/** At most `n` holders at once; waiters are served in order. */
class Semaphore {
  private free: number;
  private readonly waiting: Array<() => void> = [];

  constructor(n: number) {
    this.free = n;
  }

  async acquire(): Promise<() => void> {
    if (this.free > 0) this.free--;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) next();
      else this.free++;
    };
  }
}

export type RenderOutcome = {
  /** Milliseconds spent waiting for the queue and the global cap. */
  queuedMs: number;
  /** Milliseconds spent waiting for the runtime's index, reboot included. */
  indexWaitMs: number;
  rebooted: boolean;
  warnings: string[];
};

/** `loaded`: how many files of the space the render loaded, all of them readable by the caller (the render check). */
export type RenderResult = RenderOutcome & { markdown: string; shim: boolean; loaded: number };
/** `redacted`: the denied fonts, stylesheets and images the screenshot was taken without (the render check). */
export type ScreenshotResult = RenderOutcome & { png: Buffer; width: number; height: number; loaded: number; redacted: Redactions };

/** A runtime bound to one user, space and deadline. */
type Handle = {
  lua(script: string): Promise<unknown>;
  screenshot(opts: { selector?: string; fullPage?: boolean }): Promise<Buffer>;
  /** Runs a script outside the call's deadline, with a deadline of its own as long as a render's; never rejects. */
  cleanup(script: string): Promise<void>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The settle loop of a screenshot: polls every `SETTLE_STEP` ms until `SETTLE_POLLS` polls brought nothing new, at most `SETTLE_CAP` ms. */
const SETTLE_STEP = 50;
const SETTLE_POLLS = 3;
const SETTLE_CAP = 1500;

export class Renderer {
  private readonly d: RenderDeps;
  private readonly queues = new Map<string, Queue>();
  private readonly gate: Semaphore;

  constructor(d: RenderDeps) {
    this.d = d;
    // The configuration already refuses less than 1; a cap of 0 would never grant.
    this.gate = new Semaphore(Math.max(1, d.config.renderParallel));
  }

  /** Renders the page; `verify` sees what the expansion loaded and refuses by throwing, before the Markdown is returned. */
  render(user: Credential, space: string, page: string, verify: VerifyLoads): Promise<RenderResult> {
    return this.onRuntime(user, space, async (rt) => {
      const r = (await rt.lua(renderScript(page))) as { markdown?: unknown; shim?: unknown; loads?: unknown };
      if (!r || typeof r.markdown !== "string") throw new Error("the render script returned no Markdown");
      const loads = parseLoads(r.loads, space);
      verify(loads);
      return { markdown: r.markdown, shim: r.shim === true, loaded: loads.files.length };
    });
  }

  /**
   * Shows the page and captures it. `verify` sees what the client loaded and what the shown
   * document uses once the loads settled, and refuses by throwing or names the denied fonts,
   * stylesheets and images to redact; after each redaction the page settles and is judged again,
   * at most `REDACT_ROUNDS` times, and once more after the capture. The runtime is parked on the
   * blank page before (when it shows anything else) and after, so that fetches of the page shown
   * before land outside the capture window; the redactions are undone afterwards.
   */
  screenshot(user: Credential, space: string, page: string, opts: { selector?: string; fullPage?: boolean }, verify: VerifyScreen): Promise<ScreenshotResult> {
    return this.onRuntime(user, space, async (rt) => {
      try {
        // A screenshot interrupted before its restore leaves its redactions behind.
        await rt.lua(UNDO_SCRIPT);
        if ((await rt.lua(CURRENT_PAGE_SCRIPT)) !== BLANK_PAGE) {
          await rt.lua(PARK_SCRIPT);
          await this.settle(rt, space, BLANK_PAGE);
        }
        await rt.lua(navigateScript(page));
        await this.settle(rt, space, page);
        const redacted = new Set<string>();
        const done: Redactions = { font: [], style: [], image: [] };
        let stylesOff = false;
        for (let round = 0; ; round++) {
          const seen = await this.inspect(rt, space, redacted);
          const todo = verify(seen, round === REDACT_ROUNDS);
          if (!todo.font.length && !todo.style.length && !todo.image.length) break;
          const r = parseRedaction(await rt.lua(redactScript(space, todo)), space);
          // Only what the client reports as changed counts: a file it failed to reach stays to be judged.
          for (const f of r.paths) redacted.add(f);
          for (const k of ["font", "style", "image"] as const) for (const f of todo[k]) if (r.paths.includes(f) && !done[k].includes(f)) done[k].push(f);
          stylesOff ||= r.stylesOff;
          await this.settle(rt, space, page);
        }
        const png = await rt.screenshot(opts);
        const { width, height } = pngSize(png);
        // What landed or changed between the check and the capture is judged too; nothing may be left to redact.
        const after = await this.inspect(rt, space, redacted);
        verify(after, true);
        return { png, width, height, loaded: after.loads.files.length, warnings: redactionWarnings(space, user.user, done, stylesOff), redacted: done };
      } finally {
        // Past the deadline too, and never throwing: the result stands and the runtime gets its state back.
        await rt.cleanup(RESTORE_SCRIPT);
        // Reads of the page just left land after the navigation returned; let them settle here, so that they
        // do not fall into the window of the next call on this runtime (a render-note does not park first).
        await Promise.resolve()
          .then(() => this.settle(rt, space, BLANK_PAGE))
          .catch(() => {});
      }
    });
  }

  private async inspect(rt: Handle, space: string, redacted: ReadonlySet<string>): Promise<Seen> {
    const r = (await rt.lua(INSPECT_SCRIPT)) as { loads?: unknown; uses?: unknown } | null;
    return { loads: parseLoads(r?.loads, space), uses: parseUses(r?.uses, space), redacted };
  }

  private async loads(rt: Handle, space: string): Promise<{ page: unknown; loads: Loads }> {
    const r = (await rt.lua(LOADS_SCRIPT)) as { page?: unknown; loads?: unknown } | null;
    return { page: r?.page, loads: parseLoads(r?.loads, space) };
  }

  /**
   * Polls the loads until the page is shown and no new entry arrived over `SETTLE_POLLS` polls
   * (widgets load after `editor.navigate` returns; measured 55 ms for a transclusion), bounded by
   * `SETTLE_CAP`. Returns the loads seen last.
   */
  private async settle(rt: Handle, space: string, page: string): Promise<Loads> {
    const until = Date.now() + SETTLE_CAP;
    let last = await this.loads(rt, space);
    let stable = 0;
    while (Date.now() < until) {
      await sleep(SETTLE_STEP);
      const now = await this.loads(rt, space);
      stable = now.page === page && now.loads.entries === last.loads.entries ? stable + 1 : 0;
      last = now;
      if (stable >= SETTLE_POLLS) break;
    }
    return last.loads;
  }

  /**
   * Runs `fn` on the user's runtime for the space: queued per (user, space), under the global
   * cap, within the deadline, after the index wait for the pending writes of the space.
   */
  private async onRuntime<T>(user: Credential, space: string, fn: (rt: Handle) => Promise<T>): Promise<T & RenderOutcome> {
    const { sb, state, config, log } = this.d;
    const key = `${user.user}/${space}`;
    const deadline = Date.now() + config.renderTimeout;
    const t0 = Date.now();
    let queue = this.queues.get(key);
    if (!queue) {
      queue = new Queue();
      this.queues.set(key, queue);
    }
    const remaining = () => {
      const sec = Math.ceil((deadline - Date.now()) / 1000);
      if (sec <= 0) throw new RenderTimeout(`The render did not complete within ${Math.round(config.renderTimeout / 1000)} s (MCP_RENDER_TIMEOUT).`);
      return sec;
    };
    return queue.run(async () => {
      remaining();
      const release = await this.gate.acquire();
      try {
        remaining();
        const queuedMs = Date.now() - t0;
        // The runtime counts as used once a Runtime API call succeeded: a refusal (403) starts no browser.
        const rt = state.runtimes.get(key) ?? { user: user.user, space, firstUsed: new Date(), lastUsed: new Date(), calls: 0, reboots: 0, confirmedSeq: 0 };
        rt.lastUsed = new Date();
        rt.calls++;
        const used = <T>(p: Promise<T>) =>
          p.then((v) => {
            if (!state.runtimes.has(key)) state.runtimes.set(key, rt);
            return v;
          });
        const handle: Handle = {
          lua: (script) => used(sb.lua(user.token, space, script, remaining())),
          screenshot: (opts) => used(sb.screenshot(user.token, space, opts, remaining())),
          cleanup: (script) =>
            Promise.resolve()
              .then(() => sb.lua(user.token, space, script, Math.max(1, Math.ceil(config.renderTimeout / 1000))))
              .then(
                () => {},
                (e) => log.warn("render.restore", { user: user.user, space, error: (e as Error).message }),
              ),
        };
        const t1 = Date.now();
        const { warnings, rebooted } = await this.ensureIndex(handle, rt, space);
        const indexWaitMs = Date.now() - t1;
        const out = await fn(handle);
        const own = (out as { warnings?: string[] }).warnings ?? [];
        log.info("render", { user: user.user, space, queuedMs, indexWaitMs, rebooted, loaded: (out as { loaded?: number }).loaded, ms: Date.now() - t0 });
        return { ...out, queuedMs, indexWaitMs, rebooted, warnings: [...warnings, ...own] };
      } finally {
        release();
      }
    });
  }

  /**
   * The index wait of docs/security.md, section 12: the pages written through the server that
   * this runtime has not confirmed are checked in its index, bounded by `indexWait`; then the
   * runtime's client is rebooted (`system.reboot()`, as the same user), which re-indexes the
   * space, and checked once more. A page still missing is a warning on the result, not an error.
   */
  private async ensureIndex(rt: Handle, info: RuntimeInfo, space: string): Promise<{ warnings: string[]; rebooted: boolean }> {
    const { state, log } = this.d;
    const pending = state.pendingFor(space, info.confirmedSeq);
    if (pending.length === 0) return { warnings: [], rebooted: false };
    const pages = [...new Set(pending.map((w) => w.page))];
    const latest = Math.max(...pending.map((w) => w.seq));
    let stale = await this.waitForIndex(rt, pages);
    let rebooted = false;
    if (stale.length > 0) {
      log.warn("render.reboot", { user: info.user, space, stale });
      rebooted = true;
      info.reboots++;
      await rt.lua(REBOOT_SCRIPT);
      await this.waitForRuntime(rt);
      stale = await this.waitForIndex(rt, stale);
    }
    // One reboot per batch of writes: a page the index never takes is reported, not retried forever.
    info.confirmedSeq = Math.max(info.confirmedSeq, latest);
    const warnings = stale.length ? [`The runtime's index does not yet hold the latest revision of ${stale.map((p) => `"${p}"`).join(", ")}${rebooted ? " (even after a reboot of the runtime)" : ""}; queries over these pages may be stale.`] : [];
    if (stale.length) log.warn("render.index.stale", { user: info.user, space, stale, rebooted });
    return { warnings, rebooted };
  }

  /** Polls the index check until no page is stale or `indexWait` has passed; returns the pages still stale. */
  private async waitForIndex(rt: Handle, pages: string[]): Promise<string[]> {
    const until = Date.now() + this.d.config.indexWait;
    for (;;) {
      const r = (await rt.lua(indexCheckScript(pages))) as { count?: number; pages?: string[] } | null;
      const stale = r && typeof r.count === "number" && r.count > 0 && Array.isArray(r.pages) ? r.pages : [];
      if (stale.length === 0 || Date.now() >= until) return stale;
      await sleep(Math.min(300, Math.max(50, until - Date.now())));
    }
  }

  /** After a reboot the runtime may refuse scripts for a moment; waits until it answers again. */
  private async waitForRuntime(rt: Handle): Promise<void> {
    for (;;) {
      try {
        if ((await rt.lua("return 1")) === 1) return;
      } catch (e) {
        if (!(e instanceof RuntimeError) || e.status === 403 || e.status === 401) throw e;
      }
      await sleep(250);
    }
  }
}

/** One warning per kind of file a screenshot was taken without, naming the files. */
export function redactionWarnings(space: string, user: string, done: Redactions, stylesOff: boolean): string[] {
  const list = (files: string[]) => files.map((f) => `${space}/${f}`).join(", ");
  const why = `user "${user}" has no "r" on it in the access list`;
  const out: string[] = [];
  if (done.font.length) out.push(`Fonts not readable (${why}), shown with ${stylesOff ? "SilverBullet's default theme" : "a substitute font"}: ${list(done.font)}.`);
  if (done.style.length) out.push(`Stylesheets not readable (${why}), shown in SilverBullet's default theme (space styles off): ${list(done.style)}.`);
  if (done.image.length) out.push(`Images not readable (${why}), replaced by a placeholder: ${list(done.image)}.`);
  return out;
}

/** Width and height of a PNG from its IHDR chunk; throws when the bytes are not a PNG. */
export function pngSize(png: Buffer): { width: number; height: number } {
  const signature = "89504e470d0a1a0a";
  if (png.length < 24 || png.subarray(0, 8).toString("hex") !== signature) throw new Error("the runtime did not return a PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
