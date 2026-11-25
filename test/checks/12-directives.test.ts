// Where a `${…}` directive ends, and that the write filter judges every directive the running release
// evaluates (docs/facts/write-filter.md, section 6): the end within the block, 3.0's braces inside Lua
// strings and comments, page variables. Runs as alice on gamma.

import test, { before } from "node:test";
import assert from "node:assert/strict";
import { sb, T, S, V3 } from "../lib/env.ts";
import { checkPage } from "../../src/filter/filter.ts";
import { shippedAllowlist } from "../../src/filter/allowlist.ts";

before(async () => {
  await sb.runtimeReady(T.alice, S.gamma);
});

const expand = async (markdown: string) => {
  const r = await sb.lua(T.alice, S.gamma, `return markdown.expandMarkdown(${JSON.stringify(markdown)}, {pageName = "index"})`);
  return String(r.result ?? r.error ?? r.raw);
};
const refused = (markdown: string) => !checkPage(markdown, shippedAllowlist()).ok;

/** Pages with a call that is not allowed (tostring(6000 + 6)); `on`: which releases evaluate it. */
const PAGES: Array<{ page: string; on: "both" | "3" }> = [
  { page: "x ${tostring(6000 + 6)} y", on: "both" },
  { page: "| a |\n|---|\n| ${tostring(6000 + 6)} |\n", on: "both" },
  { page: "a ${[[ {\n\n${tostring(6000 + 6)} } ]] }\n", on: "both" },
  { page: "a ${[[ {\n\n- ${tostring(6000 + 6)} } ]] }\n", on: "both" },
  { page: "${[[ {\n# ${tostring(6000 + 6)} } ]] }\n", on: "both" },
  { page: 'x ${"{" .. tostring(6000 + 6)} y', on: "3" },
  { page: "x ${'{' .. tostring(6000 + 6)} y", on: "3" },
  { page: "x ${[[{]] .. tostring(6000 + 6)} y", on: "3" },
  { page: "x ${tostring(6000 --[[ { ]] + 6)} y", on: "3" },
  { page: '| a |\n|---|\n| ${"{" .. tostring(6000 + 6)} |\n', on: "3" },
  { page: '| a |\n|---|\n| ${"p\\|q" .. tostring(6000 + 6)} |\n', on: "3" },
];

test("directives: every form the release evaluates is judged by the write filter", async () => {
  const leaks: string[] = [];
  for (const { page, on } of PAGES) {
    const evaluated = (await expand(page)).includes("6006");
    assert.equal(evaluated, on === "both" || V3, `${JSON.stringify(page)}: evaluated`);
    if (evaluated && !refused(page)) leaks.push(page);
  }
  assert.deepEqual(leaks, [], "evaluated by SilverBullet and accepted by the filter");
});

test("directives: page variables exist since 3.0, and the write filter refuses every assignment", async () => {
  const page = "${six = 6000 + 6}\n\nthen ${six}\n";
  // A page's variables are those of its stored text.
  await sb.write(T.alice, S.gamma, "Variables.md", page);
  try {
    await sb.lua(T.alice, S.gamma, `editor.navigate("index") return 1`);
    const r = await sb.lua(T.alice, S.gamma, `return markdown.expandMarkdown(space.readPage("Variables"), {pageName = "Variables"})`);
    assert.equal(String(r.result ?? r.error).includes("then 6006"), V3, `evaluated: ${r.raw}`);
  } finally {
    await sb.remove(T.alice, S.gamma, "Variables.md");
  }
  assert.equal(refused(page), true);
  assert.equal(refused("${local six = 6000 + 6}\n"), true);
});
