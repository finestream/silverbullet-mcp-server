// The report page named by a path (docs/security.md, section 8): with
// MCP_REPORT_PAGE=Space/Report the scan writes Space/Report.md in every guarded
// space, skips it as its own page, writes nothing at the top level, and the
// tools refuse to change it.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, connect, BEARERS, type RunningServer, type McpClient } from "./harness.ts";
import { sb, T } from "../lib/env.ts";

const REPORT = "Space/Report.md";
const SPACES = ["alpha", "beta", "gamma"];
const count = (report: string, what: "page(s) checked" | "file(s) seen") => Number(report.match(new RegExp(`, (\\d+) ${what.replace(/[()]/g, "\\$&")}`))?.[1]);

let server: RunningServer;
let alice: McpClient;

const clean = async () => {
  for (const space of SPACES) {
    await sb.remove(T.admin, space, REPORT);
    await sb.remove(T.admin, space, "Report.md");
  }
};

before(async () => {
  await clean(); // a report left by an earlier run would make the skip check vacuous
  server = await startServer({ env: { MCP_REPORT_PAGE: REPORT.replace(/\.md$/, "") } });
  alice = await connect(server.url, BEARERS.alice);
});

after(async () => {
  await alice?.close();
  await server?.stop();
  await clean();
});

test("the report page is a path: written in every guarded space, skipped as a page, nothing at the top level", async () => {
  const first: Record<string, string> = {};
  for (const space of SPACES) {
    first[space] = (await sb.read(T.admin, space, REPORT)).text;
    assert.match(first[space], /^# Space\/Report\n/, `the scan wrote the page at the path in ${space}`);
    assert.match(first[space], /\* Serving: yes/);
  }
  await server.rescan(); // the report now exists and is listed with the other files
  for (const space of SPACES) {
    const second = (await sb.read(T.admin, space, REPORT)).text;
    assert.equal(count(second, "file(s) seen"), count(first[space], "file(s) seen") + 1, `${space}: the first scan did not see the report, the second does`);
    assert.equal(count(second, "page(s) checked"), count(first[space], "page(s) checked"), `${space}: the scan does not check its own report page`);
    assert.match(second, /\* Serving: yes/);
    if (space === "gamma") assert.match(second, /## Findings \(0\)/, "gamma is the clean space: the report page is no finding");
    assert.equal((await sb.read(T.admin, space, "Report.md")).status, 404, `${space}: no top-level Report.md`);
  }
});

test("the report page cannot be written or deleted through the tools, however the path is spelled", async () => {
  for (const filename of ["Space/Report", "Space/Report.md"]) {
    const c = await alice.call("create-note", { filename, content: "fake report", overwrite: true });
    assert.equal(c.isError, true, `create-note ${filename}`);
    assert.match(c.text, /is the server's report page/);
    const d = await alice.call("delete-note", { filename });
    assert.equal(d.isError, true, `delete-note ${filename}`);
    assert.match(d.text, /is the server's report page/);
  }
});
