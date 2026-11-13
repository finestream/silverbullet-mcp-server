// The review of one proposal, as the person sees it in the browser: the diff,
// Apply, a stale proposal, deletes and moves, and going on afterwards.

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { REVISION } from "../../src/proposal-cases.ts";
import { clean, click, configure, currentPage, freshRuntime, lua, open, readPage, revisionOf, shown, until, writePage, writeProposal } from "./lib.ts";

test.before(async () => {
  await freshRuntime();
});

beforeEach(async () => {
  await clean();
  await configure();
});

const page = (name: string) => until(async () => (await currentPage()) === name, 15000, 300);

test("review: an edit shows its diff, Apply writes it, deletes the proposal and opens afterLast", async () => {
  const target = "Intro\n\nWater the plants in the evening.\n\n* one\n* two\n";
  await writePage("T/Garden", target);
  await writeProposal("P/water", {
    action: "edit",
    target: "T/Garden",
    revision: await revisionOf(target),
    group: "garden",
    reason: "Mornings are cooler.",
    edits: [{ oldText: "in the evening", newText: "early in the morning", expectedMatches: 1 }],
  });
  await configure({ afterLast: "T/Done" });
  assert.equal(await open("review:P/water", ".proposals-position"), "1 / 1");
  assert.equal(await shown(".proposals-reason"), "Mornings are cooler.");
  const formatted = await shown(".proposals-formatted");
  assert.ok(formatted.includes("in the evening") && formatted.includes("early in the morning"), formatted);
  await click(".proposals-header", "Apply");
  assert.ok((await page("T/Done")).value, `went to ${await currentPage()}`);
  assert.equal(await readPage("T/Garden"), target.replace("in the evening", "early in the morning"));
  assert.equal(await readPage("P/water"), null, "the proposal page is deleted");
});

test("review: a stale edit says why and offers Reject only; Reject deletes it", async () => {
  await writePage("T/Garden", "Nothing to see.\n");
  await writeProposal("P/stale", {
    action: "edit",
    target: "T/Garden",
    revision: REVISION,
    reason: "",
    edits: [{ oldText: "in the evening", newText: "in the morning", expectedMatches: 1 }],
  });
  await open("review:P/stale", ".proposals-notice");
  assert.match(await shown(".proposals-notice"), /Cannot be applied: change 1: the expected text is not in the page/);
  const labels = await lua<string[]>(`local out = {}
local bs = js.window.document.querySelectorAll(".proposals-header button")
for i = 1, bs.length do table.insert(out, bs[i].textContent) end
return out`);
  assert.deepEqual(labels, ["Reject"]);
  await click(".proposals-header", "Reject");
  await until(async () => (await readPage("P/stale")) === null, 10000);
  assert.equal(await readPage("P/stale"), null);
  assert.equal(await readPage("T/Garden"), "Nothing to see.\n");
});

test("review: with deleteClosed = false a closed proposal is kept with its outcome and no longer listed", async () => {
  const target = "a\n";
  await writePage("T/Keep", target);
  await writeProposal("P/keep", { action: "edit", target: "T/Keep", revision: await revisionOf(target), reason: "", edits: [{ oldText: "a", newText: "b", expectedMatches: 1 }] });
  await configure({ deleteClosed: false });
  const r = await lua<{ ok: boolean; entries: number }>(`local ok = proposals.apply("P/keep", {unbound = true}) return {ok = ok, entries = #proposals.entries()}`);
  assert.deepEqual(r, { ok: true, entries: 0 });
  assert.match((await readPage("P/keep")) ?? "", /\noutcome: applied\n---\n/);
  assert.equal(await readPage("T/Keep"), "b\n");
  // the index learns the outcome: a new client (no memory of closed proposals) does not list it either
  const { value } = await until(() => lua<boolean>(`proposals.closed = {} return #proposals.entries() == 0`), 15000, 300);
  assert.ok(value, "the kept proposal is listed again once the client forgets it");
});

test("review: a delete lists the pages that link to the target, warns when the page changed, and Apply deletes it", async () => {
  await writePage("T/Old", "Old text.\n");
  await writePage("T/Links here", "See [[T/Old]].\n");
  await writeProposal("P/delete", { action: "delete", target: "T/Old", revision: REVISION, reason: "Replaced." });
  await open("review:P/delete", ".proposals-linking");
  await until(async () => (await shown(".proposals-linking")).includes("T/Links here"), 15000, 500);
  assert.match(await shown(".proposals-linking"), /Pages that link to it: T\/Links here/);
  const notices = await lua<string>(`local out = {}
local ns = js.window.document.querySelectorAll(".proposals-notice")
for i = 1, ns.length do table.insert(out, ns[i].textContent) end
return table.concat(out, " | ")`);
  assert.match(notices, /The page changed after this proposal was written/);
  assert.match(notices, /Deletes the page T\/Old/);
  assert.equal(await lua(`local ok, why = proposals.apply("P/delete", {unbound = true}) return why`), "the page changed after the proposal was written: review it on its own", "Apply all leaves it out");
  await click(".proposals-header", "Apply");
  await until(async () => (await readPage("T/Old")) === null, 10000);
  assert.equal(await readPage("T/Old"), null);
  assert.equal(await readPage("P/delete"), null);
});

test("review: Apply of a move renames the page and rewrites the links to it", async () => {
  const text = "New page.\n";
  await writePage("T/Draft", text);
  await writePage("T/Refers", "See [[T/Draft]] and [[T/Draft|the draft]], not [[T/Drafts]].\n");
  await writeProposal("P/move", { action: "move", target: "T/Draft", to: "T/Placed", revision: await revisionOf(text), reason: "Ready." });
  await until(() => lua<boolean>(`return #proposals.linkingPages("T/Draft") == 1`), 15000, 300);
  assert.match(await open("review:P/move", ".proposals-notice"), /Moves the page T\/Draft to T\/Placed/);
  assert.match(await shown(".proposals-linking"), /Pages whose links are rewritten: T\/Refers/);
  await click(".proposals-header", "Apply");
  await until(async () => (await readPage("T/Placed")) !== null, 15000);
  assert.equal(await readPage("T/Draft"), null);
  assert.equal(await readPage("T/Placed"), text);
  assert.equal(await readPage("T/Refers"), "See [[T/Placed]] and [[T/Placed|the draft]], not [[T/Drafts]].\n");
  assert.equal(await readPage("P/move"), null);
});

test("review: a move onto an existing page is stale", async () => {
  await writePage("T/A", "a\n");
  await writePage("T/B", "b\n");
  await writeProposal("P/clash", { action: "move", target: "T/A", to: "T/B", revision: REVISION, reason: "" });
  assert.match(await open("review:P/clash", ".proposals-notice"), /Cannot be applied: a page named T\/B exists already/);
});

test("review: a change to the frontmatter is shown before and after, above the body", async () => {
  const target = "---\nstatus: draft\n---\n# Title\n\nBody.\n";
  await writePage("T/Front", target);
  await writeProposal("P/front", {
    action: "edit",
    target: "T/Front",
    revision: await revisionOf(target),
    reason: "",
    edits: [{ oldText: "status: draft\n", newText: "status: final\ntags: garden\n", expectedMatches: 1 }],
  });
  const box = await open("review:P/front", ".proposals-formatted .proposals-frontmatter");
  assert.ok(box.startsWith("Frontmatter"), box);
  for (const line of ["status: draft", "status: final", "tags: garden"]) assert.ok(box.includes(line), `${line} in ${box}`);
  const rows = await lua<string[]>(`local out = {}
local trs = js.window.document.querySelectorAll(".proposals-formatted .proposals-frontmatter tr")
for i = 1, trs.length do table.insert(out, trs[i].children[3].textContent .. trs[i].children[4].textContent) end
return out`);
  assert.deepEqual(rows, [" ---", "-status: draft", "+status: final", "+tags: garden", " ---"]);
});

test("review: the formatted view runs nothing of the page", async () => {
  const target = "Safe.\n";
  await writePage("T/Html", target);
  await writeProposal("P/html", {
    action: "edit",
    target: "T/Html",
    revision: await revisionOf(target),
    reason: "",
    edits: [{ oldText: "Safe.", newText: 'Safe.\n\n<img src="x" onerror="window.proposalsPwned = 1">\n\n<script>window.proposalsPwned = 2</script>\n\n<a href="javascript:window.proposalsPwned = 3" onclick="window.proposalsPwned = 4">x</a>\n\n${1 + 1}', expectedMatches: 1 }],
  });
  await open("review:P/html", ".proposals-formatted");
  await new Promise((r) => setTimeout(r, 1500));
  const r = await lua<{ handlers: number; scripts: number; js: number; pwned: unknown; text: string }>(`local box = js.window.document.querySelector(".proposals-formatted")
return {
  handlers = box.querySelectorAll("[onerror], [onclick], [onload]").length,
  scripts = box.querySelectorAll("script").length,
  js = box.querySelectorAll("a[href^='javascript']").length,
  pwned = js.window.proposalsPwned,
  text = box.textContent
}`);
  assert.equal(r.pwned ?? null, null, "a handler ran");
  assert.deepEqual([r.handlers, r.scripts, r.js], [0, 0, 0]);
  assert.ok(r.text.includes("${1 + 1}"), "an expression shows as text");
});

const viewState = () =>
  lua<{ formatted: string; text: string; formattedWeight: string; textWeight: string }>(`local doc = js.window.document
local box = doc.querySelector(".proposals-formatted")
local buttons = doc.querySelectorAll(".proposals-header button")
local weights = {}
for i = 1, buttons.length do weights[buttons[i].textContent] = buttons[i].style.fontWeight end
return { formatted = box.style.display, text = box.nextElementSibling.style.display, formattedWeight = weights["Formatted"], textWeight = weights["Text"] }`);

test("review: placeholders in code and a plain < in prose are no HTML: the review opens on the formatted view", async () => {
  const target = "Intro.\n";
  await writePage("T/Placeholders", target);
  await writeProposal("P/placeholders", {
    action: "edit",
    target: "T/Placeholders",
    revision: await revisionOf(target),
    reason: "",
    edits: [{ oldText: "Intro.", newText: "Intro, a < b and 2<3.\n\nName it `<task> - <subject>`.\n\n```\n<name> <kbBaseUrl>\n```", expectedMatches: 1 }],
  });
  await open("review:P/placeholders", ".proposals-formatted");
  const v = await viewState();
  assert.equal(v.formatted, "flex", "the formatted view is shown");
  assert.equal(v.text, "none");
  assert.deepEqual([v.formattedWeight, v.textWeight], ["bold", "normal"]);
  const formatted = await shown(".proposals-formatted");
  assert.ok(formatted.includes("<task> - <subject>"), formatted);
  assert.ok(formatted.includes("<name> <kbBaseUrl>"), formatted);
});

test("review: an inline <img> in a paragraph still opens the review on the text view", async () => {
  const target = "Intro.\n";
  await writePage("T/Inline", target);
  await writeProposal("P/inline", {
    action: "edit",
    target: "T/Inline",
    revision: await revisionOf(target),
    reason: "",
    edits: [{ oldText: "Intro.", newText: 'Intro with <img src="local.png" alt="a"> inside.', expectedMatches: 1 }],
  });
  await open("review:P/inline", ".proposals-formatted");
  const v = await viewState();
  assert.equal(v.formatted, "none", "the text view comes first");
  assert.deepEqual([v.formattedWeight, v.textWeight], ["normal", "bold"]);
});

for (const [label, html] of [
  ["a <?…?> block", "Before.\n\n<?php echo 1; ?>\n\nAfter."],
  ["a <!-- … --> block", "Before.\n\n<!-- hidden\nlines -->\n\nAfter."],
  ["a <!DOCTYPE x> line", "Before.\n\n<!DOCTYPE x>\n\nAfter."],
] as const) {
  test(`review: ${label} opens the review on the text view`, async () => {
    const target = "Intro.\n";
    await writePage("T/Block", target);
    await writeProposal("P/block", {
      action: "edit",
      target: "T/Block",
      revision: await revisionOf(target),
      reason: "",
      edits: [{ oldText: "Intro.", newText: html, expectedMatches: 1 }],
    });
    await open("review:P/block", ".proposals-formatted");
    const v = await viewState();
    assert.equal(v.formatted, "none", "the text view comes first");
    assert.deepEqual([v.formattedWeight, v.textWeight], ["normal", "bold"]);
  });
}
