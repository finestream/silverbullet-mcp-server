// Edit: the working copy of a proposal, its bar, Accept, Revert to proposal,
// Preview and Reject.

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clean, click, configure, currentPage, freshRuntime, lua, open, readPage, revisionOf, shown, sleep, until, writePage, writeProposal } from "./lib.ts";

test.before(async () => {
  await freshRuntime();
});

const COPY = "Working copies/P/edit";
const TARGET = "Intro\n\nWater in the evening.\n";
const page = (want: string) => until(async () => (await currentPage()) === want, 15000, 300);
const exists = (selector: string) => lua<boolean>(`return js.window.document.querySelector(${JSON.stringify(selector)}) ~= nil`);

beforeEach(async () => {
  await clean();
  await configure({ afterLast: "T/Done" });
  await writePage("T/Garden", TARGET);
  await writeProposal("P/edit", {
    action: "edit",
    target: "T/Garden",
    revision: await revisionOf(TARGET),
    reason: "Mornings.",
    edits: [{ oldText: "in the evening", newText: "in the morning", expectedMatches: 1 }],
  });
});

test("working copy: Edit opens it under its bar; Accept writes the edited copy and deletes copy and proposal", async () => {
  await open("review:P/edit", ".proposals-header");
  await click(".proposals-header", "Edit");
  await page(COPY);
  assert.match(await shown(".proposals-bar"), /Working copy of T\/Garden with the proposal P\/edit/);
  assert.equal(await lua("return editor.getText()"), "Intro\n\nWater in the morning.\n");
  await lua(`editor.setText("Intro\\n\\nWater early in the morning.\\n") return true`);
  await click(".proposals-bar", "Accept");
  await page("T/Done");
  assert.equal(await readPage("T/Garden"), "Intro\n\nWater early in the morning.\n");
  await sleep(3000); // an autosave of the copy after it was deleted would bring it back
  assert.equal(await readPage(COPY), null, "the working copy is gone");
  assert.equal(await readPage("P/edit"), null, "the proposal is gone");
});

test("working copy: the bar is shown above the working copies and nowhere else", async () => {
  await lua(`return proposals.makeCopy("P/edit")`);
  await open(COPY, ".proposals-bar");
  await open("T/Garden", ".cm-content");
  await sleep(1000);
  assert.equal(await exists(".proposals-bar"), false);
  await open(COPY, ".proposals-bar");
});

test("working copy: Preview shows the copy against the page, with Accept and Revert to proposal", async () => {
  await lua(`return proposals.makeCopy("P/edit")`);
  await open(COPY, ".proposals-bar");
  await lua(`editor.setText("Intro\\n\\nWater at noon.\\n") return true`);
  await click(".proposals-bar", "Preview");
  await page("review:P/edit");
  assert.match(await shown(".proposals-notice"), /You edited this proposal/);
  assert.match(await shown(".proposals-formatted"), /Water at noon\./);
  const labels = await lua<string[]>(`local out = {}
local bs = js.window.document.querySelectorAll(".proposals-header button")
for i = 1, bs.length do table.insert(out, bs[i].textContent) end
return out`);
  assert.deepEqual(labels, ["Formatted", "Text", "Accept", "Edit", "Revert to proposal", "Reject"]);
  assert.match(await lua<string>(`local ok, why = proposals.apply("P/edit", {unbound = true}) return why`), /working copy/, "Apply leaves an edited proposal alone");
});

test("working copy: Revert to proposal builds it again", async () => {
  await lua(`return proposals.makeCopy("P/edit")`);
  await writePage(COPY, "something else\n");
  assert.equal(await lua(`return proposals.makeCopy("P/edit")`), COPY);
  assert.equal(await readPage(COPY), "something else\n", "Edit keeps an existing copy");
  await lua(`return proposals.makeCopy("P/edit", true)`);
  assert.equal(await readPage(COPY), "Intro\n\nWater in the morning.\n");
});

test("working copy: Accept is refused when the page changed after the copy was made", async () => {
  await lua(`return proposals.makeCopy("P/edit")`);
  await writePage("T/Garden", TARGET + "More.\n");
  await sleep(500);
  const why = await lua<string>(`local ok, why = proposals.accept("P/edit") return why`);
  assert.match(why, /T\/Garden changed after the working copy was made/);
  assert.equal(await readPage("T/Garden"), TARGET + "More.\n");
});

test("working copy: a copy made in another browser is accepted only when asked to", async () => {
  await lua(`return proposals.makeCopy("P/edit")`);
  const r = await lua<unknown[]>(`clientStore.delete(proposals.copyKey("P/edit")) return {proposals.accept("P/edit")}`);
  assert.equal(r[0], false);
  assert.equal(r[2], "unchecked");
  assert.equal(await lua(`return (proposals.accept("P/edit", nil, true))`), true);
  assert.equal(await readPage("T/Garden"), "Intro\n\nWater in the morning.\n");
});

test("working copy: Reject from the bar deletes copy and proposal and leaves the page", async () => {
  await lua(`return proposals.makeCopy("P/edit")`);
  await open(COPY, ".proposals-bar");
  await click(".proposals-bar", "Reject");
  await page("T/Done");
  await sleep(3000);
  assert.equal(await readPage(COPY), null);
  assert.equal(await readPage("P/edit"), null);
  assert.equal(await readPage("T/Garden"), TARGET);
});
