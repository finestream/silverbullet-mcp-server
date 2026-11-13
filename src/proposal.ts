// The format of a change proposal page (docs/proposals.md, section 3). The
// format is internal to this repository: this module writes it, the library
// in `library/` reads it in the person's browser, and both change together.
// `PROPOSAL_FORMAT` is what the library compares with its own number.
//
//   ---
//   tags: change-proposal
//   format: 1
//   action: edit                  edit, delete or move
//   target: "[[Some/Page]]"       a link, so the target shows the proposal among its backlinks
//   to: "Some/Other name"         move only
//   revision: "sha256:…"          the target when the proposal was written
//   group: "…"                    optional
//   fence: "~~~~"                 the fence of the blocks below
//   ---
//   ~~~~reason                    why, as text; may be empty
//   …
//   ~~~~
//   ~~~~expected 1                edit only: the text as it is, and how often it occurs
//   …
//   ~~~~
//   ~~~~replacement               the text that replaces it; may be empty
//   …
//   ~~~~
//
// Everything the agent wrote is inside a fenced block, so nothing of it is
// live on the proposal page (no `${…}`, query or `space-lua` block). The fence
// is longer than any run of tildes that starts a line of the reason or of a
// text, also one indented by up to three spaces (which CommonMark still reads
// as a fence), so no line of them can open or close a block; a text is kept
// character for character between the line break after the opening line and
// the one before the closing line.

import type { Edit } from "./edit.ts";

export const PROPOSAL_TAG = "change-proposal";
export const PROPOSAL_FORMAT = 1;

/** The page of the review library (`library/`), as `npm run build:library` names it; the scan reads its version there. */
export const LIBRARY_PAGE = "Library/Finestream/Proposals";

/** What the scan found of the review library in a space: its version and format, and why the proposal tools are refused, or null. */
export type LibraryCheck = { version: string | null; format: number | null; problem: string | null };

/**
 * Checks the library page's frontmatter against this server (docs/proposals.md, section 6): the
 * library must be there, in the server's version and with the server's format. `text` is null
 * when the page does not exist.
 */
export function checkLibrary(text: string | null, serverVersion: string): LibraryCheck {
  if (text === null) return { version: null, format: null, problem: `the library is not installed (no page ${LIBRARY_PAGE})` };
  const fm = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---(\n|$)/)?.[1] ?? "";
  const value = (key: string) => {
    const raw = fm.match(new RegExp(`^${key}:[ \t]*(.*?)[ \t]*$`, "m"))?.[1];
    return raw === undefined ? null : raw.replace(/^(["'])(.*)\1$/, "$2");
  };
  const version = value("version");
  const formatText = value("proposalFormat");
  const format = formatText !== null && /^\d+$/.test(formatText) ? Number(formatText) : null;
  let problem: string | null = null;
  if (version !== serverVersion) problem = `the library at ${LIBRARY_PAGE} is version ${version ?? "(none)"}, the server ${serverVersion}`;
  else if (format !== PROPOSAL_FORMAT) problem = `the library at ${LIBRARY_PAGE} reads proposal format ${format ?? "(none)"}, the server writes ${PROPOSAL_FORMAT}`;
  return { version, format, problem };
}

/**
 * Why a page cannot be the target or the new name of a proposal, or null: the library applies
 * nothing to a page in the proposal folder or in the folder of the working copies.
 */
export function outsideProposalFolders(page: string, folders: { proposalsDir: string; workingCopiesDir: string }): string | null {
  if (page.startsWith(folders.proposalsDir)) return `${page} lies in the proposal folder (${folders.proposalsDir})`;
  if (page.startsWith(folders.workingCopiesDir)) return `${page} lies in the folder of the working copies (${folders.workingCopiesDir})`;
  return null;
}

export type ProposalAction = "edit" | "delete" | "move";

export type Proposal = {
  action: ProposalAction;
  /** The page the proposal changes, as a page name (no `.md`). */
  target: string;
  /** The target's revision when the proposal was written: `sha256:<hex>`, with or without the quotation marks of an ETag. */
  revision: string;
  reason: string;
  group?: string;
  /** `edit`: the pairs, exactly as the agent gave them. */
  edits?: Edit[];
  /** `move`: the new page name. */
  to?: string;
};

/** Whether a page name can stand inside `[[…]]` without becoming something else. */
const linkable = (name: string) => !/[[\]|#@$<>\r\n]/.test(name);

const unquote = (revision: string) => revision.replace(/^"(.*)"$/, "$1");

/** The longest run of tildes that starts a line of the text, after up to three spaces. */
function longestTildes(text: string): number {
  let longest = 0;
  for (const run of text.matchAll(/^ {0,3}(~+)/gm)) longest = Math.max(longest, run[1].length);
  return longest;
}

/** The shortest fence, of four tildes or more, that no line of the texts starts with (after up to three spaces). */
export function fenceFor(texts: string[]): string {
  return "~".repeat(Math.max(3, ...texts.map(longestTildes)) + 1);
}

export function formatProposal(p: Proposal): string {
  const reason = p.reason.trim();
  const lines = ["---", `tags: ${PROPOSAL_TAG}`, `format: ${PROPOSAL_FORMAT}`, `action: ${p.action}`];
  lines.push(`target: ${JSON.stringify(linkable(p.target) ? `[[${p.target}]]` : p.target)}`);
  if (p.action === "move") {
    if (!p.to) throw new Error("a move needs the new name");
    lines.push(`to: ${JSON.stringify(p.to)}`);
  }
  if (!/^sha256:/.test(unquote(p.revision ?? ""))) throw new Error("the revision of the target is missing");
  lines.push(`revision: ${JSON.stringify(unquote(p.revision))}`);
  if (p.group !== undefined && p.group !== "") lines.push(`group: ${JSON.stringify(p.group)}`);
  const edits = p.action === "edit" ? (p.edits ?? []) : [];
  if (p.action === "edit" && edits.length === 0) throw new Error("an edit needs at least one pair");
  const fence = fenceFor([reason, ...edits.flatMap((e) => [e.oldText, e.newText])]);
  lines.push(`fence: ${JSON.stringify(fence)}`, "---", `${fence}reason`, reason, fence);
  for (const edit of edits) {
    if (edit.oldText === "") throw new Error("the expected text of a pair cannot be empty");
    if (!Number.isInteger(edit.expectedMatches) || edit.expectedMatches < 1) throw new Error("the count of a pair must be a whole number of 1 or more");
    lines.push(`${fence}expected ${edit.expectedMatches}`, edit.oldText, fence, `${fence}replacement`, edit.newText, fence);
  }
  return lines.join("\n") + "\n";
}

/** Reads a proposal page back; the counterpart of `proposals.parse` in the library. Throws on a page that is not in the format. */
export function parseProposal(text: string): Proposal {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("no frontmatter");
  const fm: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z]+): (.*)$/);
    if (kv) fm[kv[1]] = kv[2].startsWith('"') ? (JSON.parse(kv[2]) as string) : kv[2];
  }
  if (fm.tags !== PROPOSAL_TAG) throw new Error(`not tagged ${PROPOSAL_TAG}`);
  if (Number(fm.format) !== PROPOSAL_FORMAT) throw new Error(`format ${fm.format}, not ${PROPOSAL_FORMAT}`);
  const action = fm.action as ProposalAction;
  if (!["edit", "delete", "move"].includes(action)) throw new Error(`unknown action ${fm.action}`);
  const target = fm.target.match(/^\[\[(.*)\]\]$/)?.[1] ?? fm.target;
  if (!/^sha256:/.test(fm.revision ?? "")) throw new Error("no revision");
  const fence = fm.fence;
  if (!/^~{4,}$/.test(fence ?? "")) throw new Error("no fence");
  const src = "\n" + m[2] + "\n";
  const open = `\n${fence}expected `;
  const close = `\n${fence}\n`;
  const block = (from: number) => {
    const end = src.indexOf(close, from);
    if (end === -1) throw new Error("a block is not closed");
    const text = src.slice(from, end);
    if (longestTildes(text) >= fence.length) throw new Error("a text holds a line that closes the fence");
    return { text, next: end + close.length - 1 };
  };
  const head = `\n${fence}reason\n`;
  if (!src.startsWith(head)) throw new Error("no reason");
  const reason = block(head.length);
  const base: Proposal = { action, target, revision: fm.revision, reason: reason.text };
  if (fm.group !== undefined) base.group = fm.group;
  if (action === "move") base.to = fm.to;
  let pos = reason.next;
  if (action !== "edit") {
    if (src.slice(pos).trim() !== "") throw new Error("text after the reason");
    return base;
  }

  if (!src.startsWith(open, pos)) throw new Error("no pair");
  const edits: Edit[] = [];
  while (src.startsWith(open, pos)) {
    const lineEnd = src.indexOf("\n", pos + 1);
    const count = Number(src.slice(pos + open.length, lineEnd));
    if (!Number.isInteger(count) || count < 1) throw new Error("a pair has no count");
    const expected = block(lineEnd + 1);
    const head = `\n${fence}replacement\n`;
    if (!src.startsWith(head, expected.next)) throw new Error("an expected block without its replacement");
    const replacement = block(expected.next + head.length);
    edits.push({ oldText: expected.text, newText: replacement.text, expectedMatches: count });
    pos = replacement.next;
  }
  if (src.slice(pos).trim() !== "") throw new Error("text after the last pair");
  return { ...base, edits };
}
