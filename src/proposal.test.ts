import test from "node:test";
import assert from "node:assert/strict";
import { fenceFor, formatProposal, parseProposal } from "./proposal.ts";
import { REVISION, ROUND_TRIPS } from "./proposal-cases.ts";

test("proposal: every proposal reads back as it was written", () => {
  for (const [name, proposal] of Object.entries(ROUND_TRIPS)) {
    assert.deepEqual(parseProposal(formatProposal(proposal)), proposal, name);
  }
});

test("proposal: the fence is longer than any run of tildes that starts a line", () => {
  assert.equal(fenceFor(["no tildes", "a ~~~~~ inside a line"]), "~~~~");
  assert.equal(fenceFor(["~~~~\ncode\n~~~~"]), "~~~~~");
  assert.equal(fenceFor(["x", "y\n~~~~~~~z"]), "~~~~~~~~");
  assert.equal(fenceFor(["a\n   ~~~~~\nb"]), "~~~~~~", "three spaces still make a fence");
  assert.equal(fenceFor(["a\n    ~~~~~\nb"]), "~~~~", "four make indented code");
});

test("proposal: whatever the agent wrote is inside a fenced block", () => {
  const page = formatProposal(ROUND_TRIPS["a reason with an expression, a query and code"]);
  assert.match(page, /\n---\n~~~~reason\n\$\{1 \+ 1\}[^]*\n~~~~\n$/);
  const edit = formatProposal(ROUND_TRIPS["texts with fences indented by up to three spaces"]);
  assert.ok(edit.includes('fence: "~~~~~~~~"\n'), edit);
});

test("proposal: the page is tagged, links its target and keeps the revision without an ETag's quotation marks", () => {
  const page = formatProposal({ ...ROUND_TRIPS["a plain edit"], revision: `"${REVISION}"` });
  assert.match(page, /^---\ntags: change-proposal\nformat: 1\naction: edit\ntarget: "\[\[Notes\/Garden\]\]"\n/);
  assert.ok(page.includes(`revision: "${REVISION}"\n`));
  assert.ok(formatProposal(ROUND_TRIPS["a target that cannot stand in a link"]).includes('target: "Notes/A | B"\n'));
});

test("proposal: what cannot be a proposal is refused when it is written", () => {
  const edit = ROUND_TRIPS["a plain edit"];
  assert.throws(() => formatProposal({ ...edit, edits: [] }), /at least one pair/);
  assert.throws(() => formatProposal({ ...edit, edits: [{ oldText: "", newText: "x", expectedMatches: 1 }] }), /cannot be empty/);
  assert.throws(() => formatProposal({ action: "move", target: "A", revision: REVISION, reason: "" }), /new name/);
  for (const expectedMatches of [0, 1.5, -1, Number.NaN]) {
    assert.throws(() => formatProposal({ ...edit, edits: [{ oldText: "a", newText: "b", expectedMatches }] }), /whole number/, String(expectedMatches));
  }
  assert.throws(() => formatProposal({ ...edit, revision: "" }), /revision/);
});

test("proposal: a page that is not in the format is refused when it is read", () => {
  const page = formatProposal(ROUND_TRIPS["a plain edit"]);
  assert.throws(() => parseProposal("plain text"), /no frontmatter/);
  assert.throws(() => parseProposal(page.replace("format: 1", "format: 2")), /format 2/);
  assert.throws(() => parseProposal(page.replace(/^revision: .*\n/m, "")), /no revision/);
  assert.throws(() => parseProposal(page.replace("~~~~replacement", "~~~~other")), /without its replacement/);
  assert.throws(() => parseProposal(page + "more\n"), /after the last pair/);
  assert.throws(() => parseProposal(page.replace("in the evening", "in the\n  ~~~~\nevening")), /closes the fence/);
  assert.throws(() => parseProposal(page.replace("~~~~reason\n", "")), /no reason/);
});
