import test from "node:test";
import assert from "node:assert/strict";
import { BLANK_PAGE, judgeLoads, loadedPath, LOADS_BUFFER, luaString, navigateScript, parseLoads, renderScript, RESTORE_SCRIPT } from "./render.ts";

test("loads: a resource-timing URL of the space's file API becomes the file's path, decoded; everything else is ignored", () => {
  assert.equal(loadedPath("http://silverbullet:3000/gamma/.fs/Projects/One.md", "gamma"), "Projects/One.md");
  assert.equal(loadedPath("http://127.0.0.1:3000/gamma/.fs/Render/With%20Space.md", "gamma"), "Render/With Space.md");
  assert.equal(loadedPath("http://127.0.0.1:3000/gamma/.fs/Pictures/a%2Bb.png", "gamma"), "Pictures/a+b.png");
  assert.equal(loadedPath("http://127.0.0.1:3000/gamma/.fs", "gamma"), null, "the listing");
  assert.equal(loadedPath("http://127.0.0.1:3000/gamma/.fs/", "gamma"), null, "the listing with a slash");
  assert.equal(loadedPath("http://127.0.0.1:3000/beta/.fs/Secret.md", "gamma"), null, "another space");
  assert.equal(loadedPath("http://127.0.0.1:3000/gamma/.client/boot.js", "gamma"), null, "a client asset");
  assert.equal(loadedPath("http://127.0.0.1:3000/gamma/.runtime/lua_script", "gamma"), null);
  assert.equal(loadedPath(`http://127.0.0.1:3000/gamma/.fs/${BLANK_PAGE}.md`, "gamma"), null, "the blank page the runtime is parked on");
  assert.equal(loadedPath("not a url", "gamma"), null);
  assert.equal(loadedPath("http://127.0.0.1:3000/gamma/.fs/%E0%A4%A", "gamma"), null, "undecodable");
});

test("loads: the read script's JSON becomes the files of the space, in order and without repeats, with the overflow flag", () => {
  const raw = JSON.stringify({
    full: false,
    urls: ["http://h/gamma/.fs/Rendered.md", "http://h/gamma/.fs/Projects/One.md", "http://h/gamma/.fs", "http://h/gamma/.fs/Rendered.md", "http://h/gamma/.client/x.js"],
  });
  assert.deepEqual(parseLoads(raw, "gamma"), { files: ["Rendered.md", "Projects/One.md"], full: false, entries: 5 });
  assert.deepEqual(parseLoads(JSON.stringify({ full: true, urls: [] }), "gamma"), { files: [], full: true, entries: 0 });
  assert.throws(() => parseLoads(undefined, "gamma"), /no resource timing/);
  assert.throws(() => parseLoads("{", "gamma"), SyntaxError);
});

test("judge: files the caller may not read are denied, the rendered page itself excepted; a readable set passes", () => {
  const mayRead = (f: string) => !f.startsWith("Private/") && f !== "CONFIG.md";
  const loads = { files: ["Notes/Page.md", "Projects/One.md", "Private/Plan.md", "CONFIG.md", "Pictures/a.png"], full: false, entries: 5 };
  assert.deepEqual(judgeLoads(loads, "Notes/Page.md", mayRead), { blind: null, denied: ["Private/Plan.md", "CONFIG.md"] });
  assert.deepEqual(judgeLoads({ files: ["Notes/Page.md", "Projects/One.md"], full: false, entries: 2 }, "Notes/Page.md", mayRead), { blind: null, denied: [] });
  // x suffices for the page rendered: no r needed on it.
  assert.deepEqual(judgeLoads({ files: ["Private/Plan.md"], full: false, entries: 1 }, "Private/Plan.md", mayRead), { blind: null, denied: [] });
});

test("judge: blind when the page's own read is missing or the browser dropped entries; the denied files are still named", () => {
  const mayRead = () => true;
  const missing = judgeLoads({ files: ["Projects/One.md"], full: false, entries: 1 }, "Notes/Page.md", mayRead);
  assert.match(missing.blind!, /the page's own read is missing from the browser's resource timing \(1 entries\)/);
  const empty = judgeLoads({ files: [], full: false, entries: 0 }, "Notes/Page.md", mayRead);
  assert.match(empty.blind!, /own read is missing/);
  const full = judgeLoads({ files: ["Notes/Page.md", "Private/Plan.md"], full: true, entries: LOADS_BUFFER }, "Notes/Page.md", () => false);
  assert.match(full.blind!, new RegExp(`more than ${LOADS_BUFFER} resources`));
  assert.deepEqual(full.denied, ["Private/Plan.md"]);
});

test("scripts: the render and navigate scripts start the resource timing before the page is read or shown; restore parks the runtime on the blank page", () => {
  const render = renderScript("Notes/Page");
  const begin = render.indexOf("clearResourceTimings");
  assert.ok(begin > 0 && begin < render.indexOf("space.readPage(name)"), "timing cleared before the page is read");
  assert.ok(render.indexOf("getEntriesByType") > render.indexOf("markdown.expandMarkdown"), "timing read after the expansion");
  assert.match(render, /result\.loads = loads/);
  const navigate = navigateScript("Notes/Page");
  assert.ok(navigate.indexOf("clearResourceTimings") < navigate.indexOf("editor.navigate"), "timing cleared before the navigation");
  assert.match(RESTORE_SCRIPT, new RegExp(`editor\\.navigate\\(\\[\\[\\n${BLANK_PAGE}\\]\\]\\)`));
  assert.equal(luaString("a]]b"), "[=[\na]]b]=]");
});
