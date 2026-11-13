// The render check's redaction (docs/security.md, section 12): screenshot-note leaves out a font,
// a stylesheet or an image the caller may not read, with a warning, instead of refusing; a
// transclusion of a denied page still refuses. The theme is a space style in Library/ of gamma,
// which the default access list denies to agents, so its files are denied to alice. Space styles
// apply to every page, so each case writes its own theme and restarts the runtimes, and the
// theme is removed at the end.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { deflateSync, inflateSync } from "node:zlib";
import { startServer, connect, BEARERS, DEFAULT_ACCESS_LIST, unique, type RunningServer, type McpClient } from "./harness.ts";
import { sb, T } from "../lib/env.ts";

const ACCESS =
  DEFAULT_ACCESS_LIST +
  `
alice gamma /          rwx
alice gamma Projects/  rwdx
alice gamma Library/   -
`;

const DIR = "Library/Redact";
const THEME = `${DIR}/Theme.md`;
/** A colour no theme uses: its pixels in a screenshot mean the picture is shown. */
const MARK = [13, 250, 77] as const;

/** A 64×64 PNG in the marker colour. */
function markerPng(): Buffer {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(64, 0);
  ihdr.writeUInt32BE(64, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 64 }, () => [...MARK]).flat())]);
  const raw = Buffer.concat(Array.from({ length: 64 }, () => row));
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** How many pixels of an 8-bit, non-interlaced RGB or RGBA PNG have the marker colour. */
function markerPixels(png: Buffer): number {
  let off = 8;
  let w = 0;
  let h = 0;
  let ch = 0;
  const idat: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("ascii", off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      assert.equal(data[8], 8, "8-bit PNG");
      assert.equal(data[12], 0, "not interlaced");
      ch = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      assert.ok(ch, `colour type ${data[9]}`);
    }
    if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? out[(y - 1) * stride + x - ch] : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      out[y * stride + x] = (v + [0, a, b, (a + b) >> 1, pr][f]) & 0xff;
    }
  }
  let n = 0;
  for (let i = 0; i < out.length; i += ch) if (out[i] === MARK[0] && out[i + 1] === MARK[1] && out[i + 2] === MARK[2]) n++;
  return n;
}

let server: RunningServer;
let alice: McpClient;
const files: string[] = [];
const write = async (file: string, body: string | Buffer) => {
  files.push(file);
  const r = await sb.write(T.admin, "gamma", file, body);
  assert.ok(r.status < 300, `${file}: ${r.status}`);
};
const page = async (body: string) => {
  const name = unique("Projects/Redact");
  await write(`${name}.md`, body);
  return name;
};
const inRuntime = async (js: string) => String((await sb.lua(T.alice, "gamma", `return tostring(js.window.eval(${JSON.stringify(js)}))`)).result);

/** Writes the theme and boots a fresh runtime, which loads the space styles; waits until they are in the document. */
async function theme(style: string) {
  await write(THEME, "# Redaction test theme\n\n```space-style\n" + style + "\n/* sbmcp-redact-theme */\n```\n");
  // SilverBullet's reset was seen to fail ("remove browser profile: Directory not empty") and leave the runtime unavailable until the next reset.
  for (let attempt = 1; ; attempt++) {
    await sb.admin.resetRuntimes(T.admin);
    try {
      await sb.runtimeReady(T.alice, "gamma", 45000);
      break;
    } catch (e) {
      if (attempt === 3) throw e;
    }
  }
  const until = Date.now() + 30000;
  for (;;) {
    if ((await inRuntime(`document.getElementById("custom-styles")?.innerHTML ?? ""`)).includes(style.slice(0, 40))) return;
    assert.ok(Date.now() < until, "the runtime did not load the test theme");
    await sb.lua(T.alice, "gamma", "system.loadSpaceStyles()");
    await new Promise((r) => setTimeout(r, 500));
  }
}

before(async () => {
  await write(`${DIR}/mark.png`, markerPng());
  await write("Projects/Redact-ok.png", markerPng());
  await write(`${DIR}/face.woff2`, Buffer.from("not a font, fetched all the same"));
  await write(`${DIR}/theme.css`, "#sb-main { background-image: url(/gamma/.fs/Projects/Redact-ok.png); }\n");
  await write(`${DIR}/Note.md`, "marker-redact-note\n");
  // The readable control image is a file outside Library/, which the scan reports unless it is allowed.
  server = await startServer({ accessList: ACCESS, allowedFiles: "gamma Projects/Redact-ok.png\n" });
  alice = await connect(server.url, BEARERS.alice);
});

after(async () => {
  await alice?.close();
  await server?.stop();
  for (const f of files.reverse()) await sb.remove(T.admin, "gamma", f);
  await sb.admin.resetRuntimes(T.admin);
});

const shot = async (name: string) => {
  const r = await alice.call("screenshot-note", { space: "gamma", filename: name });
  assert.equal(r.isError, false, r.text);
  assert.ok(r.image, "image content");
  return { ...r, png: Buffer.from(r.image!.data, "base64") };
};

test("redaction: a readable image in the marker colour shows in the screenshot (the pixel check works)", async () => {
  await theme("/* no assets */");
  const name = await page("# Readable\n\n![ok](/Projects/Redact-ok.png)\n");
  const r = await shot(name);
  assert.ok(markerPixels(r.png) > 1000, "the readable image is shown");
  assert.deepEqual(r.data!.redacted, { font: [], style: [], image: [] });
  assert.deepEqual(r.data!.warnings, []);
});

test("redaction: a denied image in the page and a denied font and background of the theme are left out, with warnings; the second screenshot, served from the browser's cache, too; the theme is whole again afterwards", async () => {
  await theme(
    [
      `@font-face { font-family: SbmcpRedact; src: url(/gamma/.fs/${DIR}/face.woff2) format("woff2"); }`,
      `#sb-main .cm-content { font-family: SbmcpRedact, serif; }`,
      `#sb-main { background-image: url(/gamma/.fs/${DIR}/mark.png); }`,
    ].join("\n"),
  );
  const name = await page(`# Denied picture\n\n![denied](/${DIR}/mark.png)\n\nSome text.\n`);
  for (const round of ["first", "second, from the cache"]) {
    const r = await shot(name);
    assert.equal(markerPixels(r.png), 0, `${round}: the denied picture does not appear`);
    assert.deepEqual(r.data!.redacted, { font: [`${DIR}/face.woff2`], style: [], image: [`${DIR}/mark.png`] }, round);
    const warnings = (r.data!.warnings as string[]).join("\n");
    assert.match(warnings, new RegExp(`Fonts not readable \\(user "alice" has no "r" on it in the access list\\), shown with a substitute font: gamma/${DIR}/face\\.woff2\\.`), round);
    assert.match(warnings, new RegExp(`Images not readable .*replaced by a placeholder: gamma/${DIR}/mark\\.png\\.`), round);
    assert.match(r.text, /\[Warning: .*Fonts not readable/, "the warning is in the text too");
  }
  const restored = await inRuntime(`[...document.querySelectorAll("#custom-styles style")].map((s) => s.sheet.cssRules.length + ":" + s.sheet.disabled).join(",") + " " + getComputedStyle(document.getElementById("sb-main")).backgroundImage`);
  assert.match(restored, /mark\.png/, `the background is back in the runtime: ${restored}`);
  assert.doesNotMatch(restored, /true/, `no space style left disabled: ${restored}`);
  assert.match(await inRuntime(`[...document.styleSheets].flatMap((s) => [...s.cssRules]).filter((r) => r instanceof CSSFontFaceRule).map((r) => r.cssText).join(" ")`), /face\.woff2/, "the font face is back");
});

test("redaction: a denied stylesheet turns the space styles off for the screenshot, with a warning; they are on again afterwards", async () => {
  await theme(`@import url(/gamma/.fs/${DIR}/theme.css);\n#sb-main { outline: 1px solid transparent; }`);
  const name = await page("# Styled\n\nSome text.\n");
  const r = await shot(name);
  assert.equal(markerPixels(r.png), 0, "the denied stylesheet's background (a readable image) is not applied");
  assert.deepEqual(r.data!.redacted, { font: [], style: [`${DIR}/theme.css`], image: [] });
  assert.match((r.data!.warnings as string[]).join("\n"), new RegExp(`Stylesheets not readable .*shown in SilverBullet's default theme \\(space styles off\\): gamma/${DIR}/theme\\.css\\.`));
  assert.match(await inRuntime(`getComputedStyle(document.getElementById("sb-main")).backgroundImage`), /Redact-ok\.png/, "the space styles are on again in the runtime");
});

test("redaction: a transclusion of a denied page still refuses, also next to a denied image", async () => {
  await theme("/* no assets */");
  const name = await page(`# Both\n\n![denied](/${DIR}/mark.png)\n\n![[${DIR}/Note]]\n`);
  const r = await alice.call("screenshot-note", { space: "gamma", filename: name });
  assert.equal(r.isError, true, r.text);
  assert.match(r.text, new RegExp(`^Refused by the render check: the render loaded what its reader may not read \\(gamma/${DIR}/Note: user "alice" has no "r"\\)`));
  assert.equal(r.image, undefined);
  const md = await alice.call("render-note", { space: "gamma", filename: name });
  assert.equal(md.isError, true, "render-note keeps its check");
});
