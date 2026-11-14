// Transclusions as the write filter's rule reads them (docs/security.md,
// section 5): which forms SilverBullet expands, where, and which it leaves
// alone. The rule refuses every form asserted here to expand; a form that
// starts to expand in a later release must be added to the filter.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { sb, T, S } from "../lib/env.ts";
import { checkPage } from "../../src/filter/filter.ts";
import { shippedAllowlist } from "../../src/filter/allowlist.ts";

const TARGET = "Transcluded/Deep";
const MARKER = "marker-transcluded";

before(async () => {
  await sb.write(T.admin, S.gamma, `${TARGET}.md`, `${MARKER}-top\n\n## Part\n${MARKER}-part\n`);
  await sb.write(T.admin, S.gamma, "Transcluded/note.txt", `${MARKER}-file\n`);
  await sb.runtimeReady(T.alice, S.gamma);
});

after(async () => {
  await sb.remove(T.admin, S.gamma, `${TARGET}.md`);
  await sb.remove(T.admin, S.gamma, "Transcluded/note.txt");
});

const expand = async (markdown: string) => {
  const r = await sb.lua(T.alice, S.gamma, `return markdown.renderParseTree(markdown.expandMarkdown(markdown.parseMarkdown(${JSON.stringify(markdown)})))`);
  return String(r.result ?? r.error ?? r.raw);
};

/** The filter as a reader who may not read the target sees the page. */
const refused = (markdown: string) => !checkPage(markdown, shippedAllowlist(), { page: "Notes/Page", denied: (t) => (t.startsWith("Transcluded/") ? "no r" : null) }).ok;

const EXPANDED = [
  `![[${TARGET}]]`,
  `![[${TARGET}#Part]]`,
  `![[${TARGET}|alias]]`,
  `![[${TARGET}#Part|alias]]`,
  `![[${TARGET}@0]]`,
  `![[${TARGET}@L1C1]]`,
  `![[/${TARGET}]]`,
  `![[${TARGET}.md]]`,
  `![[^${TARGET}]]`,
  `<div>![[${TARGET}]]</div>`,
  `<!-- ![[${TARGET}]] -->`,
  `> ![[${TARGET}]]`,
  `* ![[${TARGET}]]`,
  `| a |\n|---|\n| ![[${TARGET}]] |`,
  `![x](/${TARGET})`,
  `![x](/${TARGET}.md)`,
  `![x](</${TARGET}>)`,
  `![x](/${TARGET}#Part)`,
  `<div>![x](/${TARGET})</div>`,
];

const NOT_EXPANDED = [
  `\`![[${TARGET}]]\``,
  "```\n![[" + TARGET + "]]\n```",
  `[[${TARGET}]]`,
  `!\\[[${TARGET}]]`,
  `! [[${TARGET}]]`,
  `![[${TARGET.toLowerCase()}]]`,
  `![[Deep]]`,
  `![[Transcluded/note.txt]]`,
];

test("transclusion: every form SilverBullet expands is one the write filter refuses for a reader without r on the target", async () => {
  const leaks: string[] = [];
  for (const form of EXPANDED) {
    const out = await expand(form);
    assert.ok(out.includes(MARKER), `expected to expand: ${form} -> ${out.slice(0, 80)}`);
    if (!refused(form)) leaks.push(form);
  }
  assert.deepEqual(leaks, [], "expanded by SilverBullet and accepted by the filter");
});

test("transclusion: code spans, code blocks, links, escapes, another case and a bare last segment are not expanded; a file that is not a page is not expanded as text", async () => {
  for (const form of NOT_EXPANDED) {
    const out = await expand(form);
    assert.ok(!out.includes(MARKER), `expected to stay: ${form} -> ${out.slice(0, 80)}`);
  }
});

test("[watch] transclusion: a transclusion that an expression returns as a string is not expanded by markdown.expandMarkdown (the editor does expand it, which the filter cannot see)", async () => {
  const out = await expand(`\${"![[${TARGET}]]"}`);
  assert.ok(!out.includes(MARKER), out.slice(0, 120));
  assert.ok(out.includes(`![[${TARGET}]]`));
});

// What the render check of docs/security.md, section 12, rests on: the headless client reads
// pages over HTTP, and the browser's resource timing in the runtime records those reads.

const PAGE = "Transcluded/Shown";
const BLANK = "_sbmcp/blank";
const fsReads = async () => {
  const r = await sb.lua(T.alice, S.gamma, `return tostring(js.window.eval([[JSON.stringify(performance.getEntriesByType("resource").map((e) => e.name))]]))`);
  return (JSON.parse(String(r.result)) as string[]).map((u) => new URL(u).pathname).filter((p) => p.startsWith("/gamma/.fs/")).map((p) => decodeURIComponent(p.slice("/gamma/.fs/".length)));
};
const clearReads = () => sb.lua(T.alice, S.gamma, `js.window.eval("performance.clearResourceTimings()")`);
/** Waits until three polls 50 ms apart brought no new entry. */
const settled = async () => {
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 40 && stable < 3; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const n = (await fsReads()).length;
    stable = n === last ? stable + 1 : 0;
    last = n;
  }
};
/**
 * Waits until the client has read nothing but the shown page for `windows` windows of 500 ms. After a navigation it goes
 * on reading for a while, transclusions included, and it polls the shown page every few seconds, so a check of what a
 * navigation reads settles first, as `quiet()` of server/04-render does.
 */
const quiet = async (windows = 4) => {
  let still = 0;
  for (let i = 0; i < 60 && still < windows; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const others = (await fsReads()).filter((p) => p !== `${PAGE}.md`);
    await clearReads();
    still = others.length === 0 ? still + 1 : 0;
  }
  assert.ok(still >= windows, "the client keeps reading the file API");
};
const show = async (page: string) => {
  await sb.lua(T.alice, S.gamma, `editor.navigate(${JSON.stringify(page)})`);
  await settled();
};

test("loads: the runtime's browser records every read of the file API; a page and its transclusion are read for expandMarkdown and for editor.navigate, and again after leaving and coming back", async () => {
  await sb.write(T.admin, S.gamma, `${PAGE}.md`, `shown-top\n\n![[${TARGET}]]\n`);
  await sb.write(T.admin, S.gamma, `${TARGET}.md`, `${MARKER}-top\n`);
  try {
    await show(BLANK);
    await clearReads();
    await sb.lua(T.alice, S.gamma, `return markdown.expandMarkdown(space.readPage(${JSON.stringify(PAGE)}))`);
    let reads = await fsReads();
    assert.ok(reads.includes(`${PAGE}.md`) && reads.includes(`${TARGET}.md`), `expandMarkdown: ${reads.join(", ")}`);
    await clearReads();
    await show(PAGE);
    reads = await fsReads();
    assert.ok(reads.includes(`${PAGE}.md`) && reads.includes(`${TARGET}.md`), `navigate: ${reads.join(", ")}`);
    await show(BLANK);
    await clearReads();
    await show(PAGE);
    reads = await fsReads();
    assert.ok(reads.includes(`${PAGE}.md`) && reads.includes(`${TARGET}.md`), `navigate again, no cache: ${reads.join(", ")}`);
  } finally {
    await show(BLANK);
    await sb.remove(T.admin, S.gamma, `${PAGE}.md`);
  }
});

test("[watch] loads: navigating to the page already shown reads the page again but not its transclusions (the screenshot leaves the page first)", async () => {
  await sb.write(T.admin, S.gamma, `${PAGE}.md`, `shown-top\n\n![[${TARGET}]]\n`);
  await sb.write(T.admin, S.gamma, `${TARGET}.md`, `${MARKER}-top\n`);
  try {
    await show(BLANK);
    await show(PAGE);
    await quiet();
    await show(PAGE);
    const reads = await fsReads();
    assert.ok(reads.includes(`${PAGE}.md`), `the page itself: ${reads.join(", ")}`);
    assert.ok(!reads.includes(`${TARGET}.md`), `the transclusion is now read again on a same-page navigation: ${reads.join(", ")}`);
  } finally {
    await show(BLANK);
    await sb.remove(T.admin, S.gamma, `${PAGE}.md`);
  }
});

test("[watch] transclusion: the editor expands a transclusion that an expression returns as a string and reads its target (the render check sees the read; the write filter cannot see the name)", async () => {
  await sb.write(T.admin, S.gamma, `${PAGE}.md`, `shown-top\n\n\${"![[" .. ${JSON.stringify(TARGET)} .. "]]"}\n`);
  await sb.write(T.admin, S.gamma, `${TARGET}.md`, `${MARKER}-top\n`);
  try {
    await show(BLANK);
    await clearReads();
    await show(PAGE);
    const reads = await fsReads();
    const text = String((await sb.lua(T.alice, S.gamma, `return tostring(js.window.document.body.innerText)`)).result);
    assert.ok(text.includes(MARKER), `the editor no longer expands the built transclusion: ${text.slice(0, 120)}`);
    assert.ok(reads.includes(`${TARGET}.md`), `the target was not read over HTTP: ${reads.join(", ")}`);
  } finally {
    await show(BLANK);
    await sb.remove(T.admin, S.gamma, `${PAGE}.md`);
  }
});

test("loads: a navigation to a page that does not exist shows an empty editor and creates nothing", async () => {
  await show(BLANK);
  await new Promise((r) => setTimeout(r, 2000));
  assert.equal((await sb.read(T.admin, S.gamma, `${BLANK}.md`)).status, 404, "the blank page was created");
});
