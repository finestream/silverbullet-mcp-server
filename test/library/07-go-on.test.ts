// Go on from a page that cannot be reviewed: it never opens that page again,
// nor another one that cannot be reviewed, and it finds a proposal the index
// has not listed yet.

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clean, click, configure, currentPage, documentState, freshRuntime, indexed, lua, luaString, open, revisionOf, until, writePage, writeProposal } from "./lib.ts";
import { formatProposal, type Proposal } from "../../src/proposal.ts";

test.before(async () => {
  await freshRuntime();
});

beforeEach(async () => {
  await clean();
  await configure({ afterLast: "T/Done" });
});

const BROKEN = "---\ntags: change-proposal\nformat: 0\n---\n";

/** A proposal that deletes a page of its own, which this writes, so it never goes stale. */
async function deleting(target: string): Promise<Proposal> {
  await writePage(target, "x\n");
  return { action: "delete", target, revision: await revisionOf("x\n"), reason: "" };
}

/** Clicks Go on in the review of `from` and waits until `want` is shown. */
async function goOn(from: string, want: string) {
  await open(`review:${from}`, ".proposals-header");
  await click(".proposals-header", "Go on");
  const { value } = await until(async () => (await currentPage()) === want, 15000, 300);
  assert.ok(value, `Go on from ${from} went to ${await currentPage()}, not ${want} (${await documentState()})`);
}

test("go on: from a page that cannot be reviewed, the next one that can, never the page itself", async () => {
  await writePage("P/a-broken", BROKEN);
  await writeProposal("P/b", await deleting("T/b"));
  await indexed(["P/a-broken"]);
  assert.deepEqual(await entries(), ["P/a-broken", "P/b"], "the page that cannot be reviewed is the first of the list");
  await goOn("P/a-broken", "review:P/b");
});

test("go on: from the only page that cannot be reviewed, afterLast", async () => {
  await writePage("P/a-broken", BROKEN);
  await indexed(["P/a-broken"]);
  await goOn("P/a-broken", "T/Done");
});

test("go on: two pages that cannot be reviewed never send the reviewer back and forth", async () => {
  await writePage("P/a-broken", BROKEN);
  await writePage("P/c-broken", BROKEN);
  await indexed(["P/a-broken", "P/c-broken"]);
  await goOn("P/a-broken", "T/Done");
  await goOn("P/c-broken", "T/Done");
});

test("go on: finds a proposal written while other operations were in flight, before the index lists it", async () => {
  await writePage("P/a-broken", BROKEN);
  await indexed(["P/a-broken"]);
  await open("review:P/a-broken", ".proposals-header");
  const text = formatProposal(await deleting("T/b"));
  // One script: the write overlaps 30 reads, so SilverBullet queues no indexing for it
  // (only the next file listing finds it); the list is read at once, and Go on clicked.
  const r = await lua<{ listed: boolean; clicked: boolean }>(`js.new(js.window.Promise, function(resolve)
  for i = 1, 30 do js.window.setTimeout(function() pcall(space.readPage, "index") end, 0) end
  js.window.setTimeout(function() space.writePage("P/b", ${luaString(text)}) resolve(true) end, 0)
end)
local listed = false
for _, e in ipairs(proposals.entries()) do if e.name == "P/b" then listed = true end end
local clicked = false
local buttons = js.window.document.querySelectorAll(".proposals-header button")
for i = 1, buttons.length do
  if buttons[i].textContent == "Go on" then buttons[i].click() clicked = true break end
end
return {listed = listed, clicked = clicked}`);
  assert.ok(r.clicked, "no button Go on");
  assert.equal(r.listed, false, "the index listed P/b at once: the write did not overlap, so this test proves nothing");
  // well below the minute after which SilverBullet's periodic listing would find it without the wait
  const { value } = await until(async () => (await currentPage()) === "review:P/b", 10000, 300);
  assert.ok(value, `Go on went to ${await currentPage()} (${await documentState()})`);
});

async function entries() {
  return Object.values(await lua<Record<string, string>>(`local out = {} for _, e in ipairs(proposals.entries()) do table.insert(out, e.name) end return out`));
}
