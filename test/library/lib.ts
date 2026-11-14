// Helpers for the tests of the Proposals library (library/): they drive the
// library in dora's runtime for the space delta, where the bootstrap installs
// the page `npm run build:library` writes. Proposal pages are written with
// src/proposal.ts, as the server's tools will write them.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sb, T, S, sleep, until } from "../lib/env.ts";
import { luaString } from "../lib/lua.ts";
import { formatProposal, type Proposal } from "../../src/proposal.ts";
import { buildLibrary, LIBRARY_PAGE } from "../../scripts/build-library.ts";

export { luaString, sleep, until };

/** Runs a Lua script as dora in delta; throws on an error. */
export async function lua<V = unknown>(script: string): Promise<V> {
  const r = await sb.lua(T.dora, S.delta, script);
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

/**
 * Writes a proposal page as the server's tools write it, and waits until the
 * index lists it. The client indexes a page when it saves it; once in CI the
 * row was missing for 20 s. Suspected cause (not reproduced): a delete event
 * of an earlier test's page of the same name arrives late and drops the new
 * row. The wait is on the row; a page the index still lacks after a few
 * seconds is written again, which indexes it again. Every repeat is reported
 * on stderr, so that the log of a green run shows the race whenever it happens.
 */
export async function writeProposal(name: string, proposal: Proposal) {
  const text = formatProposal(proposal);
  for (let attempt = 1; ; attempt++) {
    await writePage(name, text);
    const last = attempt === ATTEMPTS;
    if (await indexed([name], last ? 20000 : 6000, false)) return;
    const state = await indexState([name]);
    if (last) assert.fail(`the index does not list ${name} (${state})`);
    console.error(`writeProposal: ${name} not listed by the index after write ${attempt} of ${ATTEMPTS}, writing it again (${state})`);
  }
}

const ATTEMPTS = 3;

/** What the index lists of the proposal pages, and whether the files of `names` exist, as one line for a diagnostic. */
async function indexState(names: string[]): Promise<string> {
  const listed = await lua<string[]>(`local out = {} for _, p in ipairs(query[[from p = index.tag "change-proposal" where p.tag == "page" select p.name]]) do table.insert(out, p) end return out`);
  const files = await Promise.all(names.map(async (n) => `${n}: ${(await readPage(n)) === null ? "no file" : "file exists"}`));
  return `the index lists ${JSON.stringify(listed)}; ${files.join(", ")}`;
}

/** Waits until the index knows every one of these proposal pages; with `fail` it throws, saying what the index holds, otherwise it returns false. */
export async function indexed(names: string[], timeoutMs = 20000, fail = true): Promise<boolean> {
  const list = `{${names.map((n) => luaString(n)).join(",")}}`;
  const { value } = await until(
    () =>
      lua<boolean>(`local want = ${list}
local have = {}
for _, p in ipairs(query[[from p = index.tag "change-proposal" where p.tag == "page" select p.name]]) do have[p] = true end
for _, n in ipairs(want) do if not have[n] then return false end end
return true`),
    timeoutMs,
    300,
  );
  if (value) return true;
  if (fail) assert.fail(`the index does not list ${names.join(", ")} (${await indexState(names)})`);
  return false;
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
  assert.ok(value !== undefined && value !== null, `nothing matches ${selector}`);
  return value;
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
