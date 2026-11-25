import test from "node:test";
import assert from "node:assert/strict";
import { Scanner, SHIPPED_TRANSFORM } from "./scan.ts";
import { State } from "./state.ts";
import { majorOf, SbError, type SilverBullet } from "./sb.ts";
import { shippedAllowlist } from "./filter/allowlist.ts";
import type { Config } from "./config.ts";
import type { Log } from "./log.ts";

const BLOCK = `# Configuration\n\n\`\`\`space-lua\n${SHIPPED_TRANSFORM}\n\`\`\`\n`;

/** One scan of a space `s` that holds `files`, on an instance that names `release`; returns the state and the report. */
async function scan(release: string | null, files: Record<string, string>) {
  let report = "";
  const sb = {
    config: () => Promise.resolve({ readOnly: false, spacePrefixes: ["/s"] }),
    version: () => Promise.resolve(release),
    list: () => Promise.resolve(Object.keys(files).map((name) => ({ name, lastModified: 0, contentType: "text/markdown", size: files[name].length, perm: "rw" as const }))),
    read: (_t: string, space: string, path: string) =>
      path in files ? Promise.resolve({ etag: '"e"', body: Buffer.from(files[path]), contentType: "text/markdown" }) : Promise.reject(new SbError(404, space, path, "")),
    write: (_t: string, _s: string, path: string, text: string) => {
      assert.equal(path, "MCP Server.md");
      report = text;
      return Promise.resolve({ etag: null });
    },
  } as unknown as SilverBullet;
  const state = new State("MCP Server", "scan");
  state.allowlist = state.credentials = state.accessList = { ok: true, problems: [] };
  const log = { info() {}, warn() {}, error() {} } as unknown as Log;
  const config = { spaces: ["s"], reportPage: "MCP Server", scanUser: "scan", scanMode: "report", scanInterval: 900_000 } as unknown as Config;
  const scanner = new Scanner({ sb, state, config, log, scanToken: () => "t", seedSpaces: () => ["s"], allowlist: shippedAllowlist, allowedFiles: () => [], version: "0" });
  const summary = await scanner.run();
  return { state, s: state.space("s"), summary, report, refusal: state.refusal("s") };
}

test("majorOf: the major release of a version string", () => {
  assert.equal(majorOf("3.0.0-0-g0f9b90bb-2026-11-24T11-45-24Z"), 3);
  assert.equal(majorOf("2.12.1"), 2);
  assert.equal(majorOf("v10.1"), 10);
  for (const v of [null, "", "edge", "3", "x3.0.0"]) assert.equal(majorOf(v), null, String(v));
});

test("scan: SilverBullet 2 needs the transform in CONFIG; Library/Config does not count, and neither does a release it does not name", async () => {
  for (const release of ["2.12.1-0-g4d5eac53", null]) {
    const ok = await scan(release, { "CONFIG.md": BLOCK });
    assert.equal(ok.s.transform, "present");
    assert.equal(ok.refusal, null);
    assert.equal(ok.s.findings.length, 0, "CONFIG is a code place");
    for (const files of [{ "Library/Config.md": BLOCK }, { "CONFIG.md": "nothing\n" }, {}] as Array<Record<string, string>>) {
      const missing = await scan(release, files);
      assert.equal(missing.s.transform, "missing");
      assert.deepEqual(missing.summary.missingTransform, ["s"]);
      assert.match(missing.refusal ?? "", /^Refusing to serve space "s": the index-time transform is missing from CONFIG or differs from the shipped block/);
      assert.match(missing.report, /Transform block in CONFIG: \*\*missing\*\*/);
    }
  }
});

test("scan: SilverBullet 3 needs no transform, and CONFIG is a page like any other there", async () => {
  const plain = await scan("3.0.0-0-g0f9b90bb", { "index.md": "Hello\n", "Library/Config.md": "```space-lua\nx = 1\n```\n" });
  assert.equal(plain.s.transform, "not-needed");
  assert.equal(plain.refusal, null);
  assert.deepEqual(plain.summary.missingTransform, []);
  assert.equal(plain.s.findings.length, 0);
  assert.match(plain.report, /\* SilverBullet: `3\.0\.0-0-g0f9b90bb`\n\* Transform block in CONFIG: not needed/);
  assert.match(plain.report, /every page outside Library\/ is data/);
  const left = await scan("3.0.0", { "CONFIG.md": BLOCK, "Library/Config.md": BLOCK });
  assert.deepEqual(left.s.findings.map((f) => [f.page, f.rule]), [["CONFIG", "fence"]]);
  assert.equal(left.refusal, null, "findings block rendering, not the space");
  assert.match(left.state.renderBlock("s") ?? "", /1 finding\(s\) on 1 page\(s\) with code outside Library\//);
});
