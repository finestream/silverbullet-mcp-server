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
const LOADS_READ_JS = `JSON.stringify({full: window.__sbmcpFull === true, urls: performance.getEntriesByType("resource").map((e) => e.name)})`;
const LOADS_BEGIN = `js.window.eval(${luaString(LOADS_BEGIN_JS)})`;
const LOADS_READ = `js.window.eval(${luaString(LOADS_READ_JS)})`;

/** What a render loaded: the files of the space the client fetched, in order and without repeats, and whether the browser dropped entries. */
export type Loads = { files: string[]; full: boolean; entries: number };

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
  const json = JSON.parse(raw) as { full?: unknown; urls?: unknown };
  const urls = Array.isArray(json.urls) ? json.urls.filter((u): u is string => typeof u === "string") : [];
  const files = [...new Set(urls.map((u) => loadedPath(u, space)).filter((p): p is string => p !== null))];
  return { files, full: json.full === true, entries: urls.length };
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
/** Restores the writing functions and parks the runtime on the blank page. */
export const RESTORE_SCRIPT = `${SHADOW}
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
  runtime: RuntimeInfo;
};

/** `loaded`: how many files of the space the render loaded, all of them readable by the caller (the render check). */
export type RenderResult = RenderOutcome & { markdown: string; shim: boolean; loaded: number };
export type ScreenshotResult = RenderOutcome & { png: Buffer; width: number; height: number; loaded: number };

/** A runtime bound to one user, space and deadline. */
type Handle = {
  lua(script: string): Promise<unknown>;
  screenshot(opts: { selector?: string; fullPage?: boolean }): Promise<Buffer>;
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
   * Shows the page and captures it; `verify` sees what the client loaded once the loads settled,
   * before the capture, and once more after it, and refuses by throwing. The runtime is parked on
   * the blank page before (when it shows anything else) and after, so that fetches of the page
   * shown before land outside the capture window.
   */
  screenshot(user: Credential, space: string, page: string, opts: { selector?: string; fullPage?: boolean }, verify: VerifyLoads): Promise<ScreenshotResult> {
    return this.onRuntime(user, space, async (rt) => {
      try {
        if ((await rt.lua(CURRENT_PAGE_SCRIPT)) !== BLANK_PAGE) {
          await rt.lua(PARK_SCRIPT);
          await this.settle(rt, space, BLANK_PAGE);
        }
        await rt.lua(navigateScript(page));
        const loads = await this.settle(rt, space, page);
        verify(loads);
        const png = await rt.screenshot(opts);
        const { width, height } = pngSize(png);
        // What landed between the check and the capture is judged too.
        const after = await this.loads(rt, space);
        verify(after.loads);
        return { png, width, height, loaded: after.loads.files.length };
      } finally {
        await rt.lua(RESTORE_SCRIPT).catch(() => {});
      }
    });
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
        };
        const t1 = Date.now();
        const { warnings, rebooted } = await this.ensureIndex(handle, rt, space);
        const indexWaitMs = Date.now() - t1;
        const out = await fn(handle);
        log.info("render", { user: user.user, space, queuedMs, indexWaitMs, rebooted, loaded: (out as { loaded?: number }).loaded, ms: Date.now() - t0 });
        return { ...out, queuedMs, indexWaitMs, rebooted, warnings, runtime: rt };
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

/** Width and height of a PNG from its IHDR chunk; throws when the bytes are not a PNG. */
export function pngSize(png: Buffer): { width: number; height: number } {
  const signature = "89504e470d0a1a0a";
  if (png.length < 24 || png.subarray(0, 8).toString("hex") !== signature) throw new Error("the runtime did not return a PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
