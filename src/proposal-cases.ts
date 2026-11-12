// Proposals that the format must carry unchanged. The unit test writes and
// reads them with `src/proposal.ts`; the library's tests (`test/library/`)
// read the same pages in the browser and compare.

import type { Proposal } from "./proposal.ts";

export const REVISION = "sha256:" + "ab".repeat(32);

export const ROUND_TRIPS: Record<string, Proposal> = {
  "a plain edit": {
    action: "edit",
    target: "Notes/Garden",
    revision: REVISION,
    group: "12",
    reason: "Watering moved to the morning.",
    edits: [{ oldText: "in the evening", newText: "early in the morning", expectedMatches: 1 }],
  },
  "an empty replacement and a count": {
    action: "edit",
    target: "Notes/Garden",
    revision: REVISION,
    reason: "Two lines go.",
    edits: [
      { oldText: "* a line\n", newText: "", expectedMatches: 2 },
      { oldText: "x", newText: "\n", expectedMatches: 1 },
    ],
  },
  "texts with tilde fences, backticks and line breaks at their ends": {
    action: "edit",
    target: "Notes/Code",
    revision: REVISION,
    group: "a: b \"c\"",
    reason: "The reason has a fence of its own:\n~~~~~expected 1\nnot a block\n~~~~~",
    edits: [
      { oldText: "~~~~\ncode\n~~~~\n", newText: "```lua\ncode\n```\n\n", expectedMatches: 1 },
      { oldText: "\n\ntail", newText: "~~~~~~expected 3\n~~~~~~", expectedMatches: 1 },
    ],
  },
  "texts with fences indented by up to three spaces": {
    action: "edit",
    target: "Notes/Code",
    revision: REVISION,
    reason: "An indented fence:\n   ~~~~~~\n```space-lua\nprint(1)\n```",
    edits: [{ oldText: "x\n   ~~~~\n```space-lua\nprint(1)\n```\n", newText: "  ~~~~~~~ \n", expectedMatches: 1 }],
  },
  "a reason with an expression, a query and code": {
    action: "move",
    target: "Drafts/New page",
    to: "Notes/New page",
    revision: REVISION,
    reason: "${1 + 1} ${query[[from index.tag \"page\"]]}\n\n```space-lua\nprint(1)\n```",
  },
  "a frontmatter change": {
    action: "edit",
    target: "Notes/Garden",
    revision: REVISION,
    reason: "",
    edits: [{ oldText: "---\nstatus: draft\n---\n", newText: "---\nstatus: final\ntags: garden\n---\n", expectedMatches: 1 }],
  },
  "a delete": { action: "delete", target: "Notes/Old", revision: REVISION, group: "12", reason: "Replaced by Notes/Garden." },
  "a move": { action: "move", target: "Drafts/New page", to: "Notes/New page", revision: REVISION, reason: "Ready." },
  "a target that cannot stand in a link": { action: "delete", target: "Notes/A | B", revision: REVISION, reason: "Odd name." },
};
