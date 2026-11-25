import test from "node:test";
import assert from "node:assert/strict";
import { quarantine, Scanner, SHIPPED_TRANSFORM } from "./scan.ts";
import { State } from "./state.ts";
import { majorOf, SbError, type SilverBullet } from "./sb.ts";
import { shippedAllowlist } from "./filter/allowlist.ts";
import { checkPage } from "./filter/filter.ts";
import { compileAccessList, parseAccessList } from "./access.ts";
import type { Config } from "./config.ts";
import type { Log } from "./log.ts";

const BLOCK = `# Configuration\n\n\`\`\`space-lua\n${SHIPPED_TRANSFORM}\n\`\`\`\n`;

type Answer = string | null | Error;

/** One scan of a space `s` that holds `files`, on an instance that names `release` (an error: it does not answer); returns the state and the report. */
async function scan(release: Answer, files: Record<string, string>, opts: { state?: State; accessList?: string } = {}) {
  let report = "";
  const sb = {
    config: () => Promise.resolve({ readOnly: false, spacePrefixes: ["/s"] }),
    version: () => (release instanceof Error ? Promise.reject(release) : Promise.resolve(release)),
    list: () => Promise.resolve(Object.keys(files).map((name) => ({ name, lastModified: 0, contentType: "text/markdown", size: files[name].length, perm: "rw" as const }))),
    read: (_t: string, space: string, path: string) =>
      path in files ? Promise.resolve({ etag: '"e"', body: Buffer.from(files[path]), contentType: "text/markdown" }) : Promise.reject(new SbError(404, space, path, "")),
    write: (_t: string, _s: string, path: string, text: string) => {
      assert.equal(path, "MCP Server.md");
      report = text;
      return Promise.resolve({ etag: null });
    },
  } as unknown as SilverBullet;
  const state = opts.state ?? new State("MCP Server", "scan");
  state.allowlist = state.credentials = state.accessList = { ok: true, problems: [] };
  const log = { info() {}, warn() {}, error() {} } as unknown as Log;
  const config = { spaces: ["s"], reportPage: "MCP Server", scanUser: "scan", scanMode: "report", scanInterval: 900_000 } as unknown as Config;
  const acl = opts.accessList === undefined ? null : compileAccessList(parseAccessList(opts.accessList).entries);
  const subjects = [{ user: "alice", groups: [] }];
  const scanner = new Scanner({ sb, state, config, log, scanToken: () => "t", seedSpaces: () => ["s"], allowlist: shippedAllowlist, allowedFiles: () => [{ space: "*", path: "Files/" }], accessList: () => acl, subjects: () => subjects, version: "0" });
  const summary = await scanner.run();
  return { state, s: state.space("s"), summary, report, refusal: state.refusal("s") };
}

test("majorOf: the major release of a version string", () => {
  assert.equal(majorOf("3.0.0-0-g0f9b90bb-2026-11-24T11-45-24Z"), 3);
  assert.equal(majorOf("2.12.1"), 2);
  assert.equal(majorOf("v10.1"), 10);
  for (const v of [null, "", "edge", "3", "x3.0.0"]) assert.equal(majorOf(v), null, String(v));
});

test("scan: SilverBullet 2 needs the transform in CONFIG; Library/Config does not count; a release that cannot be told needs it too, but CONFIG is exempt only where the release is known to be 2", async () => {
  for (const release of ["2.12.1-0-g4d5eac53", null, "edge"]) {
    const ok = await scan(release, { "CONFIG.md": BLOCK });
    assert.equal(ok.s.transform, "present");
    assert.equal(ok.refusal, null);
    const known = release !== null && release !== "edge";
    assert.equal(ok.state.libraryOnly("s"), !known);
    assert.deepEqual(ok.s.findings.map((f) => [f.page, f.rule]), known ? [] : [["CONFIG", "fence"]]);
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

test("scan: while the release cannot be asked for, the last one named holds", async () => {
  const down = new SbError(503, "s", null, "");
  const files = { "index.md": "Hello\n" };
  const three = await scan("3.0.0-0-g0f9b90bb", files);
  const again = await scan(down, files, { state: three.state });
  assert.equal(again.s.release, "3.0.0-0-g0f9b90bb");
  assert.equal(again.s.transform, "not-needed");
  assert.equal(again.refusal, null, "the space is still served");
  assert.equal(again.state.libraryOnly("s"), true);

  const two = await scan("2.12.1", { "CONFIG.md": BLOCK });
  const kept = await scan(down, { "CONFIG.md": BLOCK }, { state: two.state });
  assert.equal(kept.s.transform, "present");
  assert.equal(kept.s.findings.length, 0, "CONFIG is still a code place");

  // An answer that names no release is not a failure.
  const unnamed = await scan(null, { "CONFIG.md": BLOCK }, { state: two.state });
  assert.equal(unnamed.s.release, null);
  assert.equal(unnamed.state.libraryOnly("s"), true);

  // Nothing named yet: what cannot be told is taken as it is safe.
  const first = await scan(down, files);
  assert.equal(first.s.transform, "missing");
  assert.match(first.refusal ?? "", /^Refusing to serve space "s": the index-time transform is missing/);
});

test("version: an answer names the release or none; an error or no answer throws", async () => {
  const { createServer } = await import("node:http");
  let status = 200;
  let header: string | null = "3.0.0";
  const http = createServer((_req, res) => res.writeHead(status, header === null ? {} : { "X-Server-Version": header }).end("OK"));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const { SilverBullet } = await import("./sb.ts");
  const sb = new SilverBullet(`http://127.0.0.1:${(http.address() as { port: number }).port}`);
  try {
    assert.equal(await sb.version("t", "s"), "3.0.0");
    header = null;
    assert.equal(await sb.version("t", "s"), null);
    status = 502;
    await assert.rejects(sb.version("t", "s"), (e) => e instanceof SbError && e.status === 502);
  } finally {
    await new Promise((resolve) => http.close(resolve));
  }
  await assert.rejects(sb.version("t", "s"), (e) => e instanceof SbError && e.status === 0);
});

test("scan: a ![[target]] is looked up by the end of its path, on both releases; the image form is not; a full path is", async () => {
  const accessList = "alice s / rx\nalice s Private/ -\n";
  const files = { "CONFIG.md": "", "Private/Plan.md": "x\n", "Files/pic.png": "", "Private/pic.png": "", "Private/x.pdf": "", "x.pdf.md": "a page\n", "Other/Note.md": "y\n" };
  const findings = async (release: string, text: string) => (await scan(release, { ...files, "Notes/Page.md": text }, { accessList })).s.findings.filter((f) => f.page === "Notes/Page").map((f) => f.detail);
  for (const release of ["2.12.1", "3.0.0"]) {
    assert.deepEqual(await findings(release, "![[plan.MD]]\n"), ["![[plan.MD]]: alice may render this page (x) and may not read Private/Plan"], release);
    assert.deepEqual(await findings(release, "![[Plan]] and ![[PLAN]]\n"), ["![[Plan]]: alice may render this page (x) and may not read Private/Plan", "![[PLAN]]: alice may render this page (x) and may not read Private/Plan"]);
    assert.deepEqual(await findings(release, "![[x.pdf]]\n"), ["![[x.pdf]]: alice may render this page (x) and may not read Private/x.pdf"], "the page x.pdf.md is not the file x.pdf");
    assert.deepEqual(await findings(release, "![[pic.png]]\n"), ["![[pic.png]]: alice may render this page (x) and may not read Private/pic.png"]);
    for (const fine of ["![p](pic.png)", "![p](../Files/pic.png)", "![p](Plan)", "![[Files/pic.png]]", "![[Note]]", "![[Not yet written]]", "![[Other/Note#Part]]"]) assert.deepEqual(await findings(release, `${fine}\n`), [], `${release}: ${fine}`);
  }
});

test("quarantine: violations in one another, overlapping and side by side are neutralised, and the page passes the filter", () => {
  const allow = shippedAllowlist();
  const cases: Array<[string, string | null]> = [
    ["a ${tostring(1)} b ${tostring(2)} c\n", "a `${tostring(1)}` b `${tostring(2)}` c\n\n#quarantined\n"],
    ["a ${tostring(${tostring(1)})} b\n", "a `${tostring(${tostring(1)})}` b\n\n#quarantined\n"],
    ['a ${"${tostring(1)}"} b ${tostring(2)} c\n', null],
    ["a ${tostring(1)}${tostring(2)} b\n", "a `${tostring(1)}${tostring(2)}` b\n\n#quarantined\n"],
    ["a ${[[ {\n\n${tostring(1)} } ]] }\n\nafter ${tostring(2)} `code`\n", null],
    ["<!--#lua tostring(1) --> x <!--/lua-->\n", "<!-- #lua tostring(1) --> x <!--/lua-->\n\n#quarantined\n"],
    ["```space-lua\nx = 1\n<!--#lua tostring(1) -->\n```\n\n${tostring(1)}\n", "```lua\nx = 1\n<!-- #lua tostring(1) -->\n```\n\n`${tostring(1)}`\n\n#quarantined\n"],
    ["a ${tostring(1) ..\n\n```space-lua\nx = 1\n```\n\n[[b]]}\n", null],
  ];
  for (const [page, expected] of cases) {
    const before = checkPage(page, allow);
    assert.equal(before.ok, false, page);
    const out = quarantine(page, before.violations);
    if (expected !== null) assert.equal(out, expected);
    const after = checkPage(out, allow);
    assert.deepEqual(after.violations, [], `${page}\n->\n${out}`);
    // Nothing is lost: what stood outside the violations is there as it was.
    for (const word of ["a ", " b", " c", "after "].filter((w) => page.includes(w))) assert.ok(out.includes(word), `${word} in ${out}`);
  }
});
