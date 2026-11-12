// The library reads a proposal page as src/proposal.ts writes it, and applies
// an edit as edit-note of the server does (src/edit.ts).

import test from "node:test";
import assert from "node:assert/strict";
import { formatProposal } from "../../src/proposal.ts";
import { ROUND_TRIPS } from "../../src/proposal-cases.ts";
import { prepareEdits, type Edit } from "../../src/edit.ts";
import { sb, T, S } from "../lib/env.ts";
import { freshRuntime, lua, luaString, removePage, revisionOf, writePage } from "./lib.ts";

test("library: the library in the space is the one the repository builds", async () => {
  await freshRuntime();
});

test("library: every proposal reads back as src/proposal.ts wrote it", async () => {
  for (const [name, p] of Object.entries(ROUND_TRIPS)) {
    const got = await lua<Record<string, unknown>>(`local p, err = proposals.parse(${luaString(formatProposal(p))})
if not p then return {error = err} end
local edits = {}
for _, e in ipairs(p.edits or {}) do table.insert(edits, {oldText = e.expected, newText = e.replacement, expectedMatches = e.count}) end
return {action = p.action, target = p.target, to = p.to, revision = p.revision, group = p.group, reason = p.reason, edits = p.edits and edits or nil}`);
    const want: Record<string, unknown> = { ...p };
    if (want.group === undefined) delete want.group;
    assert.deepEqual(got, want, name);
  }
});

test("library: a page that is not in the format is refused with a reason", async () => {
  const page = formatProposal(ROUND_TRIPS["a plain edit"]);
  const cases: Array<[string, RegExp]> = [
    [page.replace("format: 1", "format: 2"), /format 2/],
    [page.replace("action: edit", "action: create"), /unknown action/],
    [page.replace("~~~~replacement", "~~~~other"), /without its replacement/],
    [page + "more\n", /after the last change/],
    [page.replace("expected 1", "expected x"), /without a count/],
    [page.replace("tags: change-proposal", "tags: other"), /not tagged change-proposal/],
    [page.replace("~~~~reason\n", ""), /no reason/],
    [page.replace("in the evening", "in the\n   ~~~~\nevening"), /closes the fence/],
  ];
  for (const [text, why] of cases) {
    const err = await lua<string>(`local p, err = proposals.parse(${luaString(text)}) return p and "parsed" or err`);
    assert.match(err, why);
  }
});

test("library: an edit applies as edit-note applies it, and fails where edit-note fails", async () => {
  const cases: Array<[string, Edit[]]> = [
    ["a b a b a", [{ oldText: "a", newText: "x", expectedMatches: 3 }]],
    ["one\n* a line\ntwo\n* a line\n", [{ oldText: "* a line\n", newText: "", expectedMatches: 2 }]],
    ["aaa", [{ oldText: "aa", newText: "b", expectedMatches: 2 }]],
    ["abc", [{ oldText: "ab", newText: "x", expectedMatches: 1 }, { oldText: "bc", newText: "y", expectedMatches: 1 }]],
    ["abc", [{ oldText: "a", newText: "1", expectedMatches: 1 }, { oldText: "c", newText: "3", expectedMatches: 1 }]],
    ["line\r\nnext\r\n", [{ oldText: "line\r\n", newText: "first\r\n", expectedMatches: 1 }]],
    ["x", [{ oldText: "y", newText: "z", expectedMatches: 1 }]],
    ["x x", [{ oldText: "x", newText: "z", expectedMatches: 1 }]],
    ["Grüsse ✓", [{ oldText: "ü", newText: "ue", expectedMatches: 1 }]],
  ];
  for (const [text, edits] of cases) {
    let want: string | null;
    try {
      want = prepareEdits(text, edits).content;
    } catch {
      want = null;
    }
    const got = await lua<string | null>(`local edits = {}
${edits.map((e) => `table.insert(edits, {expected = ${luaString(e.oldText)}, replacement = ${luaString(e.newText)}, count = ${e.expectedMatches}})`).join("\n")}
return (proposals.applyEdits(${luaString(text)}, edits))`);
    assert.equal(got ?? null, want, JSON.stringify([text, edits]));
  }
});

test("library: a revision is the one the file API reports as the ETag", async () => {
  const text = "---\ntitle: x\n---\nGrüsse ✓\n";
  await writePage("Revision probe", text);
  const etag = (await sb.read(T.dora, S.delta, "Revision probe.md")).etag;
  const mine = await lua<string>(`return proposals.revisionOf(${luaString(text)})`);
  assert.equal(`"${mine}"`, etag);
  assert.equal(mine, await revisionOf(text));
  await removePage("Revision probe");
});
