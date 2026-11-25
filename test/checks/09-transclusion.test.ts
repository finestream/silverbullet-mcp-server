// Transclusions as the write filter's rule reads them (docs/security.md,
// section 5): which forms SilverBullet expands, where, and which it leaves
// alone. The rule refuses every form asserted here to expand; a form that
// starts to expand in a later release must be added to the filter.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { sb, T, S, V3, until } from "../lib/env.ts";
import { checkPage, FileIndex } from "../../src/filter/filter.ts";
import { shippedAllowlist } from "../../src/filter/allowlist.ts";

const TARGET = "Transcluded/Deep";
const MARKER = "marker-transcluded";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

before(async () => {
  await sb.write(T.admin, S.gamma, `${TARGET}.md`, `${MARKER}-top\n\n## Part\n${MARKER}-part\n`);
  await sb.write(T.admin, S.gamma, "Transcluded/note.txt", `${MARKER}-file\n`);
  await sb.write(T.admin, S.gamma, "Transcluded/pic.png", PNG);
  await sb.write(T.admin, S.gamma, "pic.png.md", "a page, not the image\n");
  await sb.runtimeReady(T.alice, S.gamma);
});

after(async () => {
  await sb.remove(T.admin, S.gamma, `${TARGET}.md`);
  await sb.remove(T.admin, S.gamma, "Transcluded/note.txt");
  await sb.remove(T.admin, S.gamma, "Transcluded/pic.png");
  await sb.remove(T.admin, S.gamma, "pic.png.md");
});

const expand = async (markdown: string) => {
  const r = await sb.lua(T.alice, S.gamma, `return markdown.renderParseTree(markdown.expandMarkdown(markdown.parseMarkdown(${JSON.stringify(markdown)})))`);
  return String(r.result ?? r.error ?? r.raw);
};

/** The files of the space, as the server looks a target up among them. */
const FILES = new FileIndex(["index.md", "Projects/One.md", `${TARGET}.md`, "Transcluded/note.txt", "Transcluded/pic.png", "Transcluded/Shown.md", "pic.png.md"]);
/**
 * A target in another case, and one named by the end of its path: the editor of both releases shows
 * the file, and so does the expansion since 3.0.
 */
const LOOSE = [`![[${TARGET.toLowerCase()}]]`, "![[Deep]]", "![[deep]]", "![[/Deep]]", "![[^Deep]]", "![[Deep.md]]", "![[Deep.MD]]", `![[${TARGET}.MD]]`, "![[Deep#Part]]"];
/** The same in the image form, which neither release looks up. */
const LOOSE_IMAGE = ["![x](Deep)", "![x](/Deep)", "![x](Deep.md)", `![x](/${TARGET.toLowerCase()})`, `![x](/${TARGET}.MD)`, "![x](pic.png)", "![x](/pic.png)"];
/** The filter as a reader who may not read what lies in Transcluded/ sees the page. */
const refused = (markdown: string) =>
  !checkPage(markdown, shippedAllowlist(), {
    page: "Notes/Page",
    denied: (path, lookup) => ([path, ...(lookup ? FILES.others(path) : [])].some((f) => f.startsWith("Transcluded/")) ? "no r" : null),
  }).ok;

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
  `![[Transcluded/note.txt]]`,
  "![[eep]]",
  ...(V3 ? [] : LOOSE),
  ...LOOSE_IMAGE,
];

test("transclusion: every form SilverBullet expands is one the write filter refuses for a reader without r on the target", async () => {
  const leaks: string[] = [];
  for (const form of [...EXPANDED, ...(V3 ? LOOSE : [])]) {
    const out = await expand(form);
    assert.ok(out.includes(MARKER), `expected to expand: ${form} -> ${out.slice(0, 80)}`);
    if (!refused(form)) leaks.push(form);
  }
  assert.deepEqual(leaks, [], "expanded by SilverBullet and accepted by the filter");
});

test("transclusion: code spans, code blocks, links, escapes and (before 3.0) another case and a bare last segment are not expanded; a file that is not a page is not expanded as text", async () => {
  for (const form of NOT_EXPANDED) {
    const out = await expand(form);
    assert.ok(!out.includes(MARKER), `expected to stay: ${form} -> ${out.slice(0, 80)}`);
  }
});

test("transclusion: a transclusion that an expression returns as a string is expanded by markdown.expandMarkdown since 3.0 and left as text before (the editor expands it in both; the filter cannot see it, the render check does)", async () => {
  const out = await expand(`\${"![[${TARGET}]]"}`);
  assert.equal(out.includes(MARKER), V3, out.slice(0, 120));
  assert.equal(out.includes(`![[${TARGET}]]`), !V3, out.slice(0, 120));
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

/** A page in another folder than the target, so that nothing resolves by its folder. */
const ELSEWHERE = "Elsewhere/Shown";
const shownText = async () => String((await sb.lua(T.alice, S.gamma, "return tostring(js.window.document.body.innerText)")).result);
const shownImages = async () => String((await sb.lua(T.alice, S.gamma, `return tostring(js.window.eval([[[...document.querySelectorAll("img")].map((i) => i.getAttribute("src")).join(" ")]]))`)).result);
const showElsewhere = async (text: string, check: () => Promise<void>) => {
  await sb.write(T.admin, S.gamma, `${TARGET}.md`, `${MARKER}-top\n\n## Part\n${MARKER}-part\n`);
  await sb.write(T.admin, S.gamma, `${ELSEWHERE}.md`, text);
  try {
    await show(BLANK);
    await show(ELSEWHERE);
    await check();
  } finally {
    await show(BLANK);
    await sb.remove(T.admin, S.gamma, `${ELSEWHERE}.md`);
  }
};

test("transclusion: the editor of both releases takes a ![[target]] that is not the path of a file for one whose path ends in it, in any case; the write filter refuses it", async () => {
  const leaks: string[] = [];
  for (const form of [...LOOSE, "![[pic.png]]", "![[PIC.png]]"]) {
    const image = form.toLowerCase().includes("pic.png");
    await showElsewhere(`shown-top\n\n${form}\n`, async () => {
      const { value } = await until(async () => (image ? (await shownImages()).includes("Transcluded/pic.png") : (await shownText()).includes(MARKER)), 10_000);
      assert.ok(value, `expected the editor to show the file: ${form}`);
    });
    if (!refused(form)) leaks.push(form);
  }
  assert.deepEqual(leaks, [], "shown by SilverBullet and accepted by the filter");
});

test("transclusion: the image form is never looked up, in the editor of both releases either; the write filter judges it as it is", async () => {
  // Projects/One is the control: its marker says that the page's transclusions have been expanded.
  await showElsewhere(`shown-top\n\n${LOOSE_IMAGE.join("\n\n")}\n\n![one](/Projects/One)\n`, async () => {
    const { value } = await until(async () => (await shownText()).includes("marker-gamma-one"), 10_000);
    assert.ok(value, "the control is expanded");
    await settled();
    assert.ok(!(await shownText()).includes(MARKER), "a page was looked up");
    assert.deepEqual((await shownImages()).split(" ").filter((src) => src.endsWith("pic.png")).sort(), [".fs/Elsewhere/pic.png", ".fs/pic.png"]);
  });
  for (const form of LOOSE_IMAGE.filter((f) => !f.includes("Transcluded/"))) assert.equal(refused(form), false, form);
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
