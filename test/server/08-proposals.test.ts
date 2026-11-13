// The proposal tools (docs/proposals.md, section 4): a proposal made through
// the server is a page that the review library in `library/` lists and
// applies; the checks at creation refuse what could not be applied; and the
// tools are refused where the library is missing or of another version, which
// the report page says (section 6). The library is installed in gamma for
// these tests, where alice has the Runtime API, and runs in alice's runtime.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startServer, connect, BEARERS, DEFAULT_ACCESS_LIST, unique, type RunningServer, type McpClient } from "./harness.ts";
import { sb, T, until } from "../lib/env.ts";
import { luaString } from "../lib/lua.ts";
import { buildLibrary } from "../../scripts/build-library.ts";
import { LIBRARY_PAGE, parseProposal } from "../../src/proposal.ts";

const SPACE = "gamma";
const LIBRARY = `${LIBRARY_PAGE}.md`;
const VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

let server: RunningServer;
let alice: McpClient;
let bob: McpClient;
/** Files the tests create, as `space/file`; removed as admin at the end. */
const created: string[] = [];
const track = (space: string, file: string) => {
  created.push(`${space}/${file}`);
  return file;
};

/** A page in gamma written as admin, outside every folder alice may write; returns its name and alice's revision of it. */
async function target(text: string, folder = "Notes/") {
  const page = `${folder}${unique("Proposal target")}`;
  const w = await sb.write(T.admin, SPACE, track(SPACE, `${page}.md`), text);
  assert.ok([200, 201, 204].includes(w.status), `writing ${page}: ${w.status}`);
  const r = await alice.call("read-note", { space: SPACE, filename: page });
  assert.equal(r.isError, false, r.text);
  return { page, revision: r.data!.revision as string };
}

/** A proposal name, tracked for the clean-up. */
const proposalName = (what: string) => {
  const name = unique(what);
  track(SPACE, `Proposals/${name}.md`);
  return name;
};

const lua = async <V>(script: string): Promise<V> => {
  const r = await sb.lua(T.alice, SPACE, script);
  if (r.status !== 200 || r.error !== undefined) throw new Error(`Lua failed (${r.status}): ${r.error ?? r.raw}`);
  return r.result as V;
};

/**
 * Restarts the runtimes, so that alice's loads the library just installed. A reset now and then
 * leaves the runtime "not ready" for minutes; a second reset brings it back (as test/library/lib.ts does).
 */
async function freshRuntime() {
  for (let attempt = 1; ; attempt++) {
    await sb.admin.resetRuntimes(T.admin);
    try {
      await sb.runtimeReady(T.alice, SPACE, 45000);
      return;
    } catch (e) {
      if (attempt === 3) throw e;
    }
  }
}

before(async () => {
  const w = await sb.write(T.admin, SPACE, LIBRARY, buildLibrary());
  assert.ok([200, 201, 204].includes(w.status), `installing the library: ${w.status}`);
  await sb.remove(T.admin, "alpha", LIBRARY);
  server = await startServer({ accessList: DEFAULT_ACCESS_LIST + "alice gamma Proposals/ rw\nalice alpha Proposals/ rw\nalice gamma Hidden/ -\n" });
  alice = await connect(server.url, BEARERS.alice);
  bob = await connect(server.url, BEARERS.bob);
});

after(async () => {
  await Promise.all([alice?.close(), bob?.close()]);
  await server?.stop();
  for (const f of created) await sb.remove(T.admin, f.slice(0, f.indexOf("/")), f.slice(f.indexOf("/") + 1));
  await sb.remove(T.admin, SPACE, LIBRARY);
  await sb.remove(T.admin, "alpha", LIBRARY);
});

test("propose-edit: writes a proposal page that the library lists and applies, and leaves the target alone", async () => {
  const text = "# Garden\n\nWater in the evening.\n\n* a line\n";
  const { page, revision } = await target(text);
  const name = proposalName("Water earlier");
  const edits = [
    { oldText: "in the evening", newText: "early in the morning", expectedMatches: 1 },
    { oldText: "* a line\n", newText: "", expectedMatches: 1 },
  ];
  const r = await alice.call("propose-edit", { space: SPACE, filename: page, expectedRevision: revision, edits, reason: "Watering moved.", name, group: "7" });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data!.proposal, `Proposals/${name}`);
  assert.match(r.data!.diff, /-Water in the evening\.\n\+Water early in the morning\./, "the diff comes back as edit-note's dry run gives it");
  assert.match(r.data!.diff, /-\* a line/);
  assert.equal((await sb.read(T.admin, SPACE, `${page}.md`)).text, text, "the target is not written");
  const stored = parseProposal((await sb.read(T.admin, SPACE, `Proposals/${name}.md`)).text);
  assert.deepEqual(stored, { action: "edit", target: page, revision, reason: "Watering moved.", group: "7", edits });

  // The library, in alice's runtime: it lists the proposal and applies it with alice's SilverBullet rights.
  await freshRuntime();
  const loaded = await until(async () => (await sb.lua(T.alice, SPACE, "return proposals and proposals.version")).result === VERSION, 60000, 500);
  assert.ok(loaded.value, `the library in ${SPACE} does not answer version ${VERSION}`);
  const listed = await until(
    () => lua<boolean>(`for _, e in ipairs(proposals.entries()) do if e.name == ${luaString(`Proposals/${name}`)} then return e.target == ${luaString(page)} and e.action == "edit" and e.group == "7" end end return false`),
    30000,
    500,
  );
  assert.ok(listed.value, "the library lists the proposal with its target, action and group");
  const applied = await lua<boolean>(`return (proposals.apply(${luaString(`Proposals/${name}`)}, {unbound = true}))`);
  assert.equal(applied, true, "the proposal applies");
  assert.equal((await sb.read(T.admin, SPACE, `${page}.md`)).text, "# Garden\n\nWater early in the morning.\n\n");
});

test("propose-delete and propose-move: the proposal pages carry the action, the revision and the new name", async () => {
  const del = await target("Old.\n");
  const dName = proposalName("Delete old");
  const d = await alice.call("propose-delete", { space: SPACE, filename: del.page, expectedRevision: del.revision, reason: "Replaced.", name: dName });
  assert.equal(d.isError, false, d.text);
  assert.match(d.data!.diff, /-Old\./);
  assert.deepEqual(parseProposal((await sb.read(T.admin, SPACE, `Proposals/${dName}.md`)).text), { action: "delete", target: del.page, revision: del.revision, reason: "Replaced." });

  const mov = await target("New.\n");
  const to = `Notes/${unique("Moved")}`;
  const mName = proposalName("Move new");
  const m = await alice.call("propose-move", { space: SPACE, filename: mov.page, newName: to, expectedRevision: mov.revision, reason: "Ready.", name: mName, group: "g" });
  assert.equal(m.isError, false, m.text);
  assert.deepEqual(parseProposal((await sb.read(T.admin, SPACE, `Proposals/${mName}.md`)).text), { action: "move", target: mov.page, to, revision: mov.revision, reason: "Ready.", group: "g" });
  assert.equal((await sb.read(T.admin, SPACE, `${mov.page}.md`)).status, 200, "the target stays where it is");
});

test("propose-*: what could not be applied, or needs no proposal, is refused and nothing is written", async () => {
  const { page, revision } = await target("one\n\none\n\ntwo\n");
  const hidden = await sb.write(T.admin, SPACE, track(SPACE, "Hidden/Existing.md"), "secret\n");
  assert.ok([200, 201, 204].includes(hidden.status));
  const edit = (args: Record<string, unknown>) => alice.call("propose-edit", { space: SPACE, filename: page, expectedRevision: revision, reason: "r", name: proposalName("Refused"), edits: [{ oldText: "two", newText: "three" }], ...args });
  const cases: Array<[string, Promise<{ isError: boolean; text: string }>, RegExp]> = [
    ["a stale revision", edit({ expectedRevision: "sha256:" + "0".repeat(64) }), /Revision conflict: .* Nothing was proposed\./],
    ["an old text that is not there", edit({ edits: [{ oldText: "four", newText: "x" }] }), /expected 1 exact match\(es\), found 0\. Nothing was proposed\./],
    ["an old text found more often than expected", edit({ edits: [{ oldText: "one", newText: "x" }] }), /found more than expected/],
    ["overlapping edits", edit({ edits: [{ oldText: "two", newText: "x" }, { oldText: "tw", newText: "y" }] }), /overlap/],
    ["a result with code", edit({ edits: [{ oldText: "two", newText: "```space-lua\nx = 1\n```" }] }), /Refused by the write filter: .*\. Nothing was proposed\. Pages outside/],
    ["an empty reason", edit({ reason: "" }), /The reason is empty; .* Nothing was proposed\./],
    ["a blank reason", edit({ reason: " \n\t " }), /The reason is empty/],
    ["edits that change nothing", edit({ edits: [{ oldText: "two", newText: "two" }] }), /change nothing/],
    ["a target in the proposal folder", edit({ filename: "Proposals/Some proposal" }), /lies in the proposal folder/],
    ["a target among the working copies", edit({ filename: "Working copies/Some proposal" }), /folder of the working copies/],
    ["a target in Library/", edit({ filename: LIBRARY_PAGE }), /CONFIG or lies in Library\//],
    ["the report page as target", edit({ filename: "MCP Server" }), /is the server's report page/],
    ["a proposal name with a file extension", edit({ name: "x.csv" }), /ends in a file extension/],
    ["a move into Library/", alice.call("propose-move", { space: SPACE, filename: page, newName: "Library/Moved", expectedRevision: revision, reason: "r", name: proposalName("Refused") }), /CONFIG or lies in Library\//],
    ["a move onto a page that exists", alice.call("propose-move", { space: SPACE, filename: page, newName: "index", expectedRevision: revision, reason: "r", name: proposalName("Refused") }), /exists already; a move cannot replace a page/],
    ["a move into the proposal folder", alice.call("propose-move", { space: SPACE, filename: page, newName: "Proposals/Moved", expectedRevision: revision, reason: "r", name: proposalName("Refused") }), /lies in the proposal folder/],
    ["a move onto a page the user may not read", alice.call("propose-move", { space: SPACE, filename: page, newName: "Hidden/Existing", expectedRevision: revision, reason: "r", name: proposalName("Refused") }), /Denied by the access list: user "alice" has no "r" on gamma\/Hidden\/Existing/],
    ["a move to a free name the user may not read", alice.call("propose-move", { space: SPACE, filename: page, newName: "Hidden/Free", expectedRevision: revision, reason: "r", name: proposalName("Refused") }), /Denied by the access list: user "alice" has no "r" on gamma\/Hidden\/Free/],
    ["no w where proposals live", bob.call("propose-edit", { space: SPACE, filename: page, expectedRevision: revision, reason: "r", name: proposalName("Refused"), edits: [{ oldText: "two", newText: "x" }] }), /Denied by the access list: user "bob" has no "w" on gamma\/Proposals\//],
  ];
  for (const [what, call, expected] of cases) {
    const r = await call;
    assert.equal(r.isError, true, `${what}: ${r.text}`);
    assert.match(r.text, expected, what);
  }
  const own = await sb.write(T.admin, SPACE, track(SPACE, "Projects/Proposal own.md"), "mine\n");
  assert.ok([200, 201, 204].includes(own.status));
  const ownRevision = (await alice.call("read-note", { space: SPACE, filename: "Projects/Proposal own" })).data!.revision;
  const r = await alice.call("propose-edit", { space: SPACE, filename: "Projects/Proposal own", expectedRevision: ownRevision, reason: "r", name: proposalName("Own"), edits: [{ oldText: "mine", newText: "x" }] });
  assert.equal(r.isError, true);
  assert.match(r.text, /has "w" on gamma\/Projects\/Proposal own and makes this change itself: use edit-note/);

  const taken = proposalName("Taken");
  assert.equal((await edit({ name: taken })).isError, false);
  const again = await edit({ name: taken });
  assert.equal(again.isError, true);
  assert.match(again.text, /A proposal named Proposals\/.* exists already in gamma; choose another name/);

  const listed = (await sb.read(T.admin, SPACE, `${page}.md`)).text;
  assert.equal(listed, "one\n\none\n\ntwo\n", "no refusal wrote the target");
});

test("without the library, or with another version, only the proposal tools are refused, and the report page says so", async () => {
  const page = `Projects/${unique("Proposal alpha")}`;
  assert.equal((await alice.call("create-note", { filename: track("alpha", `${page}.md`), content: "x\n" })).isError, false, "writing goes on");
  const revision = (await alice.call("read-note", { filename: page })).data!.revision;
  const propose = () => alice.call("propose-delete", { filename: page, expectedRevision: revision, reason: "r", name: proposalName("Alpha") });
  const missing = await propose();
  assert.equal(missing.isError, true);
  assert.match(missing.text, /The proposal tools are unavailable in space "alpha": the library is not installed \(no page Library\/Finestream\/Proposals\)/);
  assert.match((await sb.read(T.admin, "alpha", "MCP Server.md")).text, /\* Proposals library: \*\*proposal tools unavailable\*\*: `the library is not installed/);
  assert.match((await sb.read(T.admin, SPACE, "MCP Server.md")).text, new RegExp(`\\* Proposals library: version ${VERSION.replace(/\./g, "\\.")}, proposal tools available`));

  await sb.write(T.admin, "alpha", LIBRARY, `---\nname: "${LIBRARY_PAGE}"\ntags: meta/library\nversion: "0.0.1"\nproposalFormat: 1\n---\n# Proposals\n`);
  await server.rescan();
  const other = await propose();
  assert.equal(other.isError, true);
  assert.match(other.text, new RegExp(`is version 0\\.0\\.1, the server ${VERSION.replace(/\./g, "\\.")}`));
  assert.match((await sb.read(T.admin, "alpha", "MCP Server.md")).text, /proposal tools unavailable\*\*: `the library at Library\/Finestream\/Proposals is version 0\.0\.1/);
});

test("the proposal page is never the report page, also when the report page lies in the proposal folder", async () => {
  const s = await startServer({ accessList: DEFAULT_ACCESS_LIST + "alice gamma Proposals/ rw\n", env: { MCP_REPORT_PAGE: "Proposals/Report" } });
  const a = await connect(s.url, BEARERS.alice);
  try {
    const { page, revision } = await target("x\n");
    const before = (await sb.read(T.admin, SPACE, "Proposals/Report.md")).text;
    const r = await a.call("propose-delete", { space: SPACE, filename: page, expectedRevision: revision, reason: "r", name: "Report" });
    assert.equal(r.isError, true);
    assert.match(r.text, /"Proposals\/Report" is the server's report page/);
    assert.equal((await sb.read(T.admin, SPACE, "Proposals/Report.md")).text, before, "the report page is unchanged");
  } finally {
    await a.close();
    await s.stop();
    for (const space of ["alpha", "beta", "gamma"]) await sb.remove(T.admin, space, "Proposals/Report.md");
  }
});
