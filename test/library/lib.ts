// Helpers for the tests of the Proposals library (library/): they drive the
// library in dora's runtime for the space delta, where the bootstrap installs
// the page `npm run build:library` writes. Proposal pages are written with
// src/proposal.ts, as the server's tools will write them.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { sb, T, S, sleep, until } from "../lib/env.ts";
import { luaString } from "../lib/lua.ts";
import { formatProposal, type Proposal } from "../../src/proposal.ts";
import { buildLibrary, LIBRARY_PAGE } from "../../scripts/build-library.ts";
import { current } from "../instance.ts";

export { luaString, sleep, until };

/** Runs a Lua script as dora in delta; throws on an error. */
export async function lua<V = unknown>(script: string, timeoutSec?: number): Promise<V> {
  const r = await sb.lua(T.dora, S.delta, script, timeoutSec);
  if (r.status !== 200 || r.error !== undefined) throw new Error(`Lua failed (${r.status}): ${r.error ?? r.raw}\n${script}`);
  return r.result as V;
}

/**
 * Installs the library as `npm run build:library` builds it now, restarts the
 * runtimes, so that it is the one loaded (a running client keeps its Lua),
 * and waits until it answers with the version of package.json.
 */
export async function freshRuntime() {
  const page = buildLibrary();
  const w = await sb.write(T.admin, S.delta, `${LIBRARY_PAGE}.md`, page);
  assert.ok([200, 201, 204].includes(w.status), `installing the library: ${w.status}`);
  // A reset now and then leaves the runtime "not ready" for minutes; a second reset brings it back.
  await sb.lua(T.dora, S.delta, `editor.navigate({kind = "page", page = "index"}) return true`, 10).catch(() => undefined);
  for (let attempt = 1; ; attempt++) {
    await sb.admin.resetRuntimes(T.admin);
    try {
      await sb.runtimeReady(T.dora, S.delta, 45000);
      break;
    } catch (e) {
      if (attempt === 3) throw e;
    }
  }
  const expected = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;
  const { value } = await until(async () => (await sb.lua(T.dora, S.delta, "return proposals and proposals.version")).result === expected, 60000, 500);
  assert.ok(value, `the library in delta does not answer version ${expected}`);
}

/**
 * Writes a page as dora, through her client: the client's index learns about
 * a page written through the file API only when it syncs, which can take
 * longer than a test should wait.
 */
export async function writePage(name: string, text: string) {
  await lua(`space.writePage(${luaString(name)}, ${luaString(text)}) return true`);
}

export async function readPage(name: string): Promise<string | null> {
  const r = await sb.read(T.dora, S.delta, `${name}.md`);
  return r.status === 200 ? r.text : null;
}

export async function removePage(name: string) {
  await sb.remove(T.dora, S.delta, `${name}.md`);
}

/** The revision of a page text as the server reports it. */
export async function revisionOf(text: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return "sha256:" + createHash("sha256").update(text).digest("hex");
}

/** Writes a proposal page as the server's tools write it, and waits until the index lists it. */
export async function writeProposal(name: string, proposal: Proposal) {
  await writePage(name, formatProposal(proposal));
  await indexed([name]);
}

/**
 * SilverBullet indexes a page in the background (its docs: "can lag a few
 * seconds"). The client queues a page it writes for indexing only when no other
 * space operation is in flight; a write that overlaps one waits for the next
 * file listing, a minute while the event stream is healthy. This is what
 * `index.awaitPendingChanges()` does where SilverBullet has it (after 2.12.1):
 * list the files, which queues every change the client has not seen, and wait
 * until the index queue is empty. A listing asked for while other operations
 * run is deferred until they end, so the waits below run it before every check.
 */
const PENDING = `if index.awaitPendingChanges then index.awaitPendingChanges() else space.listFiles() mq.awaitEmptyQueue("indexQueue") end`;

/** One attempt of a wait, kept for the diagnostic of a wait that fails: when it started and how long the listing and the check took. */
type Attempt = { at: number; ms: number };

/** Runs `script` after SilverBullet's listing until `done` holds for its result or `timeoutMs` has passed; returns whether it held, the last result and every attempt. */
async function afterListing<V>(script: string, done: (value: V) => boolean, timeoutMs: number): Promise<{ held: boolean; value: V; attempts: Attempt[] }> {
  const t0 = Date.now();
  const attempts: Attempt[] = [];
  for (;;) {
    const at = Date.now() - t0;
    const value = await lua<V>(`${PENDING}\n${script}`, 10);
    const ms = Date.now() - t0 - at;
    if (done(value)) return { held: true, value, attempts };
    attempts.push({ at, ms });
    if (Date.now() - t0 >= timeoutMs) return { held: false, value, attempts };
    await sleep(300);
  }
}

/** The index queue's counts as one string; never throws, since it only serves a diagnostic. */
async function queueStats(): Promise<string> {
  try {
    return JSON.stringify(await lua(`return mq.getQueueStats("indexQueue")`, 5));
  } catch (e) {
    return `unknown (${e instanceof Error ? e.message.split("\n")[0] : e})`;
  }
}

/** The last lines of the SilverBullet container's log, or why there are none. */
function containerLog(lines = 30): string {
  const container = process.env.SB_CONTAINER ?? current().container;
  try {
    return execFileSync("docker", ["logs", "--tail", String(lines), container], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trimEnd();
  } catch (e) {
    return `no log from container ${container}: ${e instanceof Error ? e.message.split("\n")[0] : e}`;
  }
}

/**
 * What the index lists of the proposal pages, whether the files of `names`
 * exist and what SilverBullet's listing returns for them, the index queue, the
 * attempts of the wait and the end of the container's log, for a wait that failed.
 */
async function indexState(names: string[], attempts: Attempt[] = []): Promise<string> {
  const listed = await lua<string[]>(`local out = {} for _, p in ipairs(query[[from p = index.tag "change-proposal" where p.tag == "page" select p.name]]) do table.insert(out, p) end return out`);
  const files = await Promise.all(names.map(async (n) => `${n}: ${(await readPage(n)) === null ? "no file" : "file exists"}`));
  const listing = await lua<unknown>(`local want, out = {${names.map((n) => luaString(`${n}.md`)).join(",")}}, {}
for _, f in ipairs(space.listFiles()) do for _, n in ipairs(want) do if f.name == n then table.insert(out, f) end end end
return out`, 10).catch((e) => `the listing failed: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  const tries = attempts.map((a) => `+${a.at}ms, took ${a.ms}ms`).join("\n  ");
  return `the index lists ${JSON.stringify(listed)}; ${files.join(", ")}
SilverBullet's listing of ${names.join(", ")}: ${JSON.stringify(listing)}
index queue now: ${await queueStats()}
${attempts.length} attempts (start, duration):\n  ${tries}
container log (tail):\n${containerLog()}`;
}

/** Waits until the index knows every one of these proposal pages; fails, saying what the index holds. */
export async function indexed(names: string[], timeoutMs = 20000) {
  const list = `{${names.map((n) => luaString(n)).join(",")}}`;
  const { held, attempts } = await afterListing<boolean>(
    `local want = ${list}
local have = {}
for _, p in ipairs(query[[from p = index.tag "change-proposal" where p.tag == "page" select p.name]]) do have[p] = true end
for _, n in ipairs(want) do if not have[n] then return false end end
return true`,
    (v) => v === true,
    timeoutMs,
  );
  if (!held) assert.fail(`the index does not list ${names.join(", ")} (${await indexState(names, attempts)})`);
}

/**
 * Waits until the library's list of open proposals holds `name`, as its first
 * entry with `first`: what Apply and Go on read when they are clicked. Fails,
 * saying what the list and the index hold.
 */
export async function listed(name: string, first = false, timeoutMs = 20000) {
  // An empty Lua table comes back as {}, not []
  const names = (v: unknown) => Object.values((v ?? {}) as Record<string, string>);
  const { held, value, attempts } = await afterListing<unknown>(
    `local out = {} for _, e in ipairs(proposals.entries()) do table.insert(out, e.name) end return out`,
    (v) => (first ? names(v)[0] === name : names(v).includes(name)),
    timeoutMs,
  );
  if (!held) assert.fail(`${name} is not ${first ? "the first" : "one"} of the open proposals: the list holds ${JSON.stringify(names(value))}; ${await indexState([name], attempts)}`);
}

/** Forgets what this client remembers of a group's batch and of closed proposals. */
export async function forget(group: string | undefined, names: string[] = []) {
  await lua(`proposals.closed = {}
clientStore.delete(proposals.batchKey(${group === undefined ? "nil" : luaString(group)}))
for _, n in ipairs({${names.map((n) => luaString(n)).join(",")}}) do clientStore.delete(proposals.copyKey(n)) end
return true`);
}

/** Opens a page in dora's client and waits until `selector` exists in the document; returns its text. */
export async function open(page: string, selector: string): Promise<string> {
  await lua(`editor.navigate({kind = "page", page = ${luaString(page)}}) return true`);
  return shown(selector);
}

/** Waits until `selector` exists in the document; returns its text. */
export async function shown(selector: string, timeoutMs = 15000): Promise<string> {
  const { value } = await until(
    () => lua<string | null>(`local e = js.window.document.querySelector(${luaString(selector)}) return e and e.textContent or nil`),
    timeoutMs,
    300,
  );
  if (value === undefined || value === null) assert.fail(`nothing matches ${selector} (${await documentState()})`);
  return value;
}

/** What the client shows, as one line for a diagnostic: the current page, how many widgets of the library are drawn and the start of the text. */
export async function documentState(): Promise<string> {
  try {
    const s = await lua<string>(`local d = js.window.document
local text = d.body.innerText or ""
return "page " .. editor.getCurrentPage() .. ", " .. d.querySelectorAll(".proposals-review").length .. " review views, text " .. string.format("%q", string.sub(text, 1, 200))`);
    return s;
  } catch (e) {
    return `the client does not answer: ${e instanceof Error ? e.message : e}`;
  }
}

/** The text of the first element that matches `selector`, or null while there is none. */
export async function textOf(selector: string): Promise<string | null> {
  return lua<string | null>(`local e = js.window.document.querySelector(${luaString(selector)}) return e and e.textContent or nil`);
}

/** Clicks the first button with this label inside `selector`. */
export async function click(selector: string, label: string) {
  const ok = await lua<boolean>(`local buttons = js.window.document.querySelectorAll(${luaString(selector + " button")})
for i = 1, buttons.length do
  local b = buttons[i]
  if b.textContent == ${luaString(label)} then b.click() return true end
end
return false`);
  assert.ok(ok, `no button ${label} in ${selector}`);
}

export async function currentPage(): Promise<string> {
  return lua<string>("return editor.getCurrentPage()");
}

/** Deletes every proposal page, working copy and test page (`T/…`) in delta, and forgets the client's state. */
export async function clean() {
  await lua(`for _, p in ipairs(query[[from p = index.tag "page" select p.name]]) do
  if string.startsWith(p, "T/") or string.startsWith(p, "P/") or string.startsWith(p, "Q/") or string.startsWith(p, "Working copies/") then pcall(space.deletePage, p) end
end
proposals.closed = {}
return true`);
  await until(() => lua<boolean>(`return #query[[from p = index.tag "change-proposal" where p.tag == "page"]] == 0`), 20000, 300);
}

/** The proposal folder of the tests. */
export const PROPOSALS = "P/";

/** Sets the library's configuration in this client: the defaults, the tests' proposal folder, and `values`. */
export async function configure(values: Record<string, unknown> = {}) {
  const fields = Object.entries({ proposalPrefix: PROPOSALS, ...values }).map(([k, v]) => `${k} = ${typeof v === "string" ? luaString(v) : String(v)}`);
  await lua(`config.set("proposals", {${fields.join(", ")}}) return true`);
}
