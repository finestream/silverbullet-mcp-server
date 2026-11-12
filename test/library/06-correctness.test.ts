// A proposal written again under the name of a closed one, a batch finished
// elsewhere, going on from a proposal that is gone, and what the formatted
// view shows of code blocks and tables.

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { REVISION } from "../../src/proposal-cases.ts";
import { clean, click, configure, currentPage, forget, freshRuntime, indexed, lua, open, removePage, revisionOf, shown, until, writePage, writeProposal } from "./lib.ts";
import { formatProposal } from "../../src/proposal.ts";

test.before(async () => {
  await freshRuntime();
});

beforeEach(async () => {
  await clean();
  await configure({ afterLast: "T/Done" });
});

const page = (want: string) => until(async () => (await currentPage()) === want, 15000, 300);
const position = () => shown(".proposals-position");
const names = async () => Object.values(await lua<Record<string, string>>(`local out = {} for _, e in ipairs(proposals.entries()) do table.insert(out, e.name) end return out`));

/** Proposals that each delete a page of their own, so they never go stale. */
async function deletes(group: string | undefined, list: string[]) {
  for (const n of list) {
    const target = `T/${n.slice(2)}`;
    await writePage(target, "x\n");
    await writePage(n, formatProposal({ action: "delete", target, revision: await revisionOf("x\n"), group, reason: "" }));
  }
  await indexed(list);
}

test("correctness: a proposal written under the name of a closed one is a new, open proposal", async () => {
  await deletes(undefined, ["P/again"]);
  assert.equal(await lua(`return (proposals.apply("P/again", {unbound = true}))`), true);
  assert.equal((await names()).length, 0);
  await deletes(undefined, ["P/again"]);
  const { value } = await until(async () => (await names()).includes("P/again"), 15000, 300);
  assert.ok(value, "the new proposal is listed");
  assert.equal(await lua(`return proposals.read("P/again").outcome`), "open");
  await open("review:P/again", ".proposals-header");
  await click(".proposals-header", "Apply");
  await page("T/Done");
});

test("correctness: a batch finished in another browser is forgotten; the next batch of the group counts from 1", async () => {
  const first = ["P/g7 a", "P/g7 b", "P/g7 c"];
  await deletes("7", first);
  await forget("7", first);
  assert.equal(await lua(`return (proposals.apply("P/g7 a", {unbound = true}))`), true);
  for (const n of first.slice(1)) await removePage(n); // closed elsewhere
  await until(async () => (await names()).length === 0, 20000, 300);
  const next = ["P/g7 d", "P/g7 e"];
  await deletes("7", next);
  await open("review:P/g7 d", ".proposals-position");
  await until(async () => (await position()) === "1 / 2", 5000, 300);
  assert.equal(await position(), "1 / 2");
  assert.deepEqual(await lua(`local m = clientStore.get(proposals.batchKey("7")) return m and true or false`), false);
});

test("correctness: Go on from a closed proposal stays in its group", async () => {
  await deletes("8", ["P/g8 1", "P/g8 2"]);
  await deletes(undefined, ["P/u"]);
  assert.equal(await lua(`return (proposals.apply("P/g8 1", {unbound = true}))`), true);
  assert.match(await open("review:P/g8 1", ".proposals-notice"), /This proposal is applied/);
  assert.equal(await position(), "1 / 2", "the closed proposal still counts in its group");
  assert.match(await shown(".proposals-navigation"), /group 8/);
  await click(".proposals-header", "Go on");
  const { value } = await page("review:P/g8 2");
  assert.ok(value, `went to ${await currentPage()}`);
});

test("correctness: Go on from a page that is no proposal opens the first of the list", async () => {
  await deletes("8", ["P/g8 1"]);
  await writePage("P/broken", "---\ntags: change-proposal\nformat: 0\n---\n");
  assert.match(await open("review:P/broken", ".proposals-notice"), /not a proposal that can be reviewed: format 0/);
  await click(".proposals-header", "Go on");
  const { value } = await page("review:P/g8 1");
  assert.ok(value, `went to ${await currentPage()}`);
});

test("correctness: a changed code block is shown whole, its lines are not read as headings", async () => {
  const target = "Intro\n\n```lua\n# not a heading\n\nx = 1\n```\n\nOutro\n";
  await writePage("T/Code", target);
  await writeProposal("P/code", { action: "edit", target: "T/Code", revision: await revisionOf(target), reason: "", edits: [{ oldText: "x = 1", newText: "x = 2", expectedMatches: 1 }] });
  await open("review:P/code", ".proposals-formatted");
  const r = await lua<{ headings: number; pre: string[] }>(`local box = js.window.document.querySelector(".proposals-formatted")
local pres = box.querySelectorAll("pre")
local out = {}
for i = 1, pres.length do table.insert(out, pres[i].textContent) end
return {headings = box.querySelectorAll("h1").length, pre = out}`);
  assert.equal(r.headings, 0);
  assert.equal(r.pre.length, 2, JSON.stringify(r.pre));
  assert.match(r.pre[0], /# not a heading\s*x = 1/);
  assert.match(r.pre[1], /# not a heading\s*x = 2/);
});

test("correctness: a changed table header is shown, the table removed and added", async () => {
  const target = "| a | b |\n|---|---|\n| 1 | 2 |\n";
  await writePage("T/Table", target);
  await writeProposal("P/table", { action: "edit", target: "T/Table", revision: await revisionOf(target), reason: "", edits: [{ oldText: "| a | b |", newText: "| a | c |", expectedMatches: 1 }] });
  await open("review:P/table", ".proposals-formatted");
  const heads = await lua<string[]>(`local out = {}
local ths = js.window.document.querySelectorAll(".proposals-formatted thead")
for i = 1, ths.length do table.insert(out, ths[i].textContent) end
return out`);
  assert.deepEqual(heads.map((h) => h.replace(/\s+/g, "")), ["ab", "ac"]);
});

test("correctness: the format number of the library is the one src/proposal.ts writes", async () => {
  const page = formatProposal({ action: "delete", target: "T/x", revision: REVISION, reason: "" });
  assert.match(page, /\nformat: (\d+)\n/);
  assert.equal(await lua(`return proposals.format`), Number(/\nformat: (\d+)\n/.exec(page)?.[1]));
});
