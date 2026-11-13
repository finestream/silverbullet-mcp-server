// The report page named by a path (docs/security.md, section 8): with
// MCP_REPORT_PAGE=Space/Report the scan writes Space/Report.md in every guarded
// space, skips it as its own page, and writes nothing at the top level.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, type RunningServer } from "./harness.ts";
import { sb, T } from "../lib/env.ts";

const REPORT = "Space/Report.md";
const pagesChecked = (report: string) => Number(report.match(/, (\d+) page\(s\) checked/)?.[1]);

let server: RunningServer;

before(async () => {
  server = await startServer({ env: { MCP_REPORT_PAGE: REPORT.replace(/\.md$/, "") } });
});

after(async () => {
  await server?.stop();
  await sb.remove(T.admin, "gamma", REPORT);
});

test("the report page is a path: written there, skipped as a page, nothing at the top level", async () => {
  const first = (await sb.read(T.admin, "gamma", REPORT)).text;
  assert.match(first, /^# Space\/Report\n/, "the scan wrote the page at the path");
  assert.match(first, /\* Serving: yes/);
  const before = pagesChecked(first);
  assert.ok(Number.isInteger(before), `a page count in:\n${first}`);

  await server.rescan(); // the report now exists and is listed with the other files
  const second = (await sb.read(T.admin, "gamma", REPORT)).text;
  assert.equal(pagesChecked(second), before, "the scan does not check its own report page");
  assert.match(second, /## Findings \(0\)/);

  assert.equal((await sb.read(T.admin, "gamma", "Report.md")).status, 404, "no top-level Report.md");
});
