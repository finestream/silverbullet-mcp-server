// What the redaction of screenshot-note rests on (docs/security.md, section 12): how the
// headless client shows fonts, stylesheets and images, and that the server's inventory and
// redaction scripts find, change and restore them. The theme is a space style in Library/ of
// gamma; space styles apply to every page, so it is removed and the runtimes reset at the end.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { sb, T, S, sleep } from "../lib/env.ts";
import { INSPECT_SCRIPT, UNDO_SCRIPT, parseLoads, parseRedaction, parseUses, redactScript } from "../../src/render.ts";

const DIR = "Library/RedactCheck";
const PAGE = "RedactCheck/Shown";
const BLANK = "_sbmcp/blank";
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000002000000020802000000fdd49a730000001049444154789c631050300022060805000a0e01815633eef30000000049454e44ae426082", "hex");
const STYLE = [
  `@import url(/gamma/.fs/${DIR}/extra.css);`,
  `@font-face { font-family: SbmcpCheck; src: url(/gamma/.fs/${DIR}/face.woff2) format("woff2"); }`,
  `#sb-main .cm-content { font-family: SbmcpCheck, serif; }`,
  `#sb-main { background-image: url(/gamma/.fs/${DIR}/bg.png); }`,
].join("\n");
const files = [`${DIR}/Theme.md`, `${DIR}/extra.css`, `${DIR}/face.woff2`, `${DIR}/bg.png`, `${DIR}/pic.png`, `${PAGE}.md`];

const lua = async (script: string) => {
  const r = await sb.lua(T.alice, S.gamma, script);
  assert.equal(r.status, 200, r.raw);
  if (r.error) throw new Error(r.error);
  return r.result;
};
const inPage = async (js: string) => String(await lua(`return tostring(js.window.eval(${JSON.stringify(js)}))`));
/** Waits until three polls 50 ms apart brought no new resource-timing entry. */
const settled = async () => {
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 40 && stable < 3; i++) {
    await sleep(50);
    const n = Number(await inPage(`performance.getEntriesByType("resource").length`));
    stable = n === last ? stable + 1 : 0;
    last = n;
  }
};
const show = async (page: string) => {
  await lua(`editor.navigate(${JSON.stringify(page)})`);
  await settled();
};
const inspect = async () => {
  const r = (await lua(INSPECT_SCRIPT)) as { loads: unknown; uses: unknown };
  return { loads: parseLoads(r.loads, S.gamma), uses: parseUses(r.uses, S.gamma) };
};
const timing = async () => JSON.parse(await inPage(`JSON.stringify(performance.getEntriesByType("resource").filter((e) => e.name.includes("/.fs/${DIR}/")).map((e) => [e.name.split("/").pop(), e.initiatorType]))`)) as Array<[string, string]>;
const customSheets = () => inPage(`[...document.querySelectorAll("#custom-styles style")].map((s) => s.sheet.disabled).join(",")`);

/**
 * Resets the runtimes, so that a fresh one applies the theme. SilverBullet's reset was seen to fail
 * ("remove browser profile: Directory not empty") and leave the runtime unavailable until the next reset.
 */
async function freshRuntime() {
  for (let attempt = 1; ; attempt++) {
    await sb.admin.resetRuntimes(T.admin);
    try {
      await sb.runtimeReady(T.alice, S.gamma, 45000);
      return;
    } catch (e) {
      if (attempt === 3) throw e;
    }
  }
}

before(async () => {
  await sb.write(T.admin, S.gamma, `${DIR}/extra.css`, `#sb-main { outline: 3px solid rgb(1, 2, 3); }\n`);
  await sb.write(T.admin, S.gamma, `${DIR}/face.woff2`, "not a font");
  await sb.write(T.admin, S.gamma, `${DIR}/bg.png`, PNG);
  await sb.write(T.admin, S.gamma, `${DIR}/pic.png`, PNG);
  await sb.write(T.admin, S.gamma, `${PAGE}.md`, `# Shown\n\n![pic](/${DIR}/pic.png)\n`);
  await sb.write(T.admin, S.gamma, `${DIR}/Theme.md`, "# Theme\n\n```space-style\n" + STYLE + "\n```\n");
  await freshRuntime();
  const until = Date.now() + 30000;
  while (!(await inPage(`document.getElementById("custom-styles")?.innerHTML ?? ""`)).includes("SbmcpCheck")) {
    assert.ok(Date.now() < until, "the runtime did not load the theme");
    await lua("system.loadSpaceStyles()");
    await sleep(500);
  }
});

after(async () => {
  await lua(UNDO_SCRIPT).catch(() => {});
  for (const f of files) await sb.remove(T.admin, S.gamma, f);
  // Also so that the next check file does not find a runtime the reset left unavailable.
  await freshRuntime();
});

test("redaction: space styles are <style> elements in #custom-styles; the document fetches their imports, fonts and backgrounds as \"css\", an image of the page as \"img\"; the inventory tells the page's own read from what is presented", async () => {
  // The theme's files were fetched when the fresh runtime applied it (before()); they are cached since.
  const boot = await timing();
  assert.match(await inPage(`document.getElementById("custom-styles").innerHTML`), /<style>[^<]*SbmcpCheck/);
  for (const [file, initiator] of [["extra.css", "css"], ["face.woff2", "css"], ["bg.png", "css"]]) {
    assert.ok(boot.some(([f, i]) => f === file && i === initiator), `${file} as ${initiator}: ${JSON.stringify(boot)}`);
  }
  await show(BLANK);
  await inPage("performance.clearResourceTimings()");
  await show(PAGE);
  assert.ok((await timing()).some(([f, i]) => f === "pic.png" && i === "img"), "the image as img");
  const { loads } = await inspect();
  assert.ok(loads.files.includes(`${PAGE}.md`) && !loads.presented!.includes(`${PAGE}.md`), "the page is a read of the client, not presented");
  assert.ok(loads.presented!.includes(`${DIR}/pic.png`), "the image is presented");
  assert.ok(!loads.presented!.includes(`${DIR}/bg.png`), "the theme's background, served from the cache, left no entry");
});

test("[watch] redaction: an image shown again from the browser's memory cache leaves no resource-timing entry (the inventory of the document is the authority)", async () => {
  await show(BLANK);
  await show(PAGE);
  await show(BLANK);
  await inPage("performance.clearResourceTimings()");
  await show(PAGE);
  assert.match(await inPage(`[...document.querySelectorAll("img")].map((i) => i.currentSrc + " " + i.naturalWidth).join(";")`), /pic\.png 2/, "the image is shown");
  assert.deepEqual((await timing()).filter(([f]) => f === "pic.png"), [], "the image now leaves an entry again");
});

test("redaction: the inventory finds the stylesheet, the font face, the background and the image the shown page uses", async () => {
  await show(PAGE);
  const { uses } = await inspect();
  const has = (path: string, via: string) => uses.uses.some((u) => u.path === `${DIR}/${path}` && u.via === via);
  assert.ok(has("extra.css", "sheet") && has("face.woff2", "font") && has("bg.png", "css") && has("pic.png", "element"), JSON.stringify(uses));
  assert.equal(uses.blob, false, "no blob: URL on a plain page");
});

test("redaction: removing a @font-face rule drops the face from document.fonts; a placeholder replaces a cached image and a background, and stays through a settle; undo restores all", async () => {
  await lua(UNDO_SCRIPT); // a check that failed before its own undo must not leave its redactions to this one
  await show(PAGE);
  const fonts = () => inPage(`[...document.fonts].filter((f) => f.family.includes("SbmcpCheck")).length`);
  assert.notEqual(await fonts(), "0", "the face is in document.fonts");
  const r = parseRedaction(await lua(redactScript(S.gamma, { font: [`${DIR}/face.woff2`], style: [], image: [`${DIR}/pic.png`, `${DIR}/bg.png`] })), S.gamma);
  assert.deepEqual([...r.paths].sort(), [`${DIR}/bg.png`, `${DIR}/face.woff2`, `${DIR}/pic.png`]);
  assert.equal(r.stylesOff, false);
  await settled();
  await sleep(500);
  assert.equal(await fonts(), "0", "the face is gone");
  assert.match(await inPage(`[...document.querySelectorAll("img")].map((i) => i.currentSrc.slice(0, 19) + " " + i.naturalWidth).join(";")`), /^data:image\/svg\+xml, 320/, "the placeholder is shown");
  assert.match(await inPage(`getComputedStyle(document.getElementById("sb-main")).backgroundImage`), /data:image\/svg\+xml/);
  const { uses } = await inspect();
  assert.deepEqual(uses.uses.filter((u) => /face|pic|bg/.test(u.path)), [], "nothing denied left in use");
  assert.ok(Number(await lua(UNDO_SCRIPT)) > 0);
  assert.notEqual(await fonts(), "0", "the face is back");
  assert.match(await inPage(`getComputedStyle(document.getElementById("sb-main")).backgroundImage`), /bg\.png/, "the background is back");
});

test("redaction: a disabled #custom-styles sheet takes its imports, fonts and backgrounds with it, and stays disabled through a navigation; undo enables it", async () => {
  await lua(UNDO_SCRIPT); // a check that failed before its own undo must not leave its redactions to this one
  await show(PAGE);
  const outline = () => inPage(`getComputedStyle(document.getElementById("sb-main")).outlineColor`);
  assert.equal(await outline(), "rgb(1, 2, 3)", "the imported sheet applies");
  const r = parseRedaction(await lua(redactScript(S.gamma, { font: [], style: [`${DIR}/extra.css`], image: [] })), S.gamma);
  assert.equal(r.stylesOff, true);
  assert.ok(r.paths.includes(`${DIR}/face.woff2`) && r.paths.includes(`${DIR}/bg.png`), `withdrawn with the sheet: ${r.paths} ${await inPage(`document.getElementById("custom-styles").innerHTML`)}`);
  assert.notEqual(await outline(), "rgb(1, 2, 3)", "the import no longer applies");
  assert.doesNotMatch(await inPage(`getComputedStyle(document.getElementById("sb-main")).backgroundImage`), /bg\.png/);
  assert.equal((await inspect()).uses.uses.filter((u) => u.path.startsWith(`${DIR}/`) && u.via !== "element").length, 0, "the inventory skips disabled sheets");
  await show(BLANK);
  await show(PAGE);
  assert.doesNotMatch(await customSheets(), /false/, "a navigation does not rebuild the space styles");
  await lua(UNDO_SCRIPT);
  assert.doesNotMatch(await customSheets(), /true/);
  assert.equal(await outline(), "rgb(1, 2, 3)");
});

test("redaction: Chrome serialises the strings of image-set() as url(), so url() is every reference a declaration holds", async () => {
  const text = await inPage(`(() => { const s = document.createElement("style"); s.textContent = '.a { background-image: image-set("x.png" 1x); } .b { background-image: -webkit-image-set("y.png" 1x); }'; document.head.appendChild(s); const t = [...s.sheet.cssRules].map((r) => r.cssText).join(" "); s.remove(); return t; })()`);
  assert.match(text, /image-set\(url\("x\.png"\) 1x\)/);
  assert.match(text, /image-set\(url\("y\.png"\) 1x\)/);
});

test("[watch] redaction: SilverBullet's Lua parser rejects a level-1 long-bracket string that holds ]]] and a later ]] (the server sends its client script base64-encoded)", async () => {
  const r = await sb.lua(T.alice, S.gamma, "local x = [=[\n[[a]]]; [[b]]\n]=]\nreturn 1");
  assert.ok(r.error, `the parser now accepts it: ${r.raw}`);
});

test("redaction: the client attaches no closed shadow root and draws no canvas while it shows pages (the inventory sees neither; a canvas makes the check blind)", async () => {
  await show(BLANK);
  await inPage(`(() => { const orig = Element.prototype.attachShadow; window.__sbmcpShadow = { open: 0, closed: 0 }; Element.prototype.attachShadow = function (init) { window.__sbmcpShadow[init && init.mode === "closed" ? "closed" : "open"]++; return orig.call(this, init); }; window.__sbmcpShadowOrig = orig; return true; })()`);
  try {
    for (const page of [PAGE, "Rendered", "index", PAGE]) await show(page);
    const counts = JSON.parse(await inPage(`JSON.stringify(window.__sbmcpShadow)`)) as { open: number; closed: number };
    assert.equal(counts.closed, 0, `closed shadow roots attached: ${counts.closed}`);
    assert.equal(await inPage(`String(document.querySelectorAll("canvas").length)`), "0", "a canvas in the shown page");
    assert.equal(await inPage(`[...document.querySelectorAll("*")].filter((e) => e.localName.includes("-") && customElements.get(e.localName)).map((e) => e.localName).join(",")`), "", "custom elements, which may hold a closed shadow root attached before the patch");
  } finally {
    await inPage(`(() => { if (window.__sbmcpShadowOrig) Element.prototype.attachShadow = window.__sbmcpShadowOrig; return true; })()`);
  }
});
