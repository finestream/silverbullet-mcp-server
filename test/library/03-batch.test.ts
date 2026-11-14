// A batch: the counter, Previous and Next, going on after Apply, and the
// list with its groups.

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clean, click, configure, currentPage, documentState, forget, freshRuntime, indexed, lua, open, readPage, revisionOf, textOf, until, writePage } from "./lib.ts";
import { formatProposal } from "../../src/proposal.ts";

test.before(async () => {
  await freshRuntime();
});

beforeEach(async () => {
  await clean();
  await configure();
});

const name = (n: number) => `P/batch ${String(n).padStart(2, "0")}`;
/** Waits until the client shows `want`; fails, saying what it shows instead. */
const page = async (want: string) => {
  const { value } = await until(async () => (await currentPage()) === want, 15000, 300);
  if (!value) assert.fail(`the client does not show ${want} (${await documentState()})`);
};

/** A target with one line per proposal, and `count` proposals of group `group`, each changing its own line. */
async function batch(count: number, group: string, target = "T/Batch") {
  const lines = Array.from({ length: count }, (_, i) => `line ${i + 1}`);
  const text = lines.join("\n\n") + "\n";
  await writePage(target, text);
  const revision = await revisionOf(text);
  const names: string[] = [];
  for (let i = 1; i <= count; i++) {
    const n = group === "other" ? `P/other ${i}` : name(i);
    names.push(n);
    await writePage(n, formatProposal({ action: "edit", target, revision, group, reason: `Change ${i}.`, edits: [{ oldText: `line ${i}\n`, newText: `line ${i} changed\n`, expectedMatches: 1 }] }));
  }
  await indexed(names);
  await forget(group, names);
  return names;
}

const position = () => textOf(".proposals-position");

/** Waits until the counter reads `want`; fails, saying what the client shows instead. */
const counts = async (want: string) => {
  const { value } = await until(async () => (await position()) === want, 15000, 300);
  if (!value) assert.fail(`the counter does not read ${want}: ${JSON.stringify(await position())} (${await documentState()})`);
};

test("batch: with 4 of 20 applied, the 5th shows 5 / 20; Previous and Next skip the closed ones", async () => {
  const names = await batch(20, "20");
  assert.equal(await open(`review:${names[2]}`, ".proposals-position"), "3 / 20", "a batch first opened on its third proposal");
  for (const n of names.slice(0, 4)) assert.deepEqual(await lua(`return {proposals.apply(${JSON.stringify(n)}, {unbound = true})}`).then((r) => (r as unknown[])[0]), true);
  await open(`review:${names[4]}`, ".proposals-review");
  await counts("5 / 20");
  const disabled = await lua<boolean>(`local bs = js.window.document.querySelectorAll(".proposals-navigation button")
return bs[1].disabled`);
  assert.equal(disabled, true, "Previous is greyed out: the four before are applied");
  await click(".proposals-navigation", "Next ›");
  await page(`review:${names[5]}`);
  await counts("6 / 20");
  await click(".proposals-navigation", "‹ Previous");
  await page(`review:${names[4]}`);
});

test("batch: Apply goes on to the next open proposal of the batch, and the counter keeps counting", async () => {
  const names = await batch(3, "3");
  await open(`review:${names[0]}`, ".proposals-position");
  await click(".proposals-header", "Apply");
  await page(`review:${names[1]}`);
  await counts("2 / 3");
  await click(".proposals-header", "Reject");
  await page(`review:${names[2]}`);
  await counts("3 / 3");
  assert.equal(await readPage("T/Batch"), "line 1 changed\n\nline 2\n\nline 3\n");
});

test("batch: after the last of a batch, the next open proposal of the list; after the last of all, afterLast", async () => {
  const names = await batch(1, "3");
  const others = await batch(1, "other", "T/Other");
  await configure({ afterLast: "T/Done" });
  await open(`review:${names[0]}`, ".proposals-position");
  await click(".proposals-header", "Apply");
  await page(`review:${others[0]}`);
  await counts("1 / 1");
  await click(".proposals-header", "Apply");
  await page("T/Done");
  assert.equal(await lua(`return clientStore.get(proposals.batchKey("other"))`), null, "a finished batch is forgotten");
});

test("batch: the list shows the open proposals under their group", async () => {
  await batch(2, "3");
  await writePage("T/List", "Open proposals:\n\n${proposals.list()}\n");
  const text = await open("T/List", ".proposals-list");
  assert.match(text, /2 open proposals/);
  assert.match(text, /Group 3 \(2\)/);
  const rows = await lua<string[]>(`local out = {}
local trs = js.window.document.querySelectorAll(".proposals-list tr.proposals-entry")
for i = 1, trs.length do table.insert(out, trs[i].textContent) end
return out`);
  assert.deepEqual(rows, [`${name(1)}T/Batcheditopen`, `${name(2)}T/Batcheditopen`]);
});

test("batch: groups that are numbers are listed by their value, before the others and those without a group", async () => {
  await writePage("T/Order", "a\n");
  const groups = ["1000", "250", "x", undefined, "99"];
  const names = groups.map((g, i) => `P/order ${i}`);
  for (const [i, g] of groups.entries()) {
    await writePage(names[i], formatProposal({ action: "delete", target: "T/Order", revision: "sha256:0", group: g, reason: "" }));
  }
  await indexed(names);
  assert.deepEqual(await lua(`local out = {} for _, e in ipairs(proposals.entries()) do table.insert(out, e.group or "none") end return out`), ["99", "250", "1000", "x", "none"]);
});

test("batch: the counter comes from the client's store, so it holds after the client forgets what it closed", async () => {
  const names = await batch(6, "6");
  for (const n of names.slice(0, 2)) await lua(`return (proposals.apply(${JSON.stringify(n)}, {unbound = true}))`);
  await lua(`proposals.closed = {} return true`);
  await open(`review:${names[2]}`, ".proposals-review");
  await counts("3 / 6");
});

test("batch: Apply all applies what fits and names the others with their reason", async () => {
  const names = await batch(3, "3");
  await writePage("P/batch 04", formatProposal({ action: "edit", target: "T/Batch", revision: "sha256:0", group: "3", reason: "", edits: [{ oldText: "no such text", newText: "y", expectedMatches: 1 }] }));
  await indexed(["P/batch 04"]);
  const r = await lua<[number, string[]]>(`local names = {${[...names, "P/batch 04"].map((n) => JSON.stringify(n)).join(",")}}
local expects = {}
for _, n in ipairs(names) do expects[n] = proposals.binding(proposals.read(n)) end
local applied, failed = proposals.applyMany(names, expects) return {applied, failed}`);
  assert.equal(r[0], 3);
  assert.deepEqual(r[1], ["P/batch 04 (stale: change 1: the expected text is not in the page)"]);
  assert.equal(await readPage("T/Batch"), "line 1 changed\n\nline 2 changed\n\nline 3 changed\n");
  assert.notEqual(await readPage("P/batch 04"), null, "the stale proposal stays");
});
