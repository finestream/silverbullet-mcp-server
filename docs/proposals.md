# Change proposals

Status: **proposed** (2026-11-11). Nothing of this document is built yet. It records the design of change proposals: how an agent asks for a change to a page it may not write, and how a person reviews and applies it. The terms *user*, *person*, *agent* and *operator* are those of [security.md](security.md), section 1.

## 1. The problem

The access list ([security.md](security.md), section 4) usually gives agents write access to a part of a space only. An agent that finds something to change elsewhere needs a way to say so that a person can review as a diff and apply with one click, with the person's own rights.

A first version of this exists outside this repository, in the library *Utilities* of [finestream/silverbullet-libraries](https://github.com/finestream/silverbullet-libraries): a proposal is a page the agent writes by hand, with the target page in its frontmatter and pairs of fenced blocks, the text as it is and the text that replaces it. The library lists the open proposals, shows each as a diff and applies it. Reviewing a few dozen proposals written that way showed its limits:

| Observed | Cause |
|---|---|
| A line cannot be deleted without rewriting a neighbouring line | The parser does not see an empty replacement block |
| A page cannot be deleted or moved, and a new page cannot be put in its place | The format knows one operation, the text edit |
| Text that holds a line of four tildes cannot be proposed | A block ends at the first such line |
| A proposal's errors show only at review: a text that is not in the page, or is there twice, a missing block | Nothing tests a proposal when it is written; the agent cannot, because the dry run of `edit-note` needs `w` on the target |
| Changes to the frontmatter are hard to read in the review | The formatted view leaves the frontmatter out |
| The applied result is not checked by the write filter before it is in the page | *Apply* writes in the person's browser, past this server |

Two more facts shape the design. People do not write proposals: a person who may write the page edits it. And the one thing a person changes in a proposal before applying it is the new text, never the text it replaces.

## 2. Goals

1. A proposal can say every change an agent may want where it has no write access: edit a page, delete it, move it, and put a new page in its place.
2. A proposal that reaches a person can be applied, unless its target changed in the meantime.
3. The person reviews a diff, and can change the result before accepting it.
4. Making a proposal and applying it are built, tested and released together.
5. No new right: the server still writes only where the access list allows, and applying stays a person's act.

## 3. Decisions

| Topic | Decision |
|---|---|
| Creation | Agents create proposals **only through tools of this server**, which test the change against the target and write the proposal page as the agent's user. Nobody writes a proposal page by hand |
| Review and apply | A **library shipped by this repository**, installed in the space by the operator like any other library. It lists, shows, applies and rejects proposals in the person's browser |
| The server and `Library/` | The server **writes nothing into `Library/`**. It reads the installed library's version and refuses the proposal tools while the library is missing or does not match |
| Format | The proposal page's format is **internal** to this repository: the tools write it, the library reads it, and it may change with any release |
| An edit | Stored as **pairs of expected text and replacement** with the number of expected matches, exactly as the agent gave them to the tool. A replacement may be empty |
| Actions | A proposal does **one action on one page**: `edit`, `delete` or `move` |
| Several pages | Several proposals with the same **group** (a free label the agent gives, for example the number of the task the change belongs to); the review handles a group as one batch |
| A new page | The agent writes the page where it may write, and proposes to **move** it. No action carries a page's text |
| Frontmatter | Edited **as text**, like the body; the review shows it |
| Stale | An edit is stale when an expected text no longer occurs as often as expected. A `delete` or `move` of a page that changed after the proposal was written **says so and can still be applied** |
| Changing a proposal | The person changes **the result, not the proposal**: a working copy of the target with the proposal applied, edited as a page |

## 4. The tools

Three tools, beside the ten the server has. None writes the target.

| Tool | Arguments | What it checks |
|---|---|---|
| `propose-edit` | Those of `edit-note` (`filename`, `edits` with `oldText`, `newText` and `expectedMatches`, `expectedRevision`), a reason, a name for the proposal and, optionally, a group | The target is at that revision; every old text occurs as often as expected; no two edits overlap; the resulting page passes the write filter |
| `propose-delete` | `filename`, `expectedRevision`, the reason, the name, the group | The target exists at that revision |
| `propose-move` | `filename`, `expectedRevision`, the new name, the reason, the name, the group | The target exists at that revision; nothing exists under the new name |

* **Rights.** `r` on the target, and `w` on the proposal page, which is written under the folder the operator configured for proposals. An agent that may write the target itself is told to use `edit-note`.
* **An old text that occurs several times** is refused, with the number found, as `edit-note` does. The agent either gives that number as `expectedMatches`, and every occurrence is replaced, or widens the text until it occurs once.
* **The answer** is the proposal page's name and the diff of the change, as the dry run of `edit-note` returns it.
* **The page is written as the agent's user**, through the same route as `create-note`, so SilverBullet's history shows who proposed what.
* **A second proposal on lines an open proposal already changes** cannot be made against the target as it is; it waits until the first is applied. The tools do not chain proposals.

## 5. The library

The library lives in this repository and is released with the server. It is code, so it is installed under `Library/` by the operator ([space-guidelines.md](space-guidelines.md)); the server never writes it. Its functions go on the allowlist like any other library's.

* **The list** shows the open proposals: target, action, group and state. *Apply all* applies those of a group, or all of them, after one confirmation that names the targets.
* **The review** of a proposal shows its reason and the change as a diff of the target as it is now against the target with the proposal applied: *formatted* (the page as it will look, changed lines struck through or highlighted) or as *text* (source lines, changed words highlighted). The frontmatter is shown before and after when the change touches it. A `delete` shows the page and the pages that link to it; a `move` shows both names.
* **Apply** writes with the rights of the person who clicks. It reads the proposal and the target again and runs the stale check first. Applying a `delete` deletes the page; applying a `move` renames it and updates the links to it.
* **Edit** creates a working copy: the target with the proposal applied, as a page the person edits in the editor. A bar of buttons above it offers *Accept* (write the working copy to the target, after checking that the target did not change since the copy was made), *Revert to proposal* (build the working copy again), *Preview* (the review's diff, against the working copy) and *Reject*. The proposal itself is not rewritten. There is no working copy for `delete` and `move`.
* **After *Apply*, *Accept* or *Reject*** the proposal page and its working copy are deleted, and the review goes on to the next proposal of the batch.
* **Nothing runs before a person applies.** The formatted view is rendered by SilverBullet's own Markdown renderer, which shows `${…}` as text; the working copy is a page like any other, bound by the index-time transform ([security.md](security.md), section 10).

## 6. What follows

* A proposal made through the tools was applicable when it was made, and its result passed the write filter. It can still go stale before it is applied.
* While a person edits a working copy, that page exists beside its target with the same tags and frontmatter, and appears in queries.
* The space needs the library in the version the server expects. The server's report page says when it is missing or does not match, and only the proposal tools are refused: reading, writing and rendering go on.
* The library *Utilities* keeps no proposal code once this library exists.
* Two things the library relies on are to be measured before it is built, and asserted by the release checks: that a page can be renamed from Space Lua with its links updated, and that a library can show a widget above the pages of one folder only.

## 7. Alternatives rejected

* **A unified diff as the stored form.** It is derived from what the agent gave and the server tested, where pairs are stored as given; and it depends on the unchanged lines around a change, so it goes stale when one of those changes. Being a standard format buys nothing where only this repository's code reads it.
* **A full copy of the target as the stored form.** Without a base revision it overwrites what changed in between; with one, any change of the target makes the proposal stale.
* **Operations inside an edit** (`delete`, `insert-after`). An empty replacement, and a replacement that repeats its anchor, say the same.
* **Key operations for the frontmatter** (set this key to that value). A second way to apply a change, for something text pairs already do; what was missing was the review showing the frontmatter.
* **Several targets in one proposal.** It would be applied page by page anyway, and a proposal applied to some of its pages needs a state of its own.
* **A `create` action that holds the new page's text.** The page itself, where the agent may write, can be read, rendered and edited before it is moved; text inside a proposal cannot.
* **Agents write the proposal page themselves**, in a documented format. Nothing tests the proposal before a person sees it.
* **Only a dry run of `edit-note` that needs no write access.** It tests the change but not the page the agent writes afterwards, and relies on the agent doing both.
* **The review code stays in a library of another repository.** The format becomes a contract between two repositories with two release cycles.
* **The server writes its library into `Library/`.** Code there runs in the browser of every person who opens the space, with that person's rights, so a fault in the server would become code run as that person; and the server would need write access to the place the model reserves for persons ([security.md](security.md), section 2).
* **The server applies proposals.** Applying is a person's act with the person's rights; the server acts for agents only.
* **Tracked changes shown in the editor while the person types.** Removed text cannot be shown inside an editable page, and colouring the editor's text is not something a library can rely on across SilverBullet releases.
