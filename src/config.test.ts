import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, parseProposalFolders, parseReportPage, parseCount, parseDuration, DEFAULT_SCAN_USER } from "./config.ts";

test("the scan's technical user is `scan` unless MCP_SCAN_USER names another", () => {
  assert.equal(loadConfig({}).scanUser, "scan");
  assert.equal(DEFAULT_SCAN_USER, "scan");
  assert.equal(loadConfig({ MCP_SCAN_USER: "silverbullet-mcp" }).scanUser, "silverbullet-mcp");
  assert.equal(loadConfig({ MCP_SCAN_USER: "  guardian " }).scanUser, "guardian");
  assert.equal(loadConfig({ MCP_SCAN_USER: "" }).scanUser, "scan", "an empty value means the default");
});

test("a count that is not a whole number in range stops the start, naming the variable", () => {
  assert.equal(loadConfig({}).port, 4000);
  assert.equal(loadConfig({ PORT: "0" }).port, 0, "0 lets the system choose the port");
  assert.equal(loadConfig({ MCP_RATE_LIMIT: "0" }).rateLimit, 0, "0 means no limit");
  assert.equal(loadConfig({ MCP_RENDER_PARALLEL: " 2 " }).renderParallel, 2);
  assert.throws(() => loadConfig({ PORT: "4o" }), /PORT must be a whole number from 0 to 65535, not "4o"/);
  assert.throws(() => loadConfig({ PORT: "70000" }), /PORT/);
  assert.throws(() => loadConfig({ MCP_RATE_LIMIT: "-1" }), /MCP_RATE_LIMIT must be a whole number of at least 0/);
  assert.throws(() => loadConfig({ MCP_RENDER_PARALLEL: "0" }), /MCP_RENDER_PARALLEL must be a whole number of at least 1/);
  assert.equal(parseCount("X", "12", 1), 12);
  assert.throws(() => parseCount("X", "1.5", 1), /X must be a whole number/);
});

test("an empty or blank variable means the default, as compose passes an unset ${VAR}", () => {
  const empty = loadConfig({ PORT: "", MCP_RATE_LIMIT: "", MCP_RENDER_PARALLEL: " ", MCP_SCAN_INTERVAL: "", MCP_RENDER_TIMEOUT: "", MCP_INDEX_WAIT: "" });
  const defaults = loadConfig({});
  assert.deepEqual(
    [empty.port, empty.rateLimit, empty.renderParallel, empty.scanInterval, empty.renderTimeout, empty.indexWait],
    [4000, 120, 4, 15 * 60_000, 90_000, 5000],
  );
  assert.deepEqual(empty, defaults);
});

test("a duration that is not one, or out of range, stops the start, naming the variable", () => {
  assert.equal(parseDuration("X", "0"), 0);
  assert.equal(parseDuration("X", "500ms"), 500);
  assert.equal(parseDuration("X", "30"), 30_000, "plain seconds");
  assert.equal(parseDuration("X", "2h"), 7_200_000);
  assert.equal(loadConfig({ MCP_SCAN_INTERVAL: "0" }).scanInterval, 0, "0 means no scheduled scan");
  assert.throws(() => loadConfig({ MCP_SCAN_INTERVAL: "15 min" }), /MCP_SCAN_INTERVAL must be a duration .*500ms.*not "15 min"/);
  assert.throws(() => loadConfig({ MCP_SCAN_INTERVAL: "30d" }), /MCP_SCAN_INTERVAL .*at most 24 days/, "a timer would fire after 1 ms");
  assert.throws(() => loadConfig({ MCP_INDEX_WAIT: "-1s" }), /MCP_INDEX_WAIT/);
});

test("the report page is a page name or a path, normalised: no leading slash, no .md, blank means the default", () => {
  assert.equal(loadConfig({}).reportPage, "MCP Server");
  assert.equal(loadConfig({ MCP_REPORT_PAGE: "Space/MCP Server" }).reportPage, "Space/MCP Server");
  assert.equal(parseReportPage("  /Space/MCP Server.md "), "Space/MCP Server");
  assert.equal(parseReportPage("//Report"), "Report");
  assert.equal(parseReportPage(""), "MCP Server");
  assert.equal(parseReportPage("/"), "MCP Server");
  assert.equal(parseReportPage(".md"), "MCP Server");
});

test("the proposal folders default to the library's, end in one slash, and may not lie inside each other", () => {
  const d = loadConfig({});
  assert.deepEqual([d.proposalsDir, d.workingCopiesDir], ["Proposals/", "Working copies/"]);
  const c = loadConfig({ MCP_PROPOSALS_DIR: "  /Review/Proposals ", MCP_WORKING_COPIES_DIR: "Review/Copies//" });
  assert.deepEqual([c.proposalsDir, c.workingCopiesDir], ["Review/Proposals/", "Review/Copies/"]);
  assert.deepEqual(parseProposalFolders("", " "), { proposalsDir: "Proposals/", workingCopiesDir: "Working copies/" }, "blank means the default");
  assert.throws(() => loadConfig({ MCP_PROPOSALS_DIR: "Review", MCP_WORKING_COPIES_DIR: "Review/Copies" }), /must not lie inside each other/);
  assert.throws(() => parseProposalFolders("Same", "Same/"), /must not lie inside each other/);
  assert.deepEqual(parseProposalFolders("Review", "Reviewed"), { proposalsDir: "Review/", workingCopiesDir: "Reviewed/" }, "a shared prefix of the name is not inside");
});

test("a proposal folder in CONFIG or Library/, or with a name the tools refuse, stops the start", () => {
  for (const [value, problem] of [
    ["Library/Proposals", /MCP_PROPOSALS_DIR \("Library\/Proposals\/"\) lies in CONFIG or Library\//],
    ["Library", /lies in CONFIG or Library\//],
    ["CONFIG", /lies in CONFIG or Library\//],
    ["Notes/../Library", /empty, "\." or dot-prefixed segment/],
    ["Notes//Proposals", /empty, "\." or dot-prefixed segment/],
    [".hidden", /dot-prefixed segment/],
    ["Pro\\posals", /control character or a backslash/],
  ] as const) {
    assert.throws(() => loadConfig({ MCP_PROPOSALS_DIR: value }), problem, value);
  }
  assert.throws(() => loadConfig({ MCP_WORKING_COPIES_DIR: "Library/Copies" }), /MCP_WORKING_COPIES_DIR \("Library\/Copies\/"\) lies in CONFIG or Library\//);
  assert.equal(loadConfig({ MCP_PROPOSALS_DIR: "Configured/Proposals" }).proposalsDir, "Configured/Proposals/", "a name that only starts like CONFIG is fine");
});
