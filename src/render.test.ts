import test from "node:test";
import assert from "node:assert/strict";
import { State } from "./state.ts";
import { Log } from "./log.ts";
import type { Config } from "./config.ts";
import type { Credential } from "./credentials.ts";
import type { SilverBullet } from "./sb.ts";
import { assetKind, BLANK_PAGE, CURRENT_PAGE_SCRIPT, INSPECT_SCRIPT, LOADS_SCRIPT, Renderer, type VerifyScreen, judgeLoads, judgeScreen, jsEval, loadedPath, LOADS_BUFFER, luaString, navigateScript, parseLoads, parseRedaction, parseUses, redactionWarnings, redactScript, renderScript, RESTORE_SCRIPT, UNDO_SCRIPT, type Seen } from "./render.ts";

test("loads: a resource-timing URL of the space's file API becomes the file's path, decoded; everything else is ignored", () => {
  assert.equal(loadedPath("http://silverbullet:3000/gamma/.fs/Projects/One.md", "gamma"), "Projects/One.md");
  assert.equal(loadedPath("http://127.0.0.1:3000/gamma/.fs/Render/With%20Space.md", "gamma"), "Render/With Space.md");
  assert.equal(loadedPath("http://127.0.0.1:3000/gamma/.fs/Pictures/a%2Bb.png", "gamma"), "Pictures/a+b.png");
  assert.equal(loadedPath("http://127.0.0.1:3000/gamma/.fs", "gamma"), null, "the listing");
  assert.equal(loadedPath("http://127.0.0.1:3000/gamma/.fs/", "gamma"), null, "the listing with a slash");
  assert.equal(loadedPath("http://127.0.0.1:3000/beta/.fs/Secret.md", "gamma"), null, "another space");
  assert.equal(loadedPath("http://127.0.0.1:3000/gamma/.client/boot.js", "gamma"), null, "a client asset");
  assert.equal(loadedPath("http://127.0.0.1:3000/gamma/.runtime/lua_script", "gamma"), null);
  assert.equal(loadedPath(`http://127.0.0.1:3000/gamma/.fs/${BLANK_PAGE}.md`, "gamma"), null, "the blank page the runtime is parked on");
  assert.equal(loadedPath("not a url", "gamma"), null);
  assert.equal(loadedPath("http://127.0.0.1:3000/gamma/.fs/%E0%A4%A", "gamma"), null, "undecodable");
});

test("loads: the read script's JSON becomes the files of the space, in order and without repeats, with the overflow flag", () => {
  const raw = JSON.stringify({
    full: false,
    urls: ["http://h/gamma/.fs/Rendered.md", "http://h/gamma/.fs/Projects/One.md", "http://h/gamma/.fs", "http://h/gamma/.fs/Rendered.md", "http://h/gamma/.client/x.js"],
  });
  assert.deepEqual(parseLoads(raw, "gamma"), { files: ["Rendered.md", "Projects/One.md"], full: false, entries: 5 });
  assert.deepEqual(parseLoads(JSON.stringify({ full: true, urls: [] }), "gamma"), { files: [], full: true, entries: 0 });
  assert.throws(() => parseLoads(undefined, "gamma"), /no resource timing/);
  assert.throws(() => parseLoads("{", "gamma"), SyntaxError);
});

test("judge: files the caller may not read are denied, the rendered page itself excepted; a readable set passes", () => {
  const mayRead = (f: string) => !f.startsWith("Private/") && f !== "CONFIG.md";
  const loads = { files: ["Notes/Page.md", "Projects/One.md", "Private/Plan.md", "CONFIG.md", "Pictures/a.png"], full: false, entries: 5 };
  assert.deepEqual(judgeLoads(loads, "Notes/Page.md", mayRead), { blind: null, denied: ["Private/Plan.md", "CONFIG.md"] });
  assert.deepEqual(judgeLoads({ files: ["Notes/Page.md", "Projects/One.md"], full: false, entries: 2 }, "Notes/Page.md", mayRead), { blind: null, denied: [] });
  // x suffices for the page rendered: no r needed on it.
  assert.deepEqual(judgeLoads({ files: ["Private/Plan.md"], full: false, entries: 1 }, "Private/Plan.md", mayRead), { blind: null, denied: [] });
});

test("judge: blind when the page's own read is missing or the browser dropped entries; the denied files are still named", () => {
  const mayRead = () => true;
  const missing = judgeLoads({ files: ["Projects/One.md"], full: false, entries: 1 }, "Notes/Page.md", mayRead);
  assert.match(missing.blind!, /the page's own read is missing from the browser's resource timing \(1 entries\)/);
  const empty = judgeLoads({ files: [], full: false, entries: 0 }, "Notes/Page.md", mayRead);
  assert.match(empty.blind!, /own read is missing/);
  const full = judgeLoads({ files: ["Notes/Page.md", "Private/Plan.md"], full: true, entries: LOADS_BUFFER }, "Notes/Page.md", () => false);
  assert.match(full.blind!, new RegExp(`more than ${LOADS_BUFFER} resources`));
  assert.deepEqual(full.denied, ["Private/Plan.md"]);
});

test("scripts: the render and navigate scripts start the resource timing before the page is read or shown; restore parks the runtime on the blank page", () => {
  const render = renderScript("Notes/Page");
  const begin = render.indexOf("clearResourceTimings");
  assert.ok(begin > 0 && begin < render.indexOf("space.readPage(name)"), "timing cleared before the page is read");
  assert.ok(render.indexOf("getEntriesByType") > render.indexOf("markdown.expandMarkdown"), "timing read after the expansion");
  assert.match(render, /result\.loads = loads/);
  const navigate = navigateScript("Notes/Page");
  assert.ok(navigate.indexOf("clearResourceTimings") < navigate.indexOf("editor.navigate"), "timing cleared before the navigation");
  assert.match(RESTORE_SCRIPT, new RegExp(`editor\\.navigate\\(\\[\\[\\n${BLANK_PAGE}\\]\\]\\)`));
  assert.equal(luaString("a]]b"), "[=[\na]]b]=]");
});

test("loads: the initiators tell what the document fetched to show it from the client's own reads", () => {
  const base = "http://127.0.0.1:3000/gamma/.fs/";
  const raw = JSON.stringify({ full: false, urls: [`${base}Notes/Page.md`, `${base}Theme/a.css`, `${base}Theme/f.woff2`, `${base}Pics/x.png`, `${base}Pics/x.png`], initiators: ["fetch", "css", "css", "fetch", "img"] });
  assert.deepEqual(parseLoads(raw, "gamma").presented, ["Theme/a.css", "Theme/f.woff2", "Pics/x.png"]);
  assert.equal(parseLoads(JSON.stringify({ urls: [`${base}A.md`], initiators: [] }), "gamma").presented, undefined, "no initiators, no presented list");
});

test("redaction: fonts, stylesheets and images are told by their extension; everything else is not an asset", () => {
  assert.equal(assetKind("Library/Theme/a.WOFF2"), "font");
  assert.equal(assetKind("Library/Theme/a.otf"), "font");
  assert.equal(assetKind("Library/Theme/a.css"), "style");
  assert.equal(assetKind("Pics/a.JPEG"), "image");
  assert.equal(assetKind("Pics/a.svg"), "image");
  assert.equal(assetKind("Notes/Page.md"), null);
  assert.equal(assetKind("Notes/file.html"), null);
  assert.equal(assetKind("Notes/png"), null);
  assert.equal(assetKind("Notes.v2/README"), null);
});

const seen = (s: Partial<Seen> & { files?: string[]; presented?: string[] | null }): Seen => ({
  loads: { files: s.files ?? ["Notes/Page.md"], full: false, entries: 9, presented: s.presented === null ? undefined : (s.presented ?? []) },
  uses: s.uses ?? { uses: [], blob: false, canvas: false },
  redacted: s.redacted ?? new Set(),
});
const mayRead = (f: string) => !f.startsWith("Library/");

test("judge screen: denied fonts, stylesheets and images in use are redacted; a denied page refuses; the rendered page and readable files pass", () => {
  const j = judgeScreen(
    seen({
      files: ["Notes/Page.md", "Library/Note.md", "Library/f.woff2"],
      presented: ["Library/f.woff2"],
      uses: { uses: [{ path: "Library/f.woff2", via: "font" }, { path: "Library/t.css", via: "sheet" }, { path: "Library/x.png", via: "element" }, { path: "Library/x.png", via: "css" }, { path: "Pics/ok.png", via: "element" }], blob: false, canvas: false },
    }),
    "Notes/Page.md",
    mayRead,
  );
  assert.deepEqual(j, { blind: null, denied: ["Library/Note.md"], redact: { font: ["Library/f.woff2"], style: ["Library/t.css"], image: ["Library/x.png"] } });
});

test("judge screen: an asset the redaction cannot reach, or a page in a url(), refuses at once", () => {
  const j = judgeScreen(seen({ uses: { uses: [{ path: "Library/x.png", via: "fixed" }, { path: "Library/Note.md", via: "css" }], blob: false, canvas: false } }), "Notes/Page.md", mayRead);
  assert.deepEqual(j.denied, ["Library/x.png", "Library/Note.md"]);
  assert.deepEqual(j.redact, { font: [], style: [], image: [] });
});

test("judge screen: a denied asset the document fetched to show it but no longer uses refuses unless it was redacted", () => {
  const fetched = { files: ["Notes/Page.md", "Library/x.png"], presented: ["Library/x.png"] };
  assert.deepEqual(judgeScreen(seen(fetched), "Notes/Page.md", mayRead).denied, ["Library/x.png"]);
  assert.deepEqual(judgeScreen(seen({ ...fetched, redacted: new Set(["Library/x.png"]) }), "Notes/Page.md", mayRead).denied, []);
});

test("judge screen: a denied asset the client loaded any other way (fetch, XHR) refuses, whether in use or not; a readable one passes", () => {
  const files = ["Notes/Page.md", "Library/y.png", "Library/f.woff2", "Pics/ok.png"];
  assert.deepEqual(judgeScreen(seen({ files }), "Notes/Page.md", mayRead).denied, ["Library/y.png", "Library/f.woff2"]);
  const inUse = judgeScreen(seen({ files, uses: { uses: [{ path: "Library/y.png", via: "element" }], blob: false, canvas: false } }), "Notes/Page.md", mayRead);
  assert.deepEqual(inUse.denied, ["Library/y.png", "Library/f.woff2"]);
});

test("judge screen: blind when the page's own read is missing, the initiators are missing, a blob: URL is shown or the page has a canvas", () => {
  assert.match(judgeScreen(seen({ files: [] }), "Notes/Page.md", mayRead).blind!, /own read is missing/);
  assert.match(judgeScreen(seen({ presented: null }), "Notes/Page.md", mayRead).blind!, /gave no initiators/);
  assert.match(judgeScreen(seen({ uses: { uses: [], blob: true, canvas: false } }), "Notes/Page.md", mayRead).blind!, /blob: URL/);
  assert.match(judgeScreen(seen({ uses: { uses: [], blob: false, canvas: true } }), "Notes/Page.md", mayRead).blind!, /canvas/);
  assert.equal(judgeScreen(seen({}), "Notes/Page.md", mayRead).blind, null);
});

test("redaction: the inventory and the redaction result become paths of the space; a malformed inventory throws, an unknown via or a non-string URL included", () => {
  const base = "http://127.0.0.1:3000/gamma/.fs/";
  assert.deepEqual(parseUses(JSON.stringify({ urls: [`${base}Library/a%20b.png`, "https://example.org/x.png", `${base}Library/M%C3%A4rk-%C5%91.png`], via: ["element", "css", "fixed"], blob: false, canvas: true }), "gamma"), {
    uses: [
      { path: "Library/a b.png", via: "element" },
      { path: "Library/Märk-ő.png", via: "fixed" },
    ],
    blob: false,
    canvas: true,
  });
  assert.throws(() => parseUses(undefined, "gamma"), /no inventory/);
  assert.throws(() => parseUses(JSON.stringify({ urls: ["a"], via: [] }), "gamma"), /malformed/);
  assert.throws(() => parseUses(JSON.stringify({ urls: [`${base}Library/f.woff2`], via: ["nonsense"] }), "gamma"), /malformed .*entry 0/);
  assert.throws(() => parseUses(JSON.stringify({ urls: [`${base}A.png`, 7], via: ["css", "css"] }), "gamma"), /malformed .*entry 1/);
  assert.deepEqual(parseRedaction(JSON.stringify({ acted: [`${base}Library/x.png`, `${base}Library/x.png`], withdrawn: [`${base}Library/t.css`], stylesOff: true }), "gamma"), { paths: ["Library/x.png", "Library/t.css"], stylesOff: true });
});

test("redaction: one warning per kind, naming the files and what the screenshot shows instead", () => {
  const w = redactionWarnings("gamma", "alice", { font: ["Library/f.woff2"], style: [], image: ["Library/x.png", "Library/y.png"] }, false);
  assert.deepEqual(w, [
    'Fonts not readable (user "alice" has no "r" on it in the access list), shown with a substitute font: gamma/Library/f.woff2.',
    'Images not readable (user "alice" has no "r" on it in the access list), replaced by a placeholder: gamma/Library/x.png, gamma/Library/y.png.',
  ]);
  assert.match(redactionWarnings("gamma", "alice", { font: [], style: ["Library/t.css"], image: [] }, true)[0], /^Stylesheets not readable .*default theme \(space styles off\): gamma\/Library\/t\.css\.$/);
  assert.match(redactionWarnings("gamma", "alice", { font: ["Library/f.woff2"], style: [], image: [] }, true)[0], /shown with SilverBullet's default theme/);
  assert.deepEqual(redactionWarnings("gamma", "alice", { font: [], style: [], image: [] }, false), []);
});

/** The client code inside a script, decoded as the window decodes it. */
const clientCode = (script: string) => Buffer.from(/atob\("([^"]+)"\)/.exec(script)![1], "base64").toString("utf8");

test("redaction: the client script travels as base64 of its UTF-8, so the Lua source is ASCII and a file name outside Latin-1 arrives intact; the restore undoes the redactions", () => {
  for (const script of [INSPECT_SCRIPT, UNDO_SCRIPT, RESTORE_SCRIPT, redactScript("gamma", { font: ["a b.woff2"], style: [], image: ["Bilder/Märk-ő €.png"] })]) {
    assert.ok([...script].every((c) => c === "\n" || c === "\t" || (c >= " " && c <= "~")), "ASCII only");
    assert.doesNotMatch(script, /sbmcp\.redact|sbmcp\.undo|sbmcp\.inventory/, "no client code in the Lua source");
  }
  assert.match(clientCode(redactScript("gamma", { font: [], style: [], image: ["Pics/x.png"] })), /sbmcp\.redact\(\{"font":\[\],"style":\[\],"image":\["\/gamma\/\.fs\/Pics\/x\.png"\]\}\)/);
  assert.ok(clientCode(redactScript("gamma", { font: [], style: [], image: ["Bilder/Märk-ő €.png"] })).includes('"/gamma/.fs/Bilder/Märk-ő €.png"'), "the name survives the transport");
  assert.match(jsEval("1 + 1"), /new TextDecoder\(\)\.decode\(Uint8Array\.from\(atob\("MSArIDE="\)/);
  // What the window does with it, here in Node: atob, the bytes, UTF-8.
  const expr = /eval\((new TextDecoder[^\n]*)\)\]\]\)$/.exec(jsEval('"Märk-ő €"'))![1];
  assert.equal(eval(eval(expr)), "Märk-ő €");
  assert.ok(RESTORE_SCRIPT.indexOf("atob") < RESTORE_SCRIPT.lastIndexOf("sbmcp_restore()"), "undone before the writing functions are restored and the runtime parked");
});

// The screenshot loop against a fake runtime: the scripts are told apart by their text.

const BASE = "http://127.0.0.1:3000/gamma/.fs/";
const PAGE = "Notes/Page";
const fakePng = () => {
  const b = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(b);
  b.writeUInt32BE(800, 16);
  b.writeUInt32BE(600, 20);
  return b;
};
type Look = { presented: string[]; uses: Array<[string, string]> };
function fakeRenderer(opts: { looks: (n: number) => Look; acted: (n: number) => string[]; slowInspect?: (n: number) => number; renderTimeout?: number }) {
  const calls: string[] = [];
  let inspects = 0;
  let redactions = 0;
  const loads = (presented: string[]) => JSON.stringify({ full: false, urls: [`${BASE}${PAGE}.md`, ...presented.map((p) => BASE + p)], initiators: ["fetch", ...presented.map(() => "img")] });
  const sb = {
    async lua(_token: string, _space: string, script: string) {
      if (script === CURRENT_PAGE_SCRIPT) return calls.push("current"), BLANK_PAGE;
      if (script === navigateScript(PAGE)) return calls.push("navigate"), PAGE;
      if (script === LOADS_SCRIPT) return { page: PAGE, loads: loads(opts.looks(inspects).presented) };
      if (script === UNDO_SCRIPT) return calls.push("undo"), 0;
      if (script === RESTORE_SCRIPT) return calls.push("restore"), true;
      if (script === INSPECT_SCRIPT) {
        const n = inspects++;
        calls.push("inspect");
        const look = opts.looks(n);
        await new Promise((r) => setTimeout(r, opts.slowInspect?.(n) ?? 0));
        return { page: PAGE, loads: loads(look.presented), uses: JSON.stringify({ urls: look.uses.map(([p]) => BASE + p), via: look.uses.map(([, v]) => v), blob: false, canvas: false }) };
      }
      if (script.includes("atob")) {
        calls.push("redact");
        return JSON.stringify({ acted: opts.acted(redactions++).map((p) => BASE + p), withdrawn: [], stylesOff: false });
      }
      throw new Error(`unexpected script: ${script.slice(0, 60)}`);
    },
    async screenshot() {
      calls.push("capture");
      return fakePng();
    },
  };
  const config = { renderParallel: 1, renderTimeout: opts.renderTimeout ?? 60_000, indexWait: 0 } as unknown as Config;
  const renderer = new Renderer({ sb: sb as unknown as SilverBullet, state: new State("Report", "scan"), config, log: new Log("error", () => {}) });
  const verify: VerifyScreen = (s, last) => {
    const j = judgeScreen(s, `${PAGE}.md`, mayRead);
    if (j.blind || j.denied.length) throw new Error(`refused: ${j.blind ?? j.denied.join(", ")}`);
    if (last && (j.redact.font.length || j.redact.style.length || j.redact.image.length)) throw new Error("refused: unsettled");
    return j.redact;
  };
  const shot = () => renderer.screenshot({ user: "alice", token: "t" } as Credential, "gamma", PAGE, {}, verify);
  return { shot, calls };
}

test("screenshot loop: a denied image the client replaced is redacted, named in the warning and the runtime restored", async () => {
  const { shot, calls } = fakeRenderer({
    looks: (n) => ({ presented: ["Library/x.png"], uses: n === 0 ? [["Library/x.png", "element"]] : [] }),
    acted: () => ["Library/x.png"],
  });
  const r = await shot();
  assert.deepEqual(r.redacted, { font: [], style: [], image: ["Library/x.png"] });
  assert.match(r.warnings.join(" "), /Images not readable .*gamma\/Library\/x\.png/);
  assert.equal(calls.at(-1), "restore");
});

test("screenshot loop: a redaction the client did not carry out does not count; the image, no longer in use but presented, refuses", async () => {
  const { shot, calls } = fakeRenderer({
    looks: (n) => ({ presented: ["Library/x.png"], uses: n === 0 ? [["Library/x.png", "element"]] : [] }),
    acted: () => [],
  });
  await assert.rejects(shot(), /refused: Library\/x\.png/);
  assert.ok(!calls.includes("capture"), "nothing captured");
  assert.equal(calls.at(-1), "restore", "restored after a refusal too");
});

test("screenshot loop: when the deadline passes after the capture, the screenshot stands and the restore still runs", async () => {
  const { shot, calls } = fakeRenderer({
    looks: () => ({ presented: [], uses: [] }),
    acted: () => [],
    renderTimeout: 1000,
    // The look after the capture (the second inspect) returns past the deadline.
    slowInspect: (n) => (n === 1 ? 1300 : 0),
  });
  const r = await shot();
  assert.equal(r.width, 800);
  assert.equal(calls.at(-1), "restore");
});
