// What an agent that writes proposal pages must not get done: an action that
// differs from what the review showed, a page outside the proposal folder
// closed as a proposal, a formatted view that hides the change, and live
// content on the proposal page.

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { formatProposal, type Proposal } from "../../src/proposal.ts";
import { clean, click, configure, currentPage, freshRuntime, lua, open, readPage, revisionOf, shown, sleep, until, writePage, writeProposal } from "./lib.ts";

test.before(async () => {
  await freshRuntime();
});

const TARGET = "Intro\n\nWater in the evening.\n";
const VICTIM = "Do not touch.\n";
const COPY = "Working copies/P/edit";

let edit: Proposal;

beforeEach(async () => {
  await clean();
  await configure({ afterLast: "T/Done" });
  await lua(`editor.confirm = proposals.realConfirm or editor.confirm
editor.flashNotification = proposals.realFlash or editor.flashNotification
return true`);
  await writePage("T/Garden", TARGET);
  await writePage("T/Victim", VICTIM);
  edit = {
    action: "edit",
    target: "T/Garden",
    revision: await revisionOf(TARGET),
    reason: "Mornings.",
    edits: [{ oldText: "in the evening", newText: "in the morning", expectedMatches: 1 }],
  };
  await writeProposal("P/edit", edit);
});

/** Answers every confirmation dialog of the client with yes, until the next test. */
const confirmAll = () => lua(`proposals.realConfirm = proposals.realConfirm or editor.confirm
editor.confirm = function() return true end
return true`);

/** Records the client's notifications in proposals.flashed, until the next test. */
const recordFlashes = () => lua(`proposals.realFlash = proposals.realFlash or editor.flashNotification
proposals.flashed = {}
editor.flashNotification = function(message) table.insert(proposals.flashed, message) end
return true`);

/** Rewrites a proposal page behind the review's back, as an agent could. */
const swap = (name: string, proposal: Proposal) => writePage(name, formatProposal(proposal));
const deleteVictim = async (): Promise<Proposal> => ({ action: "delete", target: "T/Victim", revision: await revisionOf(VICTIM), reason: "" });

test("safety: Apply refuses when the proposal was swapped after it was shown, and the review is drawn again", async () => {
  await open("review:P/edit", ".proposals-header");
  await swap("P/edit", await deleteVictim());
  await click(".proposals-header", "Apply");
  await until(async () => (await shown(".proposals-header")).includes("delete"), 10000, 300);
  assert.match(await shown(".proposals-header"), /T\/Victim · delete/, "the review now shows the swapped proposal");
  assert.equal(await readPage("T/Victim"), VICTIM);
  assert.equal(await readPage("T/Garden"), TARGET);
  assert.equal(await currentPage(), "review:P/edit");
});

test("safety: Apply refuses when the target changed after the review was shown", async () => {
  await open("review:P/edit", ".proposals-header");
  await writePage("T/Garden", TARGET + "More.\n");
  await click(".proposals-header", "Apply");
  await sleep(1500);
  assert.equal(await readPage("T/Garden"), TARGET + "More.\n");
  assert.notEqual(await readPage("P/edit"), null);
  const r = await lua<unknown[]>(`local p = proposals.read("P/edit")
local expect = proposals.binding(p, {old = ${JSON.stringify(TARGET)}})
return {proposals.apply("P/edit", {expect = expect})}`);
  assert.deepEqual(r, [false, "the page changed since it was shown: look at it again"]);
});

test("safety: Edit refuses a swapped proposal", async () => {
  await open("review:P/edit", ".proposals-header");
  await swap("P/edit", { ...edit, target: "T/Victim", revision: await revisionOf(VICTIM), edits: [{ oldText: "Do not", newText: "Do", expectedMatches: 1 }] });
  await click(".proposals-header", "Edit");
  await sleep(1500);
  assert.equal(await readPage(COPY), null, "no working copy");
  assert.equal(await currentPage(), "review:P/edit");
});

test("safety: Accept from the bar refuses a proposal swapped to another target, also for a copy made in another browser", async () => {
  await lua(`proposals.makeCopy("P/edit") clientStore.delete(proposals.copyKey("P/edit")) return true`);
  await open(COPY, ".proposals-bar");
  await swap("P/edit", { ...edit, target: "T/Victim", revision: await revisionOf(VICTIM), edits: [{ oldText: "Do not", newText: "Do", expectedMatches: 1 }] });
  await confirmAll();
  await click(".proposals-bar", "Accept");
  await sleep(1500);
  assert.equal(await readPage("T/Victim"), VICTIM);
  assert.equal(await readPage("T/Garden"), TARGET);
});

test("safety: an unchecked Accept does not write a working copy into another target", async () => {
  await lua(`return proposals.makeCopy("P/edit")`);
  await swap("P/edit", { ...edit, target: "T/Victim", revision: await revisionOf(VICTIM), edits: [{ oldText: "Do not", newText: "Do", expectedMatches: 1 }] });
  const r = await lua<unknown[]>(`return {proposals.accept("P/edit", nil, true)}`);
  assert.deepEqual(r, [false, "the working copy was made for T/Garden, not T/Victim"]);
  assert.equal(await readPage("T/Victim"), VICTIM);
});

test("safety: Accept from the review refuses a working copy changed after it was shown", async () => {
  await lua(`return proposals.makeCopy("P/edit")`);
  await open("review:P/edit", ".proposals-header");
  await writePage(COPY, "Intro\n\nSomething else.\n");
  await click(".proposals-header", "Accept");
  await sleep(1500);
  assert.equal(await readPage("T/Garden"), TARGET);
});

test("safety: Apply all applies the proposals as listed, not as swapped after the list was drawn", async () => {
  await writePage("T/List", "Open proposals:\n\n${proposals.list()}\n");
  await open("T/List", ".proposals-list");
  await swap("P/edit", await deleteVictim());
  await confirmAll();
  await click(".proposals-list", "Apply all");
  await sleep(1500);
  assert.equal(await readPage("T/Victim"), VICTIM);
  assert.notEqual(await readPage("P/edit"), null);
});

test("safety: Apply all leaves out a row that could not be read when listed, even when it can be read by then", async () => {
  await writePage("P/broken", formatProposal(await deleteVictim()).replace("format: 1", "format: 2"));
  await writePage("T/List", "Open proposals:\n\n${proposals.list()}\n");
  // the client must read both pages as written before the list is drawn
  const ready = () => lua<boolean>(`local p = proposals.read("P/edit") local q, why = proposals.read("P/broken")
return p ~= nil and p.target == "T/Garden" and q == nil and string.startsWith(why or "", "format 2") and #proposals.entries() == 2`);
  assert.ok((await until(ready, 20000, 300)).value, "the client sees the two proposals");
  await open("T/Garden", ".cm-content");
  await open("T/List", ".proposals-list");
  assert.match(await shown(".proposals-list"), /cannot be read: format 2/);
  assert.match(await shown(".proposals-list"), /T\/Garden/);
  await swap("P/broken", await deleteVictim());
  assert.equal(await lua(`return proposals.read("P/broken").target`), "T/Victim", "the row is a valid proposal now");
  await confirmAll();
  await recordFlashes();
  await click(".proposals-list", "Apply all");
  await until(() => lua<boolean>(`return #proposals.flashed > 0`), 10000, 300);
  assert.equal(await readPage("T/Victim"), VICTIM, "the swapped row is not applied");
  assert.notEqual(await readPage("P/broken"), null);
  assert.equal(await readPage("T/Garden"), "Intro\n\nWater in the morning.\n", "the bound row is applied");
  assert.deepEqual(await lua(`return proposals.flashed`), ["1 applied; not applied: P/broken (could not be read when listed)"]);
  assert.deepEqual(await lua(`return {proposals.apply("P/broken")}`), [false, "not bound to what was shown"], "no binding, no apply");
  assert.equal(await readPage("T/Victim"), VICTIM);
});

test("safety: a proposal without the target's revision cannot be read, and a missing revision counts as changed", async () => {
  await writePage("P/norev", formatProposal(await deleteVictim()).replace(/^revision: .*\n/m, ""));
  assert.deepEqual(await lua(`return {proposals.read("P/norev")}`), [null, "no revision"]);
  assert.deepEqual(await lua(`return {proposals.apply("P/norev", {unbound = true})}`), [false, "no revision"]);
  assert.equal(await lua(`return proposals.evaluate({action = "delete", target = "T/Victim"}).changed`), true);
  assert.equal(await readPage("T/Victim"), VICTIM);
});

test("safety: a proposal may not write into the proposal folder or the folder of the working copies", async () => {
  const cases: Array<[string, Proposal, string]> = [
    ["P/plant copy", { action: "move", target: "T/Victim", to: COPY, revision: await revisionOf(VICTIM), reason: "" }, `the page ${COPY} lies in the folder of the working copies`],
    ["P/plant proposal", { action: "move", target: "T/Victim", to: "P/new", revision: await revisionOf(VICTIM), reason: "" }, "the page P/new lies in the proposal folder"],
    ["P/edit proposal", { ...edit, target: "P/edit", revision: await revisionOf(await readPage("P/edit") ?? ""), edits: [{ oldText: "Mornings.", newText: "Evenings.", expectedMatches: 1 }] }, "the page P/edit lies in the proposal folder"],
    ["P/edit copy", { ...edit, target: COPY }, `the page ${COPY} lies in the folder of the working copies`],
  ];
  for (const [name, proposal, why] of cases) {
    await writePage(name, formatProposal(proposal));
    assert.deepEqual(await lua(`return {proposals.read(${JSON.stringify(name)})}`), [null, why], name);
    assert.deepEqual(await lua(`return {proposals.apply(${JSON.stringify(name)}, {unbound = true, changed = true})}`), [false, why], name);
    assert.deepEqual(await lua(`local copy, why = proposals.makeCopy(${JSON.stringify(name)}) return {copy or false, why}`), [false, why], name);
  }
  assert.equal(await readPage("T/Victim"), VICTIM);
  assert.equal(await readPage(COPY), null);
  assert.equal(await readPage("P/new"), null);
  assert.equal(await readPage("P/edit"), formatProposal(edit));
});

test("safety: the formatted view requests no remote image, also one dropped by the sanitizer; addresses are read as the browser reads them", async () => {
  // the browser records at most so many requests: start from an empty record
  const r = await lua<Record<string, unknown>>(`js.window.performance.clearResourceTimings()
local url = js.window.location.origin .. "/.fs/probe-" .. tostring(math.random(1, 1000000000)) .. ".png"
local block = proposals.markdownBlock("Grüße 😀\\n\\n![x](" .. url .. ") nach 😀 ![y](<" .. url .. "?3>)\\n\\n<img src='" .. url .. "?2'>", "")
local doc = js.window.document
local a = proposals.markdownBlock("[a](javascript:alert(1)) [b](https://example.invalid/) [c](Some/Page)", "")
local hrefs = {}
local links = a.querySelectorAll("a")
for i = 1, links.length do table.insert(hrefs, tostring(links[i].getAttribute("href"))) end
return {
  url = url,
  images = block.querySelectorAll("img").length,
  text = block.textContent,
  hrefs = hrefs,
  controls = {proposals.remote(string.char(1) .. "https://example.invalid/x.png"), proposals.remote("ht\\ntps://example.invalid/x.png"), proposals.remote(" //example.invalid/x.png"), proposals.remote("local.png"), proposals.remote("data:image/png;base64,AA")}
}`);
  await sleep(1500);
  const url = String(r.url);
  assert.equal(await lua(`return js.window.performance.getEntriesByName(${JSON.stringify(url)}).length + js.window.performance.getEntriesByName(${JSON.stringify(url + "?2")}).length + js.window.performance.getEntriesByName(${JSON.stringify(url + "?3")}).length`), 0, "the image was never requested");
  assert.equal(r.images, 0);
  assert.match(String(r.text), /^Grüße 😀/, "the text before the images is kept");
  assert.match(String(r.text), /remote image not loaded: \S+\.png\] nach 😀 \[remote image not loaded: <?\S+\?3>?\]/, "both Markdown images become notes, in place");
  const hrefs = r.hrefs as string[];
  assert.ok(["nil", "null"].includes(hrefs[0]), `a javascript: link loses its address: ${hrefs[0]}`);
  assert.equal(hrefs[1], "https://example.invalid/", "a web link keeps it");
  assert.deepEqual(r.controls, [true, true, true, false, false]);
});

test("safety: the renderer requests nothing for reference-style images or a transclusion of an address, and the formatted view shows their addresses as notes", async () => {
  // probed against the renderer: it knows no reference definitions and shows a remote ![[...]] as an error text, with no img element
  const r = await lua<Record<string, unknown>>(`js.window.performance.clearResourceTimings()
local token = "probe-" .. tostring(math.random(1, 1000000000))
local base = js.window.location.origin .. "/.fs/" .. token
local forms = {
  "![x][r]\\n\\n[r]: " .. base .. "-1.png",
  "![r][]\\n\\n[r]: " .. base .. "-2.png",
  "![r]\\n\\n[r]: " .. base .. "-3.png",
  "![x][r]\\n\\n[r]: <" .. base .. "-4.png> \\"title\\"",
  "![[" .. base .. "-5.png]]",
  "![[" .. base .. "-6.png|200x100]]",
  "![[" .. js.window.location.origin:gsub("^https?:", "") .. "/.fs/" .. token .. "-7.png]]",
}
local doc = js.window.document.implementation.createHTMLDocument("")
local raw, piped = {}, {}
for _, form in ipairs(forms) do
  -- the renderer alone, then the formatted view
  local holder = doc.createElement("div")
  holder.innerHTML = markdown.markdownToHtml(form)
  table.insert(raw, { images = holder.querySelectorAll("img").length, text = holder.textContent })
  table.insert(piped, proposals.markdownBlock(form, "").textContent)
end
return { token = token, base = base, raw = raw, piped = piped }`);
  await sleep(1500);
  const token = String(r.token);
  const requested = await lua<number>(`local n = 0
local e = js.window.performance.getEntriesByType("resource")
for i = 1, e.length do if string.find(e[i].name, ${JSON.stringify(token)}, 1, true) then n = n + 1 end end
return n`);
  assert.equal(requested, 0, "no form was requested, by the renderer or by the formatted view");
  const raw = r.raw as Array<{ images: number; text: string }>;
  const piped = r.piped as string[];
  raw.forEach((form, n) => {
    assert.equal(form.images, 0, `form ${n + 1}: the renderer emits no img element`);
    assert.doesNotMatch(form.text, /remote image not loaded/, `form ${n + 1}: nothing of this came from the sanitizer`);
  });
  for (let n = 0; n < 4; n++) {
    assert.ok(piped[n].includes(`${token}-${n + 1}.png`), `form ${n + 1}: the address of the reference definition stays visible`);
  }
});

test("safety: a page outside the proposal folder is no proposal: no Reject, not listed, not applied", async () => {
  assert.match(await open("review:T/Victim", ".proposals-notice"), /not a page in the proposal folder/);
  const labels = await lua<string[]>(`local out = {}
local bs = js.window.document.querySelectorAll(".proposals-header button")
for i = 1, bs.length do table.insert(out, bs[i].textContent) end
return out`);
  assert.deepEqual(labels, ["Go on"]);
  assert.deepEqual(await lua(`return {proposals.reject("T/Victim")}`), [false, "not a page in the proposal folder"]);
  assert.equal(await readPage("T/Victim"), VICTIM);

  // tagged, in the format, but outside the folder
  await writePage("Q/outside", formatProposal(await deleteVictim()));
  await until(() => lua<boolean>(`return #query[[from p = index.tag "change-proposal" where p.name == "Q/outside"]] == 1`), 15000, 300);
  assert.deepEqual(await lua(`local out = {} for _, e in ipairs(proposals.entries()) do table.insert(out, e.name) end return out`), ["P/edit"]);
  assert.deepEqual(await lua(`return {proposals.apply("Q/outside", {unbound = true})}`), [false, "not a page in the proposal folder"]);
  assert.deepEqual(await lua(`return {proposals.reject("Q/outside")}`), [false, "not a page in the proposal folder"]);
  assert.equal(await readPage("T/Victim"), VICTIM);
  assert.notEqual(await readPage("Q/outside"), null);

  // in the folder, but not tagged
  await writePage("P/plain", "Just a page.\n");
  assert.deepEqual(await lua(`return {proposals.reject("P/plain")}`), [false, "not tagged change-proposal"]);
  assert.notEqual(await readPage("P/plain"), null);
});

test("safety: the formatted view drops styles, style sheets, embedded documents and remote images, and opens on the text view", async () => {
  const html = [
    "Safe.",
    "",
    '<div style="position:fixed;inset:0;background:white" class="proposals-notice" id="cover">Nothing changes here.</div>',
    "",
    "<style>.proposals-formatted { display: none }</style>",
    "",
    '<link rel="stylesheet" href="https://example.invalid/x.css">',
    "",
    '<img src="https://example.invalid/seen.png" alt="a"> <img src="//example.invalid/seen2.png" alt="b"> ![remote](https://example.invalid/seen3.png) ![local](local.png)',
    "",
    '<iframe src="https://example.invalid/"></iframe>',
  ].join("\n");
  await swap("P/edit", { ...edit, edits: [{ oldText: "Water in the evening.", newText: html, expectedMatches: 1 }] });
  await open("review:P/edit", ".proposals-formatted");
  await sleep(1000);
  const r = await lua<Record<string, unknown>>(`local doc = js.window.document
local box = doc.querySelector(".proposals-formatted")
local blocks = box.children
local inner = 0
for i = 1, blocks.length do inner = inner + blocks[i].querySelectorAll("[class], [id], style, link, iframe, :not(img)[style]").length end
local imgs = box.querySelectorAll("img")
local srcs = {}
for i = 1, imgs.length do table.insert(srcs, tostring(imgs[i].getAttribute("src")) .. " " .. imgs[i].style.maxWidth) end
return {
  inner = inner,
  images = srcs,
  text = box.textContent,
  formattedShown = box.style.display,
  contained = blocks[1].style.contain
}`);
  assert.equal(r.inner, 0, "no style, class, id, style sheet or frame inside the blocks");
  assert.deepEqual(r.images, [".fs/local.png 100%"], "only the image from the space is kept, and fits");
  assert.match(String(r.text), /\[remote image not loaded: https:\/\/example\.invalid\/seen\.png\]/);
  assert.match(String(r.text), /\[remote image not loaded: \/\/example\.invalid\/seen2\.png\]/);
  assert.match(String(r.text), /\[remote image not loaded: https:\/\/example\.invalid\/seen3\.png\]/);
  assert.equal(r.formattedShown, "none", "the text view comes first when the page holds HTML");
  assert.equal(r.contained, "paint");
});

test("safety: nothing an agent wrote is live on the proposal page", async () => {
  await writeProposal("P/live", {
    ...edit,
    reason: "Why:\n\n${1 + 1}\n\n```space-lua\n-- in the reason\n```\n   ~~~~\n```space-lua\n-- after an indented fence\n```",
    edits: [{ oldText: "Water", newText: "x\n  ~~~~~~\n```space-lua\n-- in a replacement\n```\n", expectedMatches: 1 }],
  });
  await writePage("T/Control", "```space-lua\n-- a real block\n```\n");
  const count = (p: string) => lua<number>(`return #query[[from o = index.tag "space-lua" where string.startsWith(o.ref, ${JSON.stringify(p + "@")})]]`);
  const { value } = await until(async () => (await count("T/Control")) === 1, 15000, 300);
  assert.ok(value, "the index lists the space-lua block of a plain page");
  assert.equal(await count("P/live"), 0);
  assert.equal(await count("P/edit"), 0);
});

test("safety: an empty or nested folder setting is refused", async () => {
  const nested = "proposalPrefix and workingCopyPrefix must not lie inside each other";
  const cases: Array<[Record<string, string>, string]> = [
    [{ workingCopyPrefix: "" }, "workingCopyPrefix is not set"],
    [{ proposalPrefix: "" }, "proposalPrefix is not set"],
    [{ workingCopyPrefix: "P/copies/" }, nested],
    [{ proposalPrefix: "Working copies/P/" }, nested],
  ];
  for (const [values, why] of cases) {
    await configure(values);
    assert.equal(await lua(`local _, _, why = proposals.folders() return why`), why, JSON.stringify(values));
    // with no usable folders nothing is a proposal, and no page is a working copy
    assert.deepEqual(await lua(`local copy, why = proposals.makeCopy("P/edit") return {copy or false, why}`), [false, why], JSON.stringify(values));
    assert.equal(await lua(`return proposals.proposalOf("Working copies/P/edit") or false`), false);
  }
  assert.equal(await readPage("P/edit"), formatProposal(edit), "the proposal is not its own working copy");
});
