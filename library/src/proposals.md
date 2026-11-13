> **note**
> This page is generated from `library/src/` of [finestream/silverbullet-mcp-server](https://github.com/finestream/silverbullet-mcp-server) by `npm run build:library`. Edit the files there.

# Proposals

The review of *change proposals*: an agent that may not write a page asks for a change through the [SilverBullet MCP server](https://github.com/finestream/silverbullet-mcp-server), which writes a proposal page; you review it here as a diff and apply it with your own rights. The design is [docs/proposals.md](https://github.com/finestream/silverbullet-mcp-server/blob/main/docs/proposals.md) of the server.

A proposal does one thing to one page: it *edits* it, *deletes* it or *moves* it (which is also how a new page an agent wrote gets to its place). Several proposals that belong together carry the same *group* and are reviewed as one batch.

Pages call `proposals.list()` only, so a space that restricts what pages may call needs just this entry on its allowlist.

## Features

* *The list* `${proposals.list()}` shows the open proposals by group (groups that are numbers in numeric order, then the others, then the proposals without a group): target, action and state. *Apply all* applies every listed proposal and *Apply group* those of one group, after one confirmation that names the target pages. A row that could not be read when the list was drawn is never applied this way, only named in the result, even if it can be read by the time you click.
* *The review* `review:<name of the proposal page>` shows the proposal's reason and its change:
  * an *edit* as a diff of the page as it is against the page with the proposal applied, *Formatted* (the page as it will look; only the changed lines are struck through on red or added on green, a changed table only its changed rows) or as *Text* (the source lines, with the changed words highlighted). When the change touches the frontmatter, the formatted view shows the frontmatter before and after above the body;
  * a *delete* as the page that goes and the pages that link to it;
  * a *move* as both names and the pages whose links are rewritten.
* *Navigation* *Previous* and *Next* step through the open proposals of the batch, and a counter shows where you are (`5 / 20`). Proposals you already applied or rejected still count, so the numbers do not shift while you work through a batch.
* *Apply* writes the change with your rights: it reads the proposal and the page again, checks that both are still what the review showed you and that the proposal still fits, and then writes, deletes or renames the page (a rename rewrites the links to it, as *Page: Rename* does).
* *Edit* opens a *working copy*: the page with the proposal applied, as a page of its own that you edit in the editor. A bar above it offers *Accept* (write the working copy to the page), *Revert to proposal* (build it again), *Preview* (the review, now showing your working copy against the page) and *Reject*. The proposal itself is never rewritten.
* *Going on* after *Apply*, *Accept* or *Reject* the proposal page and its working copy are deleted, and the next open proposal opens: the next of the batch, then of the list. When none is left, the page set as `afterLast` opens.

## Configuration

Configuration is optional. To change the defaults, add the following section to your `CONFIG` page in a space-lua block:

```lua
config.set {
  proposals = {
    deleteClosed = true,                     -- delete a proposal page once it is applied or rejected (default)
    afterLast = "index",                     -- page opened when no proposal is left to review (default)
    proposalPrefix = "Proposals/",           -- folder the server writes the proposals to (default)
    workingCopyPrefix = "Working copies/",   -- folder of the working copies made by Edit (default)
  }
}
```

* `deleteClosed = false` keeps a closed proposal page, with `outcome: applied` or `outcome: rejected` in its frontmatter; it is no longer listed.
* `proposalPrefix` is the folder the server is configured to write proposals to. Only pages in it that carry the tag `change-proposal` are proposals: nothing else is listed, applied or rejected.
* `workingCopyPrefix` is a folder you may write to and the agents may not. The working copy of a proposal is the page with the proposal's name under it; the bar is shown above the pages of this folder and nowhere else.
* Neither folder may be empty, and neither may lie inside the other; otherwise the library refuses to work and says why.

## Usage

```
${proposals.list()}
${proposals.list("Some/Page")}
```

The first lists every open proposal, the second only those for one page (put it on that page to see what is waiting for it). The list holds no diff: each entry links to its review. `[[review:Some/Proposal]]` links to a review from any page. The review page calls `proposals.review()`, which takes the proposal from the page shown; a space that restricts what pages may call needs no entry for it, because a virtual page is not a file.

## What to know

* **A proposal that no longer fits is stale.** Every text an edit expects must still occur in the page as often as the proposal says, when the proposal is shown and again when it is applied; a move needs the new name to be free; a page to delete or move must exist. A stale proposal says why and can only be rejected. Nothing is matched approximately: the agent proposes again.
* **A delete or a move of a page that changed after the proposal was written** says so and can still be applied from its review. *Apply all* and *Apply group* leave it out, as they do a stale proposal and one with a working copy.
* **The batch** is the open proposals of one group (those without a group form one batch), in the order of the list. What you applied or rejected is remembered in this browser until none of the batch's proposals is open any more, here or in another browser, which is what keeps the counter stable; proposals that arrive while a batch is open join it.
* **A working copy is a page like any other** while it exists: it has the frontmatter and tags of the page it copies, and appears in queries. *Accept* checks that the page did not change since the copy was made; that revision is kept in this browser, so a copy made in another browser is accepted only after a confirmation.
* **The bar above a working copy is a view** docked at the top of the page (*Change proposal*). If you close it, the review page of the proposal still offers the same actions.
* **Every button acts on what you were shown.** *Apply*, *Edit*, *Accept* and *Revert to proposal* refuse, and the review is drawn again, when the proposal page, its target or the working copy changed since the review (or the bar) was drawn; *Apply all* and *Apply group* apply each proposal only as the list showed it.
* **A proposal must carry the revision of its target**, and its target (and, for a move, the new name) must lie outside the proposal folder and the folder of the working copies. A page that breaks either rule cannot be reviewed or applied, only rejected.
* **Nothing runs before you apply.** Everything the agent wrote, the reason included, is inside a fenced block on the proposal page. The formatted view is rendered by SilverBullet's own Markdown renderer, which shows `${...}` as text and drops scripts and event handlers; the library then removes styles, classes, style sheets, embedded documents, media and forms, and replaces remote images with their address, so nothing in a proposal can cover the change or load from elsewhere. Remote images and the reference definitions of remote addresses are taken out of the Markdown before it is rendered, and the rendered HTML is sanitized in a document of its own, so no such image is requested at any point. When the page holds HTML, the review opens on the text view, which is plain text.
* **The format of a proposal page is internal** to the server and this library and may change with any release; proposals are made with the server's tools, not by hand. The server and the library are released together, and this page's frontmatter carries the version and the format number.
* **The diff** is computed by [jsdiff](https://github.com/kpdecker/jsdiff) (BSD-3-Clause), which is part of the library: nothing is loaded from the network.

## Code
