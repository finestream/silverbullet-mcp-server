// Going on: never to the page it is on, nor to one that cannot be reviewed; it
// finds a proposal the index has not listed yet and passes one it still holds as
// open;
// a second click while it runs is ignored.

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clean, click, configure, currentPage, documentState, freshRuntime, indexed, lua, luaString, open, readPage, revisionOf, until, writePage, writeProposal } from "./lib.ts";
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

/**
 * In one script: writes `text` to `name` while 30 reads are in flight, so SilverBullet
 * queues no indexing for it (only the next file listing finds it), then clicks Go on at
 * once, unless the list already shows the write (the entry is listed when `listed` is
 * true, gone otherwise): a write that did not overlap proves nothing. Returns whether
 * it clicked.
 */
async function overlappedThenGoOn(name: string, text: string, listed: boolean): Promise<boolean> {
  const r = await lua<{ seen: boolean; clicked: boolean }>(`js.new(js.window.Promise, function(resolve)
  for i = 1, 30 do js.window.setTimeout(function() pcall(space.readPage, "index") end, 0) end
  js.window.setTimeout(function() space.writePage(${luaString(name)}, ${luaString(text)}) resolve(true) end, 0)
end)
local found = false
for _, e in ipairs(proposals.entries()) do if e.name == ${luaString(name)} then found = true end end
if found == ${listed ? "true" : "false"} then return {seen = true, clicked = false} end
local buttons = js.window.document.querySelectorAll(".proposals-header button")
for i = 1, buttons.length do
  if buttons[i].textContent == "Go on" then buttons[i].click() return {seen = false, clicked = true} end
end
return {seen = false, clicked = false}`);
  if (r.seen) {
    console.error(`the list showed the write to ${name} at once; trying again`);
    return false;
  }
  assert.ok(r.clicked, "no button Go on");
  return true;
}

test("go on: finds a proposal written while other operations were in flight, before the index lists it", async () => {
  await writePage("P/a-broken", BROKEN);
  await indexed(["P/a-broken"]);
  await open("review:P/a-broken", ".proposals-header");
  let written: string | undefined;
  for (let attempt = 1; attempt <= 5 && written === undefined; attempt++) {
    const name = `P/b${attempt}`;
    if (await overlappedThenGoOn(name, formatProposal(await deleting(`T/b${attempt}`)), true)) {
      written = name;
    } else {
      await lua(`space.deletePage(${luaString(name)}) return true`);
      const { value } = await until(async () => !(await entries()).includes(name), 15000, 300);
      assert.ok(value, `${name} is still listed after its deletion`);
    }
  }
  assert.ok(written, "in 5 attempts the write never overlapped other operations");
  // well below the minute after which SilverBullet's periodic listing would find it without the wait
  const { value } = await until(async () => (await currentPage()) === `review:${written}`, 10000, 300);
  assert.ok(value, `Go on went to ${await currentPage()}, not review:${written} (${await documentState()})`);
});

test("go on: after Apply, the next proposal that can be reviewed, past one that cannot", async () => {
  await writeProposal("P/a", await deleting("T/a"));
  await writePage("P/b-broken", BROKEN);
  await writeProposal("P/c", await deleting("T/c"));
  await indexed(["P/a", "P/b-broken", "P/c"]);
  assert.deepEqual(await entries(), ["P/a", "P/b-broken", "P/c"]);
  await open("review:P/a", ".proposals-header");
  await click(".proposals-header", "Apply");
  const { value } = await until(async () => (await currentPage()) === "review:P/c", 15000, 300);
  assert.ok(value, `Apply went to ${await currentPage()}, not review:P/c (${await documentState()})`);
});

test("go on: a second click while Apply and its go-on run is ignored", async () => {
  await writeProposal("P/a", await deleting("T/a"));
  await writeProposal("P/c", await deleting("T/c"));
  await open("review:P/a", ".proposals-header");
  const clicks = await lua<number>(`proposals.flashed = {}
editor.flashNotification = function(message) table.insert(proposals.flashed, message) end
proposals.applies = 0
proposals.unwrapped = proposals.unwrapped or proposals.apply
proposals.apply = function(...) proposals.applies = proposals.applies + 1 return proposals.unwrapped(...) end
local clicks = 0
local buttons = js.window.document.querySelectorAll(".proposals-header button")
for i = 1, buttons.length do
  if buttons[i].textContent == "Apply" then buttons[i].click() buttons[i].click() clicks = 2 end
end
return clicks`);
  assert.equal(clicks, 2, "no button Apply");
  const { value } = await until(async () => (await currentPage()) === "review:P/c", 15000, 300);
  assert.ok(value, `Apply went to ${await currentPage()}, not review:P/c (${await documentState()})`);
  assert.equal(await readPage("T/a"), null, "the first click applied P/a");
  assert.equal(await readPage("T/c"), "x\n", "P/c is untouched");
  assert.deepEqual(await lua(`return proposals.flashed`), {}, "the second click did nothing, no error");
  assert.equal(await lua(`proposals.apply = proposals.unwrapped return proposals.applies`), 1, "the second click applied nothing");
});

test("go on: a proposal closed in a write the index has not seen yet is not opened", async () => {
  await writePage("P/a-broken", BROKEN);
  await indexed(["P/a-broken"]);
  await open("review:P/a-broken", ".proposals-header");
  // closed as with deleteClosed = false, in place: the index still holds it as open
  let closed = false;
  for (let attempt = 1; attempt <= 5 && !closed; attempt++) {
    const name = `P/b${attempt}`;
    const proposal = await deleting(`T/b${attempt}`);
    await writeProposal(name, proposal);
    const text = formatProposal(proposal).replace(/\n---\n/, "\noutcome: rejected\n---\n");
    assert.match(text, /\noutcome: rejected\n---\n/);
    closed = await overlappedThenGoOn(name, text, false);
  }
  assert.ok(closed, "in 5 attempts the write never overlapped other operations");
  const { value } = await until(async () => (await currentPage()) === "T/Done", 15000, 300);
  assert.ok(value, `Go on went to ${await currentPage()}, not T/Done (${await documentState()})`);
});

async function entries() {
  return Object.values(await lua<Record<string, string>>(`local out = {} for _, e in ipairs(proposals.entries()) do table.insert(out, e.name) end return out`));
}
