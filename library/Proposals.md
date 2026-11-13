---
name: "Library/Finestream/Proposals"
tags: meta/library
author: finestream
description: "Review change proposals made through the SilverBullet MCP server: a list, a diff per proposal, and Apply, Edit and Reject with your own rights."
pageDecoration.prefix: "📝 "
version: "0.8.0"
proposalFormat: 1
---
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

```space-lua
-----------------------------------------------------------------------
-- Package proposals
--
-- The review of change proposals (docs/proposals.md of the repository):
-- an agent that may not write a page asks for a change through the MCP
-- server, which writes a proposal page; a person reviews it here as a
-- diff and applies it with their own rights.
--
-- This file reads proposal pages, tests them against their targets and
-- applies them; diff.lua draws the two views of a change; review.lua
-- holds what a person sees: the list, the review page, the working
-- copy and its bar. Pages call proposals.list() only.
--
-- The format of a proposal page is internal: src/proposal.ts of the
-- repository writes it and describes it, proposals.parse reads it, and
-- proposals.format is the number both must agree on.
-----------------------------------------------------------------------
proposals = proposals or {}

proposals.version = "0.8.0"
proposals.format = 1
proposals.tag = "change-proposal"

-----------------------------------------------------------------------
-- proposals.defaults
--
-- Fallback values for the "proposals" section of the CONFIG page.
-----------------------------------------------------------------------
proposals.defaults = {
	deleteClosed = true,                     -- delete a proposal page once it is applied or rejected
	afterLast = "index",                     -- page opened when no proposal is left to review
	proposalPrefix = "Proposals/",           -- folder the server writes the proposals to
	workingCopyPrefix = "Working copies/"    -- folder of the working copies made by Edit
}

-----------------------------------------------------------------------
-- proposals.config()
--
-- Reads the "proposals" section of the CONFIG page.
--
-- Returns:
--   Table with the configured values, and the defaults for every key
--   the user did not configure.
-----------------------------------------------------------------------
function proposals.config()
	local effective = {}
	for key, value in pairs(proposals.defaults) do effective[key] = value end
	for key, value in pairs(config.get("proposals", {}) or {}) do effective[key] = value end
	return effective
end

-----------------------------------------------------------------------
-- proposals.folders()
--
-- The folder of the proposals and the folder of the working copies.
-- Neither may be empty or lie inside the other: a working copy in the
-- proposal folder could be written by the agents that write
-- proposals, and an empty folder would make every page one.
--
-- Returns:
--   The two prefixes, or nil, nil and why they cannot be used.
-----------------------------------------------------------------------
function proposals.folders()
	local cfg = proposals.config()
	local proposalPrefix, copyPrefix = cfg.proposalPrefix, cfg.workingCopyPrefix
	if type(proposalPrefix) ~= "string" or proposalPrefix == "" then
		return nil, nil, "proposalPrefix is not set"
	end
	if type(copyPrefix) ~= "string" or copyPrefix == "" then
		return nil, nil, "workingCopyPrefix is not set"
	end
	if string.startsWith(copyPrefix, proposalPrefix) or string.startsWith(proposalPrefix, copyPrefix) then
		return nil, nil, "proposalPrefix and workingCopyPrefix must not lie inside each other"
	end
	return proposalPrefix, copyPrefix
end

-----------------------------------------------------------------------
-- proposals.inFolder(name)
--
-- Whether a page name lies in the proposal folder. Nothing outside it
-- is read, applied, rejected or deleted as a proposal.
--
-- Returns:
--   true, or false and why not.
-----------------------------------------------------------------------
function proposals.inFolder(name)
	local prefix, _, why = proposals.folders()
	if not prefix then return false, why end
	if type(name) == "string" and #name > #prefix and string.startsWith(name, prefix) then return true end
	return false, "not a page in the proposal folder"
end

-----------------------------------------------------------------------
-- proposals.closed
--
-- Proposals applied or rejected in this client, by name: { outcome,
-- group, revision }, where revision is that of the page left behind
-- (nil when it was deleted). The index learns about a deleted or
-- rewritten page a moment later; until it has, the list and the
-- navigation use this table, so a proposal is gone as soon as it is
-- closed. A record holds only while the page is still the one it
-- closed (proposals.closedRecord).
-----------------------------------------------------------------------
proposals.closed = proposals.closed or {}

-----------------------------------------------------------------------
-- proposals.unlink(value)
--
-- "[[Some/Page]]" -> "Some/Page"
-----------------------------------------------------------------------
function proposals.unlink(value)
	if type(value) ~= "string" then return nil end
	return string.match(value, "^%[%[(.-)%]%]$") or value
end

-----------------------------------------------------------------------
-- proposals.splitFrontmatter(text)
--
-- Returns:
--   The frontmatter block with its two "---" lines ("" when the text
--   has none), and the rest.
-----------------------------------------------------------------------
function proposals.splitFrontmatter(text)
	local frontmatter, body = string.match(text, "^(%-%-%-\n.-\n%-%-%-\n)(.*)$")
	if frontmatter then return frontmatter, body end
	frontmatter = string.match(text, "^(%-%-%-\n.-\n%-%-%-)$")
	if frontmatter then return frontmatter, "" end
	return "", text
end

-----------------------------------------------------------------------
-- proposals.revisionOf(text)
--
-- The revision of a page text as the MCP server reports it and as a
-- proposal stores it: "sha256:" and the hash of the text.
-----------------------------------------------------------------------
function proposals.revisionOf(text)
	return "sha256:" .. crypto.sha256(text)
end

-----------------------------------------------------------------------
-- proposals.tagged(frontmatter)
--
-- Whether parsed frontmatter carries the proposal tag (as a string or
-- in a list).
-----------------------------------------------------------------------
function proposals.tagged(frontmatter)
	local tags = frontmatter and frontmatter.tags
	if tags == proposals.tag then return true end
	if type(tags) == "table" then
		for _, t in ipairs(tags) do
			if t == proposals.tag then return true end
		end
	end
	return false
end

-----------------------------------------------------------------------
-- proposals.closesFence(text, fence)
--
-- Whether a line of the text could close a block of this fence: a run
-- of as many tildes or more, after up to three spaces.
-----------------------------------------------------------------------
function proposals.closesFence(text, fence)
	for line in string.gmatch(text .. "\n", "(.-)\n") do
		local indent, run = string.match(line, "^( *)(~+)")
		if run and #indent <= 3 and #run >= #fence then return true end
	end
	return false
end

-----------------------------------------------------------------------
-- proposals.parse(text)
--
-- Reads the text of a proposal page (the format of src/proposal.ts).
--
-- Returns:
--   Table { action, target, to, revision, group, outcome, reason,
--   edits = { { expected, replacement, count } } }, or nil and an
--   error message.
-----------------------------------------------------------------------
function proposals.parse(text)
	local frontmatter = index.extractFrontmatter(text).frontmatter or {}
	if not proposals.tagged(frontmatter) then return nil, "not tagged " .. proposals.tag end
	if frontmatter.format ~= proposals.format then
		return nil, "format " .. tostring(frontmatter.format) .. ", where this library reads format " .. proposals.format
	end
	local action = frontmatter.action
	if action ~= "edit" and action ~= "delete" and action ~= "move" then
		return nil, "unknown action " .. tostring(action)
	end
	local target = proposals.unlink(frontmatter.target)
	if not target or target == "" then return nil, "no target" end
	if type(frontmatter.revision) ~= "string" or not string.startsWith(frontmatter.revision, "sha256:") then
		return nil, "no revision"
	end
	local proposal = {
		action = action,
		target = target,
		revision = frontmatter.revision,
		group = frontmatter.group ~= nil and tostring(frontmatter.group) or nil,
		outcome = frontmatter.outcome or "open"
	}
	local _, body = proposals.splitFrontmatter(text)
	if action == "move" then
		if type(frontmatter.to) ~= "string" or frontmatter.to == "" then return nil, "a move without the new name" end
		proposal.to = frontmatter.to
	end

	local fence = frontmatter.fence
	if type(fence) ~= "string" or not string.find(fence, "^~~~~+$") then return nil, "no fence" end
	local src = "\n" .. body .. "\n"
	local open = "\n" .. fence .. "expected "
	local head = "\n" .. fence .. "replacement\n"
	local close = "\n" .. fence .. "\n"
	-- a block's text runs from `from` to the closing line; the position
	-- returned is the line break that ends the closing line; a text with
	-- a line that would close the fence on the proposal page is refused
	local function block(from)
		local stop = string.find(src, close, from, true)
		if not stop then return nil, "a block is not closed" end
		local text = string.sub(src, from, stop - 1)
		if proposals.closesFence(text, fence) then return nil, "a text holds a line that closes the fence" end
		return text, stop + #close - 1
	end
	local reasonHead = "\n" .. fence .. "reason\n"
	if string.sub(src, 1, #reasonHead) ~= reasonHead then return nil, "no reason" end
	local reason, pos = block(#reasonHead + 1)
	if not reason then return nil, pos end
	proposal.reason = reason
	if action ~= "edit" then
		if string.find(string.sub(src, pos), "%S") then return nil, "text after the reason" end
		return proposal
	end

	if string.sub(src, pos, pos + #open - 1) ~= open then return nil, "no changes" end
	proposal.edits = {}
	while string.sub(src, pos, pos + #open - 1) == open do
		local lineEnd = string.find(src, "\n", pos + 1, true)
		local count = tonumber(string.match(string.sub(src, pos + #open, lineEnd - 1), "^(%d+)$"))
		if not count or count < 1 then return nil, "a change without a count" end
		local expected, afterExpected = block(lineEnd + 1)
		if not expected then return nil, afterExpected end
		if string.sub(src, afterExpected, afterExpected + #head - 1) ~= head then
			return nil, "an expected block without its replacement"
		end
		local replacement, afterReplacement = block(afterExpected + #head)
		if not replacement then return nil, afterReplacement end
		if expected == "" then return nil, "an empty expected text" end
		table.insert(proposal.edits, { expected = expected, replacement = replacement, count = count })
		pos = afterReplacement
	end
	if string.find(string.sub(src, pos), "%S") then return nil, "text after the last change" end
	return proposal
end

-----------------------------------------------------------------------
-- proposals.closedRecord(name, text)
--
-- What this client remembers of closing a proposal, while the page is
-- still the one it closed: gone, when it was deleted, or at the
-- revision it was left at. A page written again under the same name
-- is a new proposal, and the record is dropped. `text` is the page's
-- text when the caller has read it; false when it does not exist.
--
-- Returns:
--   Table { outcome, group, revision }, or nil.
-----------------------------------------------------------------------
function proposals.closedRecord(name, text)
	local record = proposals.closed[name]
	if not record then return nil end
	if text == nil then
		local ok, stored = pcall(space.readPage, name)
		text = ok and stored or false
	end
	local current = text and proposals.revisionOf(text) or nil
	if current == record.revision then return record end
	proposals.closed[name] = nil
	return nil
end

-----------------------------------------------------------------------
-- proposals.read(name)
--
-- Reads a proposal page: a page in the proposal folder, tagged as a
-- proposal, in the format, whose target (and new name) lie outside
-- the folders of the proposals and of the working copies: a proposal
-- may not write a proposal or plant a working copy.
--
-- Returns:
--   The proposal of proposals.parse with its `name` and `pageRevision`
--   (the revision of the proposal page), or nil and an error message.
-----------------------------------------------------------------------
function proposals.read(name)
	local inside, outside = proposals.inFolder(name)
	if not inside then return nil, outside end
	local ok, text = pcall(space.readPage, name)
	if not ok then return nil, "there is no such proposal" end
	local proposal, err = proposals.parse(text)
	if not proposal then return nil, err end
	local proposalPrefix, copyPrefix = proposals.folders()
	for _, page in ipairs({ proposal.target, proposal.to }) do
		if string.startsWith(page, proposalPrefix) then return nil, "the page " .. page .. " lies in the proposal folder" end
		if string.startsWith(page, copyPrefix) then return nil, "the page " .. page .. " lies in the folder of the working copies" end
	end
	proposal.name = name
	proposal.pageRevision = proposals.revisionOf(text)
	local record = proposals.closedRecord(name, text)
	if record then proposal.outcome = record.outcome end
	return proposal
end

-----------------------------------------------------------------------
-- proposals.applyEdits(text, edits)
--
-- The text after the edits, as edit-note of the MCP server applies
-- them: every expected text is looked up in the original, must occur
-- exactly `count` times, every occurrence is replaced, and no two
-- occurrences may overlap.
--
-- Returns:
--   The new text, or nil and why the edits do not apply (the stale
--   check).
-----------------------------------------------------------------------
function proposals.applyEdits(text, edits)
	local ranges = {}
	for n, edit in ipairs(edits) do
		local found = 0
		local start = string.find(text, edit.expected, 1, true)
		while start and found <= edit.count do
			found = found + 1
			table.insert(ranges, { start = start, stop = start + #edit.expected - 1, text = edit.replacement, edit = n })
			start = string.find(text, edit.expected, start + 1, true)
		end
		if found == 0 then
			return nil, "change " .. n .. ": the expected text is not in the page"
		elseif found ~= edit.count then
			local times = found > edit.count and ("more than " .. edit.count) or tostring(found)
			return nil, "change " .. n .. ": the expected text occurs " .. times .. " time(s), not " .. edit.count
		end
	end
	table.sort(ranges, function(a, b) return a.start < b.start end)
	for i = 2, #ranges do
		if ranges[i].start <= ranges[i - 1].stop then
			return nil, "changes " .. ranges[i - 1].edit .. " and " .. ranges[i].edit .. " overlap"
		end
	end
	local out, offset = {}, 1
	for _, range in ipairs(ranges) do
		table.insert(out, string.sub(text, offset, range.start - 1))
		table.insert(out, range.text)
		offset = range.stop + 1
	end
	table.insert(out, string.sub(text, offset))
	return table.concat(out)
end

-----------------------------------------------------------------------
-- proposals.workingCopy(name)
--
-- The name of the working copy of a proposal: the proposal's name
-- under the configured folder.
-----------------------------------------------------------------------
function proposals.workingCopy(name)
	local _, prefix, why = proposals.folders()
	if not prefix then return nil, why end
	return prefix .. name
end

-----------------------------------------------------------------------
-- proposals.proposalOf(page)
--
-- The proposal a working copy belongs to, or nil for any other page.
-----------------------------------------------------------------------
function proposals.proposalOf(page)
	local _, prefix = proposals.folders()
	if not prefix or type(page) ~= "string" or #page <= #prefix or not string.startsWith(page, prefix) then return nil end
	return string.sub(page, #prefix + 1)
end

-----------------------------------------------------------------------
-- proposals.evaluate(proposal)
--
-- Tests a proposal against its target as it is now.
--
-- Returns:
--   Table {
--     state    "open", or "stale" when it cannot be applied
--     why      the reason of "stale"
--     old      the target's text, nil when it cannot be read
--     new      edit: the text with the proposal applied, or the working
--              copy's text when there is one
--     edited   edit: true when `new` is a working copy
--     changed  true when the target is not at the proposal's revision
--   }
-----------------------------------------------------------------------
function proposals.evaluate(proposal)
	local result = { state = "open" }
	local ok, old = pcall(space.readPage, proposal.target)
	if not ok then
		result.state = "stale"
		result.why = "the page " .. proposal.target .. " does not exist"
		return result
	end
	result.old = old
	result.changed = proposals.revisionOf(old) ~= proposal.revision
	if proposal.action == "edit" then
		local copy = proposal.name and proposals.workingCopy(proposal.name)
		if copy and space.pageExists(copy) then
			result.new = space.readPage(copy)
			result.edited = true
			return result
		end
		local new, why = proposals.applyEdits(old, proposal.edits)
		if not new then
			result.state = "stale"
			result.why = why
		end
		result.new = new
	elseif proposal.action == "move" then
		if space.pageExists(proposal.to) then
			result.state = "stale"
			result.why = "a page named " .. proposal.to .. " exists already"
		end
	end
	return result
end

-----------------------------------------------------------------------
-- proposals.entries(target)
--
-- The open proposals as the index knows them, without those closed in
-- this client and outside the proposal folder: { name, target, action,
-- group }, ordered by group (the
-- proposals without one last; groups that are numbers by their value,
-- before the others), then by name. With `target`, only those for that
-- page.
-----------------------------------------------------------------------
function proposals.entries(target)
	local out = {}
	local tag = proposals.tag
	for _, p in ipairs(query[[from p = index.tag(tag) where p.tag == "page" order by p.name]]) do
		local record = proposals.closed[p.name] and proposals.closedRecord(p.name)
		local outcome = record and record.outcome or p.outcome or "open"
		local to = proposals.unlink(p.target)
		if outcome == "open" and proposals.inFolder(p.name) and (target == nil or to == target) then
			table.insert(out, {
				name = p.name,
				target = to,
				action = p.action,
				group = p.group ~= nil and tostring(p.group) or nil
			})
		end
	end
	table.sort(out, function(a, b)
		if a.group ~= b.group then
			if a.group == nil then return false end
			if b.group == nil then return true end
			local x, y = tonumber(a.group), tonumber(b.group)
			if x and y and x ~= y then return x < y end
			if x and not y then return true end
			if y and not x then return false end
			return a.group < b.group
		end
		return a.name < b.name
	end)
	return out
end

-----------------------------------------------------------------------
-- proposals.batchKey(group)
--
-- Where the client keeps what it remembers of a batch.
-----------------------------------------------------------------------
function proposals.batchKey(group)
	return "proposals.batch:" .. (group or "")
end

-----------------------------------------------------------------------
-- proposals.batch(name, group)
--
-- The batch a proposal is reviewed in: the proposals of its group (or
-- those without a group), in the order of the list. Proposals already
-- applied or rejected in this client still count, so the position of a
-- proposal does not change while the batch is worked through; they are
-- remembered in the client's store, with the batch's members, until
-- none of those members is open any more (the batch was finished,
-- here or in another browser). Proposals that arrive while a batch is
-- open join it.
--
-- Returns:
--   Table { names = all names in order, open = { [name] = true },
--   closed = { [name] = outcome } (remembered), index = position of
--   `name` }.
-----------------------------------------------------------------------
function proposals.batch(name, group)
	local key = proposals.batchKey(group)
	local remembered = clientStore.get(key) or {}
	local seen, names, open = {}, {}, {}
	local current = false
	for _, entry in ipairs(proposals.entries()) do
		if entry.group == group then
			open[entry.name] = true
			seen[entry.name] = true
			table.insert(names, entry.name)
			if remembered.members and remembered.members[entry.name] then current = true end
		end
	end
	if not current then
		if remembered.members then clientStore.delete(key) end
		remembered = {}
	end
	local closed = remembered.closed or {}
	for closedName in pairs(closed) do
		if not seen[closedName] then
			seen[closedName] = true
			table.insert(names, closedName)
		end
	end
	if name and not seen[name] then table.insert(names, name) end
	table.sort(names)
	local position = 0
	for i, candidate in ipairs(names) do
		if candidate == name then position = i end
	end
	return { names = names, open = open, closed = closed, index = position }
end

-----------------------------------------------------------------------
-- proposals.neighbours(name, group, batch)
--
-- `batch` is proposals.batch(name, group) when the caller has it.
--
-- Returns:
--   The open proposals before and after `name` in its batch (each may
--   be nil).
-----------------------------------------------------------------------
function proposals.neighbours(name, group, batch)
	batch = batch or proposals.batch(name, group)
	local previous, following
	for i, candidate in ipairs(batch.names) do
		if batch.open[candidate] and candidate ~= name then
			if i < batch.index then previous = candidate end
			if i > batch.index and not following then following = candidate end
		end
	end
	return previous, following
end

-----------------------------------------------------------------------
-- proposals.successor(name, group)
--
-- The proposal to review once `name` is closed: the next open one of
-- its batch, then the first open one of the batch, then the first open
-- proposal of the list; nil when none is left.
-----------------------------------------------------------------------
function proposals.successor(name, group)
	local batch = proposals.batch(name, group)
	local _, following = proposals.neighbours(name, group, batch)
	if following then return following end
	for _, candidate in ipairs(batch.names) do
		if batch.open[candidate] and candidate ~= name then return candidate end
	end
	for _, entry in ipairs(proposals.entries()) do
		if entry.name ~= name then return entry.name end
	end
	return nil
end

-----------------------------------------------------------------------
-- proposals.setOutcome(name, outcome)
--
-- Records the outcome in the frontmatter of a proposal page that is
-- kept: replaces its `outcome:` line, or adds one before the closing
-- "---". Returns the text written.
-----------------------------------------------------------------------
function proposals.setOutcome(name, outcome)
	local text = space.readPage(name)
	local frontmatter, rest = string.match(text, "^(%-%-%-\n.-\n)(%-%-%-\n.*)$")
	if not frontmatter then
		text = "---\noutcome: " .. outcome .. "\n---\n" .. text
	elseif string.find(frontmatter, "\noutcome:", 1, true) then
		local replaced = string.gsub(frontmatter, "\noutcome:[^\n]*", "\noutcome: " .. outcome, 1)
		text = replaced .. rest
	else
		text = frontmatter .. "outcome: " .. outcome .. "\n" .. rest
	end
	space.writePage(name, text)
	return text
end

-----------------------------------------------------------------------
-- proposals.close(name, group, outcome)
--
-- Closes a proposal as "applied" or "rejected": deletes its working
-- copy, remembers it in its batch, and deletes the proposal page, or,
-- with deleteClosed = false, keeps it with the outcome in its
-- frontmatter.
-----------------------------------------------------------------------
function proposals.close(name, group, outcome)
	if not proposals.inFolder(name) then error("not a page in the proposal folder: " .. tostring(name)) end
	local copy = proposals.workingCopy(name)
	if copy and space.pageExists(copy) then space.deletePage(copy) end
	clientStore.delete(proposals.copyKey(name))
	local revision = nil
	if proposals.config().deleteClosed then
		space.deletePage(name)
	else
		revision = proposals.revisionOf(proposals.setOutcome(name, outcome))
	end
	proposals.closed[name] = { outcome = outcome, group = group, revision = revision }
	local key = proposals.batchKey(group)
	local batch = proposals.batch(name, group)
	if next(batch.open) == nil then
		clientStore.delete(key)
	else
		local members = {}
		for _, member in ipairs(batch.names) do members[member] = true end
		batch.closed[name] = outcome
		clientStore.set(key, { members = members, closed = batch.closed })
	end
end

-----------------------------------------------------------------------
-- proposals.rename(from, to)
--
-- Renames a page with SilverBullet's own "Page: Rename", which also
-- rewrites the links to it.
--
-- Returns:
--   true, or false and the reason.
-----------------------------------------------------------------------
function proposals.rename(from, to)
	local ok, err = pcall(function()
		return system.invokeFunction("index.renamePageCommand", { oldPage = from, page = to })
	end)
	if not ok then return false, "the page could not be renamed: " .. tostring(err) end
	if space.pageExists(from) or not space.pageExists(to) then
		return false, "the page was not renamed"
	end
	return true
end

-----------------------------------------------------------------------
-- proposals.binding(proposal, result)
--
-- What a person was shown of a proposal, to tie a button to it: the
-- revision of the proposal page, its action, target and new name and,
-- with the result of proposals.evaluate, the revision of the target
-- and of the working copy as shown. An action refuses when the
-- proposal or the page is no longer what was shown
-- (proposals.mismatch), so an agent cannot swap a proposal between
-- the review and the click.
-----------------------------------------------------------------------
function proposals.binding(proposal, result)
	local binding = {
		proposal = proposal.pageRevision,
		action = proposal.action,
		target = proposal.target,
		to = proposal.to or false
	}
	if result then
		binding.targetRevision = result.old and proposals.revisionOf(result.old) or false
		binding.copyRevision = result.edited and proposals.revisionOf(result.new) or false
	end
	return binding
end

-----------------------------------------------------------------------
-- proposals.mismatch(expect, proposal, old, copyText)
--
-- Compares a binding with the proposal as it is now, the target's
-- text (`old`) and the working copy's text; a field the binding does
-- not have (nil) is not compared.
--
-- Returns:
--   nil when everything matches, or what differs.
-----------------------------------------------------------------------
function proposals.mismatch(expect, proposal, old, copyText)
	if expect == nil then return nil end
	local function differs(what, want, have)
		if want ~= nil and want ~= have then return what end
	end
	return differs("the proposal", expect.proposal, proposal.pageRevision)
		or differs("the action", expect.action, proposal.action)
		or differs("the target", expect.target, proposal.target)
		or differs("the new name", expect.to, proposal.to or false)
		or differs("the page", expect.targetRevision, old and proposals.revisionOf(old) or false)
		or differs("the working copy", expect.copyRevision, copyText and proposals.revisionOf(copyText) or false)
end

-- the reason an action gives when proposals.mismatch found a difference
function proposals.changedSince(what)
	return what .. " changed since it was shown: look at it again"
end

-----------------------------------------------------------------------
-- proposals.apply(name, options)
--
-- Applies a proposal with the rights of the person in whose browser it
-- runs: reads the proposal and its target again, runs the stale check,
-- writes, deletes or renames the target and closes the proposal.
--
-- A delete or a move of a page that changed after the proposal was
-- written is applied only with options.changed = true, which the
-- review passes because it showed the warning; "Apply all" does not.
-- A proposal with a working copy is not applied: the copy is accepted
-- or reverted first. It is applied only when the proposal and the
-- page are what a person was shown: options.expect is the binding of
-- that (proposals.binding), and without one nothing is applied. Only
-- the tests pass options.unbound = true instead.
--
-- Returns:
--   true and the proposal, or false and the reason.
-----------------------------------------------------------------------
function proposals.apply(name, options)
	options = options or {}
	if options.expect == nil and options.unbound ~= true then return false, "not bound to what was shown" end
	local proposal, err = proposals.read(name)
	if not proposal then return false, err end
	if proposal.outcome ~= "open" then return false, "the proposal is " .. proposal.outcome .. " already" end
	local result = proposals.evaluate(proposal)
	local differs = proposals.mismatch(options.expect, proposal, result.old, result.edited and result.new)
	if differs then return false, proposals.changedSince(differs) end
	if result.state == "stale" then return false, "stale: " .. result.why end
	if result.edited then return false, "it has a working copy: accept or revert that first" end
	if proposal.action == "edit" then
		space.writePage(proposal.target, result.new)
	elseif result.changed and not options.changed then
		return false, "the page changed after the proposal was written: review it on its own"
	elseif proposal.action == "delete" then
		space.deletePage(proposal.target)
	else
		local ok, why = proposals.rename(proposal.target, proposal.to)
		if not ok then return false, why end
	end
	proposals.close(name, proposal.group, "applied")
	return true, proposal
end

-----------------------------------------------------------------------
-- proposals.reject(name)
--
-- Closes a proposal without applying it. Only a page that can be
-- rejected (proposals.rejectable) is.
--
-- Returns:
--   true and the proposal (a table with the name and the group only
--   when the page cannot be read as a proposal), or false and the
--   reason.
-----------------------------------------------------------------------
function proposals.reject(name)
	local frontmatter, why = proposals.rejectable(name)
	if not frontmatter then return false, why end
	local proposal = proposals.read(name)
	if not proposal then
		proposal = { name = name, group = frontmatter.group ~= nil and tostring(frontmatter.group) or nil }
	end
	proposals.close(name, proposal.group, "rejected")
	return true, proposal
end

-----------------------------------------------------------------------
-- proposals.rejectable(name)
--
-- Whether a page can be rejected: a page in the proposal folder,
-- tagged as a proposal and not closed in this client, even when it is
-- not in the format this library reads.
--
-- Returns:
--   Its frontmatter, or nil and why not.
-----------------------------------------------------------------------
function proposals.rejectable(name)
	local inside, outside = proposals.inFolder(name)
	if not inside then return nil, outside end
	local ok, text = pcall(space.readPage, name)
	if not ok then return nil, "there is no such proposal" end
	local frontmatter = index.extractFrontmatter(text).frontmatter or {}
	if not proposals.tagged(frontmatter) then return nil, "not tagged " .. proposals.tag end
	if proposals.closedRecord(name, text) or (frontmatter.outcome or "open") ~= "open" then
		return nil, "the proposal is closed already"
	end
	return frontmatter
end

-----------------------------------------------------------------------
-- proposals.copyKey(name)
--
-- Where the client keeps the target and the revision it had when the
-- working copy of a proposal was made.
-----------------------------------------------------------------------
function proposals.copyKey(name)
	return "proposals.copy:" .. name
end

-----------------------------------------------------------------------
-- proposals.makeCopy(name, rebuild, expect)
--
-- Makes the working copy of an edit proposal: the target with the
-- proposal applied, as a page of its own, and remembers the target and
-- its revision in the client's store. An existing copy is kept, unless
-- `rebuild` is true ("Revert to proposal"). With `expect`
-- (proposals.binding), only when the proposal and the target are what
-- was shown.
--
-- Returns:
--   The working copy's name, or nil and the reason.
-----------------------------------------------------------------------
function proposals.makeCopy(name, rebuild, expect)
	local proposal, err = proposals.read(name)
	if not proposal then return nil, err end
	if proposal.action ~= "edit" then return nil, "only an edit has a working copy" end
	if proposal.outcome ~= "open" then return nil, "the proposal is " .. proposal.outcome .. " already" end
	local copy, why = proposals.workingCopy(name)
	if not copy then return nil, why end
	local ok, old = pcall(space.readPage, proposal.target)
	if not ok then old = nil end
	local differs = proposals.mismatch({
		proposal = expect and expect.proposal, action = expect and expect.action,
		target = expect and expect.target, targetRevision = expect and expect.targetRevision
	}, proposal, old)
	if differs then return nil, proposals.changedSince(differs) end
	if space.pageExists(copy) and not rebuild then return copy end
	if not old then return nil, "the page " .. proposal.target .. " does not exist" end
	local new, stale = proposals.applyEdits(old, proposal.edits)
	if not new then return nil, "stale: " .. stale end
	space.writePage(copy, new)
	clientStore.set(proposals.copyKey(name), { target = proposal.target, revision = proposals.revisionOf(old) })
	return copy
end

-----------------------------------------------------------------------
-- proposals.accept(name, text, unchecked, expect)
--
-- Writes the working copy of a proposal to its target and closes the
-- proposal. `text` is the copy's text when the caller has it (the
-- editor's, when the copy is the page shown); otherwise the page is
-- read. The target must still be the page, at the revision, it was
-- when the copy was made; a copy made in another browser has no such
-- record here, and is accepted only with `unchecked` = true. With
-- `expect` (proposals.binding), only when the proposal, the target and
-- the working copy are what was shown.
--
-- Returns:
--   true and the proposal, or false, the reason and, when only the
--   revision is unknown, "unchecked".
-----------------------------------------------------------------------
function proposals.accept(name, text, unchecked, expect)
	local proposal, err = proposals.read(name)
	if not proposal then return false, err end
	if proposal.outcome ~= "open" then return false, "the proposal is " .. proposal.outcome .. " already" end
	local copy, why = proposals.workingCopy(name)
	if not copy then return false, why end
	if text == nil then
		local ok, stored = pcall(space.readPage, copy)
		if not ok then return false, "there is no working copy" end
		text = stored
	end
	local ok, old = pcall(space.readPage, proposal.target)
	if not ok then return false, "the page " .. proposal.target .. " does not exist" end
	local differs = proposals.mismatch(expect, proposal, old, text)
	if differs then return false, proposals.changedSince(differs) end
	local base = clientStore.get(proposals.copyKey(name))
	if type(base) ~= "table" then base = nil end
	if base == nil and not unchecked then
		return false, "the working copy was made in another browser, so it is not known whether " .. proposal.target .. " changed since", "unchecked"
	end
	if base ~= nil and base.target ~= proposal.target then
		return false, "the working copy was made for " .. tostring(base.target) .. ", not " .. proposal.target
	end
	if base ~= nil and base.revision ~= proposals.revisionOf(old) then
		return false, proposal.target .. " changed after the working copy was made: revert to the proposal and edit again"
	end
	space.writePage(proposal.target, text)
	proposals.close(name, proposal.group, "applied")
	return true, proposal
end

-----------------------------------------------------------------------
-- Package proposals (diff)
--
-- The two views of a change, the way GitHub shows a diff of a Markdown
-- file: as text (source lines, changed words highlighted) and
-- formatted (the page as it will look). The diff is computed by jsdiff
-- (BSD-3-Clause), carried base64-encoded in proposals.jsdiffSource and
-- imported from a data: URL, so nothing is loaded from the network.
--
-- Nothing here evaluates what it shows: text goes into the page as
-- text nodes, and the formatted view is rendered by SilverBullet's own
-- markdown renderer, which shows ${...} as text, and then stripped of
-- what could change how the review looks (proposals.sanitize).
-----------------------------------------------------------------------

-----------------------------------------------------------------------
-- proposals.jsdiff()
--
-- The jsdiff module, imported once.
-----------------------------------------------------------------------
function proposals.jsdiff()
	if not proposals.jsdiffModule then
		proposals.jsdiffModule = js.import("data:text/javascript;base64," .. proposals.jsdiffSource)
	end
	return proposals.jsdiffModule
end

-----------------------------------------------------------------------
-- proposals.lines(value)
--
-- The lines of a text, without the final line break.
-----------------------------------------------------------------------
function proposals.lines(value)
	local out = {}
	local trimmed = string.gsub(value, "\n$", "")
	for line in string.gmatch(trimmed .. "\n", "(.-)\n") do table.insert(out, line) end
	return out
end

-----------------------------------------------------------------------
-- proposals.el(tag, attributes, text)
--
-- A DOM element with `text` as a plain text node. String children of
-- the dom API are rendered as markdown, which would turn "# x" into a
-- heading and [[x]] into a link, so text from a page never goes in as
-- a string child.
-----------------------------------------------------------------------
function proposals.el(tag, attributes, text)
	local element = dom[tag](attributes or {})
	if text ~= nil then
		element.appendChild(js.window.document.createTextNode(tostring(text)))
	end
	return element
end

-- Colours that read on light and dark themes alike.
proposals.colours = {
	removedLine = "rgba(255,129,130,0.15)",
	removedWord = "rgba(255,129,130,0.45)",
	addedLine = "rgba(46,160,67,0.15)",
	addedWord = "rgba(46,160,67,0.45)",
	removedBar = "rgb(207,34,46)",
	addedBar = "rgb(26,127,55)",
	warning = "rgba(212,167,44,0.2)",
	border = "rgba(128,128,128,0.4)",
	shade = "rgba(128,128,128,0.12)"
}

-----------------------------------------------------------------------
-- proposals.codeLine(segments, colour)
--
-- One line of the text diff as a DOM node: segments are { text,
-- highlighted } pairs, highlighted ones get the word colour.
-----------------------------------------------------------------------
function proposals.codeLine(segments, colour)
	local cell = dom.td { style = "white-space:pre-wrap;word-break:break-word;padding:0 0.5em;font-family:var(--editor-font, monospace);" }
	for _, s in ipairs(segments) do
		if s[2] then
			cell.appendChild(proposals.el("span", { style = "background:" .. colour .. ";border-radius:2px;" }, s[1]))
		else
			cell.appendChild(proposals.el("span", {}, s[1]))
		end
	end
	return cell
end

-----------------------------------------------------------------------
-- proposals.textDiff(old, new, context)
--
-- The text view: changed lines with `context` lines around them (three
-- when nil, every line when negative), removed in red, added in green,
-- changed words highlighted when a block of removed lines is followed
-- by as many added ones.
-----------------------------------------------------------------------
function proposals.textDiff(old, new, context)
	context = context or 3
	local m = proposals.jsdiff()
	local c = proposals.colours
	local parts = m.diffLines(old, new)
	-- flatten into rows { kind, oldNo, newNo, segments }
	local rows = {}
	local oldNo, newNo = 1, 1
	local i = 1
	while i <= parts.length do
		local p = parts[i]
		local nextPart = (i < parts.length) and parts[i + 1] or nil
		if p.removed and nextPart and nextPart.added and #proposals.lines(p.value) == #proposals.lines(nextPart.value) then
			local removedLines, addedLines = proposals.lines(p.value), proposals.lines(nextPart.value)
			local pendingAdded = {}
			for k = 1, #removedLines do
				local words = m.diffWordsWithSpace(removedLines[k], addedLines[k])
				local minus, plus = {}, {}
				for w = 1, words.length do
					local word = words[w]
					if word.removed then table.insert(minus, { word.value, true })
					elseif word.added then table.insert(plus, { word.value, true })
					else
						table.insert(minus, { word.value, false })
						table.insert(plus, { word.value, false })
					end
				end
				table.insert(rows, { kind = "-", oldNo = oldNo, segments = minus })
				oldNo = oldNo + 1
				table.insert(pendingAdded, plus)
			end
			for _, plus in ipairs(pendingAdded) do
				table.insert(rows, { kind = "+", newNo = newNo, segments = plus })
				newNo = newNo + 1
			end
			i = i + 2
		else
			for _, line in ipairs(proposals.lines(p.value)) do
				if p.removed then
					table.insert(rows, { kind = "-", oldNo = oldNo, segments = { { line, false } } })
					oldNo = oldNo + 1
				elseif p.added then
					table.insert(rows, { kind = "+", newNo = newNo, segments = { { line, false } } })
					newNo = newNo + 1
				else
					table.insert(rows, { kind = " ", oldNo = oldNo, newNo = newNo, segments = { { line, false } } })
					oldNo, newNo = oldNo + 1, newNo + 1
				end
			end
			i = i + 1
		end
	end
	-- keep the context around every change
	local keep = {}
	for n, row in ipairs(rows) do
		if context < 0 then
			keep[n] = true
		elseif row.kind ~= " " then
			for k = math.max(1, n - context), math.min(#rows, n + context) do keep[k] = true end
		end
	end
	local tbl = dom.table { class = "proposals-text", style = "border-collapse:collapse;width:100%;font-size:0.85em;" }
	local skipped = 0
	local function flushSkipped()
		if skipped > 0 then
			local tr = dom.tr {}
			tr.appendChild(proposals.el("td", { colspan = "4", style = "opacity:0.6;padding:0.2em 0.5em;font-style:italic;" },
				skipped .. " unchanged line" .. (skipped == 1 and "" or "s")))
			tbl.appendChild(tr)
			skipped = 0
		end
	end
	for n, row in ipairs(rows) do
		if keep[n] then
			flushSkipped()
			local bg, word = "transparent", nil
			if row.kind == "-" then bg, word = c.removedLine, c.removedWord end
			if row.kind == "+" then bg, word = c.addedLine, c.addedWord end
			local num = "opacity:0.5;text-align:right;padding:0 0.4em;user-select:none;font-family:monospace;"
			local tr = dom.tr { style = "background:" .. bg .. ";" }
			tr.appendChild(proposals.el("td", { style = num }, row.oldNo or ""))
			tr.appendChild(proposals.el("td", { style = num }, row.newNo or ""))
			tr.appendChild(proposals.el("td", { style = "user-select:none;font-family:monospace;padding:0 0.2em;" }, row.kind))
			tr.appendChild(proposals.codeLine(row.segments, word or bg))
			tbl.appendChild(tr)
		else
			skipped = skipped + 1
		end
	end
	flushSkipped()
	return tbl
end

-----------------------------------------------------------------------
-- proposals.frontmatterDiff(old, new)
--
-- The frontmatter of a page before and after, as a text diff of every
-- line of it, under a caption. The formatted view shows the body only,
-- so a change to the frontmatter is shown this way above it.
--
-- Returns:
--   A DOM node, or nil when the frontmatter does not change.
-----------------------------------------------------------------------
function proposals.frontmatterDiff(old, new)
	local before = proposals.splitFrontmatter(old)
	local after = proposals.splitFrontmatter(new)
	if before == after then return nil end
	local c = proposals.colours
	local box = dom.div { class = "proposals-frontmatter", style = "margin:0 0.6em 0.6em 0.6em;border:1px solid " .. c.border .. ";border-radius:4px;overflow:hidden;" }
	box.appendChild(proposals.el("div", { style = "padding:0.2em 0.6em;font-size:0.85em;opacity:0.8;background:" .. c.shade .. ";border-bottom:1px solid " .. c.border .. ";" }, "Frontmatter"))
	box.appendChild(proposals.textDiff(before, after, -1))
	return box
end

-----------------------------------------------------------------------
-- proposals.sanitize(root)
--
-- Strips rendered markdown of what could make the review show
-- something other than the change, or tell anyone that it is open.
-- SilverBullet's renderer drops scripts and event handlers, but keeps
-- styles, with which a block can lie over another or hide itself, and
-- remote images, which load when the review is shown. Removes style
-- sheets, embedded documents, media and forms, every style, class and
-- id, and every image that does not come from the space; such an image
-- becomes a note with its address. The root itself is left as it is.
-----------------------------------------------------------------------
proposals.dropped = "style, link, meta, base, iframe, frame, frameset, object, embed, applet, portal, " ..
	"video, audio, source, track, picture, svg, math, template, form, input[type=image], button, select, textarea"

proposals.droppedAttributes = { style = true, class = true, id = true, srcset = true, background = true, poster = true }

-- an address as the browser's URL parser reads it: without the
-- control characters and spaces around it, without the tabs and line
-- breaks inside it, and without the <...> of a Markdown link
function proposals.address(address)
	address = string.gsub(tostring(address or ""), "^[%c ]+", "")
	address = string.gsub(address, "[%c ]+$", "")
	address = string.gsub(address, "[\t\n\r]", "")
	return string.match(address, "^<(.*)>$") or address
end

-- the scheme of an address in lower case, or nil for a relative one
function proposals.scheme(address)
	local scheme = string.match(proposals.address(address), "^(%a[%w+.-]*):")
	return scheme and string.lower(scheme)
end

-- whether an address loads from elsewhere than the space: a scheme
-- other than data:, or a protocol-relative "//host"
function proposals.remote(address)
	if string.find(proposals.address(address), "^[/\\][/\\]") then return true end
	local scheme = proposals.scheme(address)
	return scheme ~= nil and scheme ~= "data"
end

-- the schemes a link of the formatted view may keep
proposals.linkSchemes = { http = true, https = true, mailto = true }

function proposals.sanitize(root)
	local doc = root.ownerDocument
	local dropped = root.querySelectorAll(proposals.dropped)
	for k = 1, dropped.length do dropped[k].remove() end
	local images = root.querySelectorAll("img")
	for k = 1, images.length do
		local img = images[k]
		local src = img.getAttribute("src")
		if proposals.remote(src) then
			img.replaceWith(doc.createTextNode("[remote image not loaded: " .. tostring(src) .. "]"))
		end
	end
	local all = root.querySelectorAll("*")
	for k = 1, all.length do
		local element = all[k]
		local names = {}
		local attributes = element.attributes
		for a = 1, attributes.length do
			local attribute = string.lower(attributes[a].name)
			local value = attributes[a].value
			local badReference = false
			if string.find(attribute, "href$") then
				if element.tagName == "A" then
					local scheme = proposals.scheme(value)
					badReference = scheme ~= nil and not proposals.linkSchemes[scheme]
				else
					badReference = proposals.remote(value)
				end
			end
			if proposals.droppedAttributes[attribute] or string.find(attribute, "^on") or badReference then
				table.insert(names, attributes[a].name)
			end
		end
		for _, attribute in ipairs(names) do element.removeAttribute(attribute) end
	end
	-- the renderer's own style kept an image inside the page's width
	local kept = root.querySelectorAll("img")
	for k = 1, kept.length do kept[k].style.maxWidth = "100%" end
	return root
end

-----------------------------------------------------------------------
-- proposals.holdsHtml(text)
--
-- Whether a page text holds HTML tags, which the formatted view shows
-- only in part: the review then opens on the text view.
-----------------------------------------------------------------------
function proposals.holdsHtml(text)
	return type(text) == "string" and string.find(text, "<[%a/!?]") ~= nil
end

-----------------------------------------------------------------------
-- proposals.withoutRemoteImages(text)
--
-- The markdown with every image of the form ![alt](address) and every
-- reference definition [label]: address whose address is remote
-- replaced by a note with its address. SilverBullet's renderer requests
-- such an image while it renders, before anything of its result can be
-- sanitized; an image in HTML, it does not. A reference-style image
-- (![x][r], ![r][], ![r]) is no image to the renderer, and a
-- transclusion of an address (![[https://...]]) it shows as an error
-- text without an img element, so it requests neither (pinned by a
-- test). Replacing the definitions is a second layer, should a renderer
-- resolve them.
-----------------------------------------------------------------------
function proposals.withoutRemoteImages(text)
	local ranges = {}
	local function walk(node)
		if node.type == "Image" or node.type == "LinkReference" then
			for _, child in ipairs(node.children or {}) do
				if child.type == "URL" then
					local address = string.sub(text, child.from + 1, child.to)
					if proposals.remote(address) then
						table.insert(ranges, { from = node.from, to = node.to, address = address })
					end
				end
			end
			return
		end
		for _, child in ipairs(node.children or {}) do walk(child) end
	end
	walk(markdown.parseMarkdown(text))
	local out, offset = {}, 1
	for _, range in ipairs(ranges) do
		table.insert(out, string.sub(text, offset, range.from))
		table.insert(out, "\\[remote image not loaded: `" .. string.gsub(range.address, "`", "") .. "`\\]")
		offset = range.to + 1
	end
	table.insert(out, string.sub(text, offset))
	return table.concat(out)
end

-----------------------------------------------------------------------
-- proposals.markdownBlock(text, style)
--
-- Markdown rendered into a block of the formatted view, sanitized and
-- contained: nothing in it can paint outside it. The HTML is parsed
-- in a document of its own, which loads nothing, and only what the
-- sanitizer left is taken into the page: an image is not requested
-- before it is dropped.
-----------------------------------------------------------------------
function proposals.markdownBlock(text, style)
	local doc = js.window.document
	local inert = doc.implementation.createHTMLDocument("")
	local holder = inert.createElement("div")
	holder.innerHTML = markdown.markdownToHtml(proposals.withoutRemoteImages(text))
	proposals.sanitize(holder)
	local block = dom.div { style = style .. "overflow:hidden;contain:paint;position:relative;" }
	block.appendChild(doc.importNode(holder, true))
	return block
end

-----------------------------------------------------------------------
-- proposals.rendered(text, kind)
--
-- A piece of markdown rendered as one block of the formatted view:
-- "-" removed (struck through on red), "+" added (on green), "x" to be
-- deleted (a red bar, readable), anything else unchanged.
-----------------------------------------------------------------------
function proposals.rendered(text, kind)
	local c = proposals.colours
	local style = "padding:0.1em 0.6em;"
	if kind == "-" then
		style = style .. "background:" .. c.removedLine .. ";border-left:3px solid " .. c.removedBar .. ";text-decoration:line-through;opacity:0.85;"
	elseif kind == "+" then
		style = style .. "background:" .. c.addedLine .. ";border-left:3px solid " .. c.addedBar .. ";"
	elseif kind == "x" then
		style = style .. "border-left:3px solid " .. c.removedBar .. ";"
	else
		style = style .. "border-left:3px solid transparent;"
	end
	return proposals.markdownBlock(text, style)
end

-----------------------------------------------------------------------
-- proposals.fenceOpening(line)
--
-- The fence a line opens a fenced code block with (three or more
-- backticks or tildes, after up to three spaces), or nil.
-----------------------------------------------------------------------
function proposals.fenceOpening(line)
	local indent, run = string.match(line, "^( *)(```+)")
	if not run then indent, run = string.match(line, "^( *)(~~~+)") end
	if run and #indent <= 3 then return run end
	return nil
end

-- whether a line closes a code block opened with `fence`
function proposals.fenceCloses(line, fence)
	local indent, run = string.match(line, "^( *)([`~]+)%s*$")
	return run ~= nil and #indent <= 3 and #run >= #fence
		and string.find(run, string.sub(fence, 1, 1) == "`" and "~" or "`", 1, true) == nil
end

-- whether a block of proposals.blocks is a fenced code block
function proposals.isCode(block)
	return proposals.fenceOpening(block) ~= nil
end

-----------------------------------------------------------------------
-- proposals.blocks(text)
--
-- The blocks of a page body, as the formatted view compares them:
-- separated by blank lines; a heading is a block of its own, because a
-- page often puts its text directly under the heading; a fenced code
-- block is one block, blank lines and "#" lines inside it included.
-----------------------------------------------------------------------
function proposals.blocks(text)
	local out, current = {}, {}
	local fence = nil
	local function flush()
		if #current > 0 then table.insert(out, table.concat(current, "\n")) end
		current = {}
	end
	local _, body = proposals.splitFrontmatter(text)
	for _, line in ipairs(proposals.lines(body)) do
		if fence then
			table.insert(current, line)
			if proposals.fenceCloses(line, fence) then
				fence = nil
				flush()
			end
		elseif proposals.fenceOpening(line) then
			flush()
			fence = proposals.fenceOpening(line)
			table.insert(current, line)
		elseif not string.find(line, "%S") then
			flush()
		elseif string.find(line, "^ ? ? ?#+ ") or string.find(line, "^ ? ? ?#+$") then
			flush()
			table.insert(current, line)
			flush()
		else
			table.insert(current, line)
		end
	end
	flush()
	return out
end

-----------------------------------------------------------------------
-- proposals.formattedDiff(old, new)
--
-- The formatted view: the page as it will look, rendered by
-- SilverBullet's own markdown renderer (which shows ${...} as text
-- and drops scripts and event handlers) and sanitized
-- (proposals.sanitize); removed text struck through on red, added text
-- on green. Blocks (proposals.blocks) that are unchanged render as
-- they are; a changed block is compared line by line, a changed table
-- row by row, so only what changed is coloured; a changed code block,
-- or a table whose header changed, is shown removed and added whole.
-- A change to the frontmatter is shown above the body
-- (proposals.frontmatterDiff).
-----------------------------------------------------------------------
function proposals.formattedDiff(old, new)
	local m = proposals.jsdiff()
	local c = proposals.colours
	local container = dom.div { class = "proposals-formatted", style = "display:flex;flex-direction:column;gap:0.3em;" }
	local frontmatter = proposals.frontmatterDiff(old, new)
	if frontmatter then container.appendChild(frontmatter) end

	local function render(text, kind)
		container.appendChild(proposals.rendered(text, kind))
	end

	local blocks = proposals.blocks

	-- a changed block, line by line: only the changed lines are coloured,
	-- so an edited list item does not repeat the list and an edited line
	-- of a paragraph does not strike the paragraph
	local function lineDiff(before, after)
		local items = m.diffArrays(js.tojs(proposals.lines(before)), js.tojs(proposals.lines(after)))
		for i = 1, items.length do
			local part = items[i]
			local kind = part.removed and "-" or (part.added and "+" or " ")
			local lines = {}
			for k = 1, part.value.length do table.insert(lines, part.value[k]) end
			render(table.concat(lines, "\n"), kind)
		end
	end

	-- a changed table or code block is shown whole, removed and added: a
	-- line of either alone renders as something else
	local function whole(before, after)
		render(before, "-")
		render(after, "+")
	end

	local function isTable(block)
		local lines = proposals.lines(block)
		if #lines < 2 then return false end
		for _, line in ipairs(lines) do
			if not string.find(line, "^%s*|") then return false end
		end
		return true
	end

	-- a changed table: one table holding the removed and the added rows,
	-- each row coloured, so the table keeps its shape
	local function tableDiff(before, after)
		local oldLines, newLines = proposals.lines(before), proposals.lines(after)
		if oldLines[1] ~= newLines[1] or oldLines[2] ~= newLines[2] then return whole(before, after) end
		local oldRows, newRows = {}, {}
		for k = 3, #oldLines do table.insert(oldRows, oldLines[k]) end
		for k = 3, #newLines do table.insert(newRows, newLines[k]) end
		local rows = m.diffArrays(js.tojs(oldRows), js.tojs(newRows))
		local lines, kinds = { newLines[1], newLines[2] }, {}
		for i = 1, rows.length do
			local part = rows[i]
			for k = 1, part.value.length do
				table.insert(lines, part.value[k])
				table.insert(kinds, part.removed and "-" or (part.added and "+" or " "))
			end
		end
		local block = proposals.markdownBlock(table.concat(lines, "\n"), "padding:0.1em 0.6em;border-left:3px solid " .. c.addedBar .. ";")
		local trs = block.querySelectorAll("tr")
		for k, kind in ipairs(kinds) do
			local tr = trs[k + 1]
			if tr and kind == "-" then
				tr.style.background = c.removedWord
				tr.style.textDecoration = "line-through"
			elseif tr and kind == "+" then
				tr.style.background = c.addedWord
			end
		end
		container.appendChild(block)
	end

	local parts = m.diffArrays(js.tojs(blocks(old)), js.tojs(blocks(new)))
	local i = 1
	while i <= parts.length do
		local p = parts[i]
		local nextPart = (i < parts.length) and parts[i + 1] or nil
		if p.removed and nextPart and nextPart.added and p.value.length == nextPart.value.length then
			for k = 1, p.value.length do
				local before, after = p.value[k], nextPart.value[k]
				if isTable(before) and isTable(after) then
					tableDiff(before, after)
				elseif proposals.isCode(before) or proposals.isCode(after) then
					whole(before, after)
				else
					lineDiff(before, after)
				end
			end
			i = i + 2
		elseif p.removed and nextPart and nextPart.added then
			-- a different number of blocks (a paragraph split or joined, a
			-- block inserted among changed ones): line by line over the run
			local before, after, code = {}, {}, false
			for k = 1, p.value.length do
				table.insert(before, p.value[k])
				code = code or proposals.isCode(p.value[k])
			end
			for k = 1, nextPart.value.length do
				table.insert(after, nextPart.value[k])
				code = code or proposals.isCode(nextPart.value[k])
			end
			if code then
				for _, block in ipairs(before) do render(block, "-") end
				for _, block in ipairs(after) do render(block, "+") end
			else
				lineDiff(table.concat(before, "\n\n"), table.concat(after, "\n\n"))
			end
			i = i + 2
		else
			local kind = p.removed and "-" or (p.added and "+" or " ")
			for k = 1, p.value.length do render(p.value[k], kind) end
			i = i + 1
		end
	end
	return container
end

-----------------------------------------------------------------------
-- proposals.pageView(text)
--
-- A page that is to be deleted, formatted: its frontmatter as text,
-- its body rendered, behind a red bar.
-----------------------------------------------------------------------
function proposals.pageView(text)
	local container = dom.div { class = "proposals-formatted", style = "display:flex;flex-direction:column;gap:0.3em;" }
	local frontmatter, body = proposals.splitFrontmatter(text)
	if frontmatter ~= "" then
		container.appendChild(proposals.el("pre", { style = "margin:0 0.6em;padding:0.3em 0.6em;font-size:0.85em;white-space:pre-wrap;border-left:3px solid " .. proposals.colours.removedBar .. ";" }, frontmatter))
	end
	container.appendChild(proposals.rendered(body, "x"))
	return container
end

-----------------------------------------------------------------------
-- Package proposals (review)
--
-- What a person sees: ${proposals.list()} lists the open proposals;
-- each links to its review, the virtual page review:<name>, with the
-- diff, the position in the batch and Apply, Edit and Reject; Edit
-- opens a working copy of the target with the proposal applied, under
-- a bar with Accept, Revert to proposal, Preview and Reject. After
-- Apply, Accept or Reject the review goes on to the next proposal.
-----------------------------------------------------------------------

-----------------------------------------------------------------------
-- proposals.safeName(name)
--
-- Whether a name can be written into a wiki link as is: no brackets,
-- pipes, braces, dollars, angle brackets, backticks or line breaks,
-- which could end the link or start a directive or HTML, and no
-- leading URL scheme ("javascript:").
-----------------------------------------------------------------------
function proposals.safeName(name)
	if type(name) ~= "string" or name == "" then return false end
	if string.find(name, "^%a[%w+-]*:") then return false end
	return string.find(name, "[%[%]|{}%$<>`\r\n]") == nil
end

-----------------------------------------------------------------------
-- proposals.link(name)
--
-- A page name as a wiki link when that is safe, as an inert code span
-- otherwise (its fence one backtick longer than any run in the name).
-----------------------------------------------------------------------
function proposals.link(name)
	if proposals.safeName(name) then return "[[" .. name .. "]]" end
	local flat = string.gsub(tostring(name), "[\r\n]+", " ")
	local longest = 0
	for run in string.gmatch(flat, "`+") do
		if #run > longest then longest = #run end
	end
	local fence = string.rep("`", longest + 1)
	return fence .. " " .. flat .. " " .. fence
end

-----------------------------------------------------------------------
-- proposals.reviewPage(name)
--
-- The name of the virtual page that reviews a proposal.
-----------------------------------------------------------------------
function proposals.reviewPage(name)
	return "review:" .. name
end

-----------------------------------------------------------------------
-- proposals.open(page)
--
-- Shows a page (or virtual page) in the editor.
-----------------------------------------------------------------------
function proposals.open(page)
	editor.navigate({ kind = "page", page = page })
end

-----------------------------------------------------------------------
-- proposals.pageLink(name, label, style)
--
-- A link to a page (or virtual page) as a DOM node that navigates on
-- click; the label (default: the name) is a text node.
-----------------------------------------------------------------------
function proposals.pageLink(name, label, style)
	return proposals.el("a", {
		style = "cursor:pointer;" .. (style or ""),
		onclick = function() proposals.open(name) end
	}, label or name)
end

-----------------------------------------------------------------------
-- proposals.button(label, action, enabled)
--
-- A button as a DOM node; with `enabled` = false it is greyed out and
-- does nothing.
-----------------------------------------------------------------------
function proposals.button(label, action, enabled)
	local attributes = { onclick = action }
	if enabled == false then
		attributes = { disabled = "disabled", style = "opacity:0.4;cursor:default;" }
	end
	return proposals.el("button", attributes, label)
end

-----------------------------------------------------------------------
-- proposals.refresh()
--
-- Re-renders the widgets of the page shown, after an action changed
-- what they display.
-----------------------------------------------------------------------
function proposals.refresh()
	if codeWidget and codeWidget.refreshAll then codeWidget.refreshAll() end
end

-----------------------------------------------------------------------
-- proposals.goOn(name, group)
--
-- After a proposal is closed: opens the review of the next open one
-- (proposals.successor), or the page configured as `afterLast` when
-- none is left.
--
-- Returns:
--   The page it opened.
-----------------------------------------------------------------------
function proposals.goOn(name, group)
	local following = proposals.successor(name, group)
	return proposals.openNext(following)
end

-----------------------------------------------------------------------
-- proposals.goOnAnywhere()
--
-- Go on from a page that is no proposal of a known group: opens the
-- review of the first open proposal of the list, or `afterLast`.
-----------------------------------------------------------------------
function proposals.goOnAnywhere()
	local first = proposals.entries()[1]
	return proposals.openNext(first and first.name)
end

-- opens the review of `following`, or `afterLast` when it is nil
function proposals.openNext(following)
	local page = following and proposals.reviewPage(following) or proposals.config().afterLast
	proposals.open(page)
	return page
end

-----------------------------------------------------------------------
-- proposals.act(name, action)
--
-- Runs an action of the review (apply, accept, reject), which returns
-- true and the proposal, or false and the reason: goes on to the next
-- proposal, or says why not and redraws.
-----------------------------------------------------------------------
function proposals.act(name, action)
	local ok, result = action()
	if ok then
		proposals.goOn(name, result and result.group)
	else
		editor.flashNotification(name .. ": " .. tostring(result), "error")
		proposals.refresh()
	end
end

-----------------------------------------------------------------------
-- proposals.acceptShown(name)
--
-- Accept, from the review or from the bar of the working copy: takes
-- the editor's text when the working copy is the page shown, and asks
-- before accepting a copy whose base revision this browser does not
-- know. `expect` is the binding of what was shown (proposals.binding).
--
-- Returns:
--   What proposals.accept returns.
-----------------------------------------------------------------------
function proposals.acceptShown(name, expect)
	local text = nil
	if editor.getCurrentPage() == proposals.workingCopy(name) then
		editor.save()
		text = editor.getText()
	end
	local ok, result, kind = proposals.accept(name, text, false, expect)
	if not ok and kind == "unchecked" then
		if not editor.confirm(result .. ". Preview shows what Accept will change. Accept?") then
			return false, "not accepted"
		end
		ok, result = proposals.accept(name, text, true, expect)
	end
	return ok, result
end

-----------------------------------------------------------------------
-- proposals.revertShown(name)
--
-- Revert to proposal: builds the working copy again, after a
-- confirmation, and reloads it when it is the page shown. `expect` is
-- the binding of what was shown (proposals.binding).
-----------------------------------------------------------------------
function proposals.revertShown(name, expect)
	if not editor.confirm("Build the working copy again from the proposal? Your edits to it are lost.") then return end
	local shown = editor.getCurrentPage() == proposals.workingCopy(name)
	if shown then editor.save() end
	local copy, why = proposals.makeCopy(name, true, expect)
	if not copy then
		editor.flashNotification(name .. ": " .. tostring(why), "error")
	elseif shown then
		editor.reloadPage()
	end
	proposals.refresh()
end

-----------------------------------------------------------------------
-- proposals.linkingPages(target)
--
-- The pages that link to a page, without the proposals themselves
-- (each links to its target), by name.
-----------------------------------------------------------------------
function proposals.linkingPages(target)
	local own = {}
	local tag = proposals.tag
	for _, p in ipairs(query[[from p = index.tag(tag) where p.tag == "page" select p.name]]) do own[p] = true end
	local seen, out = {}, {}
	for _, page in ipairs(query[[from l = index.links() where l.toPage == target order by l.page select l.page]]) do
		if not seen[page] and not own[page] and page ~= target then
			seen[page] = true
			table.insert(out, page)
		end
	end
	return out
end

-----------------------------------------------------------------------
-- proposals.notice(text, colour)
--
-- A line of the review that says something about the proposal.
-----------------------------------------------------------------------
function proposals.notice(text, colour)
	return proposals.el("div", { class = "proposals-notice", style = "padding:0.5em 0.6em;margin-bottom:0.3em;background:" .. colour .. ";" }, text)
end

-----------------------------------------------------------------------
-- proposals.reviewView(name)
--
-- The review of one proposal as a DOM node. Its header holds Previous,
-- the position in the batch ("5 / 20": proposals already applied or
-- rejected still count) and Next, then the proposal (a link to its
-- page), target, action, group and state, and the buttons; its body
-- the reason and the change:
--
--   edit    the diff of the target as it is against the target with
--           the proposal applied, formatted or as text; Apply, Edit,
--           Reject. With a working copy the diff is against the copy,
--           and the buttons are Accept, Edit, Revert to proposal,
--           Reject.
--   delete  the page and the pages that link to it; Apply, Reject.
--   move    both names and the pages whose links are rewritten; Apply,
--           Reject.
--
-- A proposal that cannot be applied says why and can only be rejected.
-- Every button is bound to what the view shows (proposals.binding): if
-- the proposal or the page changed in the meantime, the action is
-- refused and the view drawn again.
-----------------------------------------------------------------------
function proposals.reviewView(name)
	local c = proposals.colours
	local container = dom.div { class = "proposals-review", style = "border:1px solid " .. c.border .. ";border-radius:6px;overflow:hidden;" }
	local bar = "display:flex;gap:0.5em;align-items:center;padding:0.4em 5em 0.4em 0.6em;background:" .. c.shade .. ";border-bottom:1px solid " .. c.border .. ";flex-wrap:wrap;"
	local navigation = dom.div { class = "proposals-navigation", style = bar }
	local header = dom.div { class = "proposals-header", style = bar }
	local body = dom.div { style = "padding:0.4em 0;" }
	container.appendChild(navigation)
	container.appendChild(header)
	container.appendChild(body)

	local proposal, err = proposals.read(name)
	-- a proposal closed here and deleted keeps its group in the record
	local record = not proposal and proposals.closedRecord(name) or nil
	local group
	if proposal then group = proposal.group elseif record then group = record.group end
	local batch = proposals.batch(name, group)
	local previous, following = proposals.neighbours(name, group, batch)
	navigation.appendChild(proposals.button("‹ Previous", function() proposals.open(proposals.reviewPage(previous)) end, previous ~= nil))
	navigation.appendChild(proposals.el("span", { class = "proposals-position", style = "font-variant-numeric:tabular-nums;" }, batch.index .. " / " .. #batch.names))
	navigation.appendChild(proposals.button("Next ›", function() proposals.open(proposals.reviewPage(following)) end, following ~= nil))
	if group then navigation.appendChild(proposals.el("span", { style = "opacity:0.7;" }, "group " .. group)) end

	if not proposal then
		local outcome = record and record.outcome
		local text = outcome and ("This proposal is " .. outcome .. ".") or ("This is not a proposal that can be reviewed: " .. tostring(err) .. ".")
		body.appendChild(proposals.notice(text, outcome and "transparent" or c.removedLine))
		header.appendChild(proposals.el("span", { style = "font-weight:bold;" }, name))
		header.appendChild(dom.span { style = "flex:1;" })
		header.appendChild(proposals.button("Go on", function()
			if record then proposals.goOn(name, record.group) else proposals.goOnAnywhere() end
		end))
		if not outcome and proposals.rejectable(name) then
			header.appendChild(proposals.button("Reject", function()
				proposals.act(name, function() return proposals.reject(name) end)
			end))
		end
		return container
	end

	local result = proposals.evaluate(proposal)
	local expect = proposals.binding(proposal, result)
	local state = result.state
	if proposal.outcome ~= "open" then state = proposal.outcome elseif result.edited then state = "edited" end
	header.appendChild(proposals.pageLink(name, name, "font-weight:bold;"))
	local info = proposals.el("span", { style = "opacity:0.7;" }, "→ ")
	info.appendChild(proposals.pageLink(proposal.target))
	info.appendChild(js.window.document.createTextNode(" · " .. proposal.action .. " · " .. state))
	header.appendChild(info)
	header.appendChild(dom.span { style = "flex:1;" })

	if proposal.reason ~= "" then
		body.appendChild(proposals.el("div", { class = "proposals-reason", style = "padding:0.2em 0.6em 0.6em 0.6em;white-space:pre-wrap;opacity:0.85;" }, proposal.reason))
	end

	-- the two views and the buttons that switch between them; the text
	-- view first when the page holds HTML, which the formatted view
	-- shows only in part (proposals.sanitize)
	local function addViews(formattedView, textView, html)
		local formattedButton, textButton
		local function show(which)
			formattedView.style.display = (which == "formatted") and "flex" or "none"
			textView.style.display = (which == "text") and "" or "none"
			formattedButton.style.fontWeight = (which == "formatted") and "bold" or "normal"
			textButton.style.fontWeight = (which == "text") and "bold" or "normal"
		end
		formattedButton = proposals.button("Formatted", function() show("formatted") end)
		textButton = proposals.button("Text", function() show("text") end)
		header.appendChild(formattedButton)
		header.appendChild(textButton)
		body.appendChild(formattedView)
		body.appendChild(textView)
		show(html and "text" or "formatted")
	end

	local function addLinking(caption)
		local pages = proposals.linkingPages(proposal.target)
		local line = proposals.el("div", { class = "proposals-linking", style = "padding:0.2em 0.6em 0.6em 0.6em;" },
			#pages == 0 and "No page links to it." or (caption .. " "))
		for i, page in ipairs(pages) do
			if i > 1 then line.appendChild(js.window.document.createTextNode(", ")) end
			line.appendChild(proposals.pageLink(page))
		end
		body.appendChild(line)
	end

	local function addChange()
		if proposal.action == "edit" then
			if result.new then
				addViews(proposals.formattedDiff(result.old, result.new), proposals.textDiff(result.old, result.new), proposals.holdsHtml(result.new))
			end
		elseif proposal.action == "delete" then
			body.appendChild(proposals.notice("Deletes the page " .. proposal.target .. ".", c.removedLine))
			if result.old then
				addLinking("Pages that link to it:")
				addViews(proposals.pageView(result.old), proposals.el("pre", { style = "margin:0;padding:0 0.6em;font-size:0.85em;white-space:pre-wrap;" }, result.old), proposals.holdsHtml(result.old))
			end
		else
			body.appendChild(proposals.notice("Moves the page " .. proposal.target .. " to " .. proposal.to .. ".", c.addedLine))
			if result.old then addLinking("Pages whose links are rewritten:") end
		end
	end

	local function reject()
		proposals.act(name, function() return proposals.reject(name) end)
	end

	if proposal.outcome ~= "open" then
		body.appendChild(proposals.notice("This proposal is " .. proposal.outcome .. "; nothing to do.", "transparent"))
		header.appendChild(proposals.button("Go on", function() proposals.goOn(name, group) end))
		return container
	end

	if result.state == "stale" then
		body.appendChild(proposals.notice("Cannot be applied: " .. tostring(result.why) .. ".", c.removedLine))
		addChange()
		header.appendChild(proposals.button("Reject", reject))
		return container
	end

	if result.edited then
		body.appendChild(proposals.notice("You edited this proposal: the change shown is your working copy against the page.", c.warning))
	elseif result.changed and proposal.action ~= "edit" then
		body.appendChild(proposals.notice("The page changed after this proposal was written. Look at it before you apply.", c.warning))
	end
	addChange()
	if result.edited then
		header.appendChild(proposals.button("Accept", function()
			proposals.act(name, function() return proposals.acceptShown(name, expect) end)
		end))
		header.appendChild(proposals.button("Edit", function() proposals.open(proposals.workingCopy(name)) end))
		header.appendChild(proposals.button("Revert to proposal", function() proposals.revertShown(name, expect) end))
	else
		header.appendChild(proposals.button("Apply", function()
			proposals.act(name, function() return proposals.apply(name, { changed = true, expect = expect }) end)
		end))
		if proposal.action == "edit" then
			header.appendChild(proposals.button("Edit", function()
				local copy, why = proposals.makeCopy(name, false, expect)
				if copy then
					proposals.open(copy)
				else
					editor.flashNotification(name .. ": " .. tostring(why), "error")
					proposals.refresh()
				end
			end))
		end
	end
	header.appendChild(proposals.button("Reject", reject))
	return container
end

-----------------------------------------------------------------------
-- proposals.review(name)
--
-- The review of one proposal as a block widget, for the virtual page
-- review:<name>: without `name`, it takes the name from the page shown.
--
-- Returns:
--   A block widget.
-----------------------------------------------------------------------
function proposals.review(name)
	if name == nil then
		name = string.match(editor.getCurrentPage() or "", "^review:(.+)$")
	end
	if not name then return widget.markdownBlock("*No proposal named.*") end
	return widget.new { html = proposals.reviewView(name), display = "block" }
end

-----------------------------------------------------------------------
-- proposals.reviewPageText(name)
--
-- The markdown of the virtual page review:<name>: a heading that links
-- to the proposal page, and the review widget. The name goes in
-- through proposals.link, so a name that could break a link is shown
-- as a code span; the widget takes the name from the page shown, not
-- from the markdown.
-----------------------------------------------------------------------
function proposals.reviewPageText(name)
	return "# Review of " .. proposals.link(name) .. "\n\n${proposals.review()}\n"
end

virtualPage.define {
	pattern = "^review:(.+)$",
	run = function(name)
		return proposals.reviewPageText(name)
	end
}

-----------------------------------------------------------------------
-- proposals.applyMany(names, expects)
--
-- Applies several proposals one after the other, each as
-- proposals.apply does without `changed`: a stale one, one with a
-- working copy, and a delete or move of a page that changed since are
-- left for their own review. `expects` holds the binding of each name
-- as it was listed; one that changed since is left out too, and one
-- without a binding (it could not be read when listed) is not applied.
--
-- Returns:
--   The number applied, and a list of "name (reason)" for the others.
-----------------------------------------------------------------------
function proposals.applyMany(names, expects)
	local applied, failed = 0, {}
	for _, name in ipairs(names) do
		local expect = expects and expects[name]
		local ok, why = false, "could not be read when listed"
		if expect then ok, why = proposals.apply(name, { expect = expect }) end
		if ok then
			applied = applied + 1
		else
			table.insert(failed, name .. " (" .. tostring(why) .. ")")
		end
	end
	return applied, failed
end

-----------------------------------------------------------------------
-- proposals.applyAsked(names, expects)
--
-- "Apply all" and "Apply group": one confirmation that names the
-- target pages as the list showed them (`expects`, the binding of each
-- listed proposal that could be read), then proposals.applyMany on
-- those, a notification with the result, and the list redrawn. The
-- names without a binding are not applied, only reported.
-----------------------------------------------------------------------
function proposals.applyAsked(names, expects)
	local bound, unbound, targets, seen = {}, {}, {}, {}
	for _, name in ipairs(names) do
		local expect = expects[name]
		if expect then
			table.insert(bound, name)
			if not seen[expect.target] then
				seen[expect.target] = true
				table.insert(targets, expect.target)
			end
		else
			table.insert(unbound, name .. " (could not be read when listed)")
		end
	end
	local applied, failed = 0, {}
	if #bound > 0 then
		if not editor.confirm("Apply " .. #bound .. " proposal(s) to: " .. table.concat(targets, ", ") .. "?") then return end
		applied, failed = proposals.applyMany(bound, expects)
	end
	for _, line in ipairs(unbound) do table.insert(failed, line) end
	local message = applied .. " applied"
	if #failed > 0 then message = message .. "; not applied: " .. table.concat(failed, "; ") end
	editor.flashNotification(message, #failed > 0 and "error" or "info")
	proposals.refresh()
end

-----------------------------------------------------------------------
-- proposals.list(target)
--
-- The list of open proposals: ${proposals.list()} lists every one,
-- ${proposals.list("Some/Page")} only those for that page. One row per
-- proposal, linking to its review (review:<name>) and to its target,
-- with its action and state, under a row per group. "Apply all"
-- applies every listed proposal and "Apply group" those of one group,
-- after a confirmation that names the target pages; each only while it
-- is the proposal the list showed. A row that could not be read is
-- never applied this way, even when it can be read by then.
--
-- Returns:
--   A block widget.
-----------------------------------------------------------------------
function proposals.list(target)
	local entries = proposals.entries(target)
	if #entries == 0 then
		return widget.markdownBlock("*No open proposals.*")
	end
	local c = proposals.colours
	local container = dom.div { class = "proposals-list", style = "display:flex;flex-direction:column;gap:0.5em;" }
	local top = dom.div { style = "display:flex;gap:0.5em;align-items:center;padding-right:5em;" }
	local all, read, expects = {}, {}, {}
	for _, entry in ipairs(entries) do
		table.insert(all, entry.name)
		local proposal, err = proposals.read(entry.name)
		read[entry.name] = { proposal = proposal, err = err }
		if proposal then expects[entry.name] = proposals.binding(proposal) end
	end
	top.appendChild(proposals.el("span", { style = "opacity:0.7;" }, #entries .. " open proposal" .. (#entries == 1 and "" or "s")))
	top.appendChild(proposals.button("Apply all", function() proposals.applyAsked(all, expects) end))
	container.appendChild(top)

	local th = "text-align:left;padding:0.2em 1em 0.2em 0;border-bottom:1px solid " .. c.border .. ";font-weight:bold;"
	local td = "padding:0.25em 1em 0.25em 0;vertical-align:top;"
	local tbl = dom.table { style = "border-collapse:collapse;" }
	local head = dom.tr {}
	for _, label in ipairs({ "Proposal", "Target", "Action", "State" }) do
		head.appendChild(proposals.el("th", { style = th }, label))
	end
	tbl.appendChild(head)

	local current = false
	for i, entry in ipairs(entries) do
		if current == false or entry.group ~= current then
			current = entry.group
			local members = {}
			for _, other in ipairs(entries) do
				if other.group == current then table.insert(members, other.name) end
			end
			local row = dom.tr { class = "proposals-group" }
			local cell = proposals.el("td", { colspan = "4", style = "padding:0.6em 1em 0.2em 0;font-weight:bold;" },
				(current and ("Group " .. current) or "No group") .. " (" .. #members .. ") ")
			cell.appendChild(proposals.button("Apply group", function() proposals.applyAsked(members, expects) end))
			row.appendChild(cell)
			tbl.appendChild(row)
		end
		local proposal, err = read[entry.name].proposal, read[entry.name].err
		local tr = dom.tr { class = "proposals-entry" }
		local first = dom.td { style = td }
		first.appendChild(proposals.pageLink(proposals.reviewPage(entry.name), entry.name))
		tr.appendChild(first)
		if proposal then
			local result = proposals.evaluate(proposal)
			local state = result.state
			if result.edited then
				state = "edited"
			elseif state == "open" and result.changed and proposal.action ~= "edit" then
				state = "open, page changed"
			end
			local targetCell = dom.td { style = td }
			targetCell.appendChild(proposals.pageLink(proposal.target))
			if proposal.action == "move" then
				targetCell.appendChild(js.window.document.createTextNode(" → " .. proposal.to))
			end
			tr.appendChild(targetCell)
			tr.appendChild(proposals.el("td", { style = td }, proposal.action))
			tr.appendChild(proposals.el("td", { style = td }, state))
		else
			tr.appendChild(proposals.el("td", { style = td, colspan = "3" }, "cannot be read: " .. tostring(err)))
		end
		tbl.appendChild(tr)
	end
	container.appendChild(tbl)
	return widget.new { html = container, display = "block" }
end

-----------------------------------------------------------------------
-- proposals.barView(name)
--
-- The bar above a working copy as a DOM node: what the page is, and
-- Accept (write it to the target), Revert to proposal (build it
-- again), Preview (the review, whose diff is then the working copy
-- against the target) and Reject.
-----------------------------------------------------------------------
function proposals.barView(name)
	local c = proposals.colours
	local container = dom.div { class = "proposals-bar", style = "display:flex;gap:0.5em;align-items:center;flex-wrap:wrap;padding:0.4em 0.6em;background:" .. c.warning .. ";border-radius:6px;" }
	local proposal = proposals.read(name)
	local expect = proposal and proposals.binding(proposal)
	local label = proposals.el("span", {}, "Working copy of ")
	if proposal then
		label.appendChild(proposals.pageLink(proposal.target))
		label.appendChild(js.window.document.createTextNode(" with the proposal "))
	else
		label.appendChild(js.window.document.createTextNode("the proposal "))
	end
	label.appendChild(proposals.pageLink(name))
	label.appendChild(js.window.document.createTextNode(proposal and ". Edit it, then accept." or ", which is gone."))
	container.appendChild(label)
	container.appendChild(dom.span { style = "flex:1;" })
	if not proposal then return container end
	container.appendChild(proposals.button("Accept", function()
		proposals.act(name, function() return proposals.acceptShown(name, expect) end)
	end))
	container.appendChild(proposals.button("Revert to proposal", function() proposals.revertShown(name, expect) end))
	container.appendChild(proposals.button("Preview", function()
		editor.save()
		proposals.open(proposals.reviewPage(name))
	end))
	container.appendChild(proposals.button("Reject", function()
		proposals.act(name, function() return proposals.reject(name) end)
	end))
	return container
end

-----------------------------------------------------------------------
-- The bar above the working copies: a view docked at the top of the
-- page, which renders nothing on any page outside the folder of the
-- working copies.
-----------------------------------------------------------------------
view.define {
	name = "proposals.workingCopy",
	title = "Change proposal",
	dock = "page-top",
	supportedDocks = { "page-top" },
	defaultOpen = true,
	refreshOn = { "navigate" },
	refreshOnOpen = true,
	content = function()
		local name = proposals.proposalOf(editor.getCurrentPage())
		if not name then return "" end
		return widget.new { html = proposals.barView(name), display = "block" }
	end
}

-----------------------------------------------------------------------
-- proposals.jsdiffSource
--
-- jsdiff 9.0.0 (https://github.com/kpdecker/jsdiff), BSD-3-Clause,
-- Copyright (c) 2009-2015, Kevin Decker; licence in
-- library/vendor/jsdiff-LICENSE of the repository. Its ES module
-- bundle, minified with esbuild, base64-encoded: SilverBullet's Lua
-- cannot hold the minified code in a long string. Imported from a
-- data: URL by proposals.jsdiff().
-----------------------------------------------------------------------
proposals.jsdiffSource = "dmFyIEM9Y2xhc3N7ZGlmZihlLHQsaT17fSl7bGV0IHI7dHlwZW9mIGk9PSJmdW5jdGlvbiI/KHI9aSxpPXt9KToiY2FsbGJhY2siaW4gaSYmKHI9aS5jYWxsYmFjayk7bGV0IGw9dGhpcy5jYXN0SW5wdXQoZSxpKSxvPXRoaXMuY2FzdElucHV0KHQsaSksbT10aGlzLnJlbW92ZUVtcHR5KHRoaXMudG9rZW5pemUobCxpKSksZD10aGlzLnJlbW92ZUVtcHR5KHRoaXMudG9rZW5pemUobyxpKSk7cmV0dXJuIHRoaXMuZGlmZldpdGhPcHRpb25zT2JqKG0sZCxpLHIpfWRpZmZXaXRoT3B0aW9uc09iaihlLHQsaSxyKXt2YXIgbDtsZXQgbz11PT57aWYodT10aGlzLnBvc3RQcm9jZXNzKHUsaSkscil7c2V0VGltZW91dChmdW5jdGlvbigpe3IodSl9LDApO3JldHVybn1lbHNlIHJldHVybiB1fSxtPXQubGVuZ3RoLGQ9ZS5sZW5ndGgsdz0xLGc9bStkO2kubWF4RWRpdExlbmd0aCE9bnVsbCYmKGc9TWF0aC5taW4oZyxpLm1heEVkaXRMZW5ndGgpKTtsZXQgeD0obD1pLnRpbWVvdXQpIT09bnVsbCYmbCE9PXZvaWQgMD9sOjEvMCxGPURhdGUubm93KCkreCx5PVt7b2xkUG9zOi0xLGxhc3RDb21wb25lbnQ6dm9pZCAwfV0sZj10aGlzLmV4dHJhY3RDb21tb24oeVswXSx0LGUsMCxpKTtpZih5WzBdLm9sZFBvcysxPj1kJiZmKzE+PW0pcmV0dXJuIG8odGhpcy5idWlsZFZhbHVlcyh5WzBdLmxhc3RDb21wb25lbnQsdCxlKSk7bGV0IHM9LTEvMCxjPTEvMCxoPSgpPT57Zm9yKGxldCB1PU1hdGgubWF4KHMsLXcpO3U8PU1hdGgubWluKGMsdyk7dSs9Mil7bGV0IGEscD15W3UtMV0sdj15W3UrMV07cCYmKHlbdS0xXT12b2lkIDApO2xldCBXPSExO2lmKHYpe2xldCBiPXYub2xkUG9zLXU7Vz12JiYwPD1iJiZiPG19bGV0IE49cCYmcC5vbGRQb3MrMTxkO2lmKCFXJiYhTil7eVt1XT12b2lkIDA7Y29udGludWV9aWYoIU58fFcmJnAub2xkUG9zPHYub2xkUG9zP2E9dGhpcy5hZGRUb1BhdGgodiwhMCwhMSwwLGkpOmE9dGhpcy5hZGRUb1BhdGgocCwhMSwhMCwxLGkpLGY9dGhpcy5leHRyYWN0Q29tbW9uKGEsdCxlLHUsaSksYS5vbGRQb3MrMT49ZCYmZisxPj1tKXJldHVybiBvKHRoaXMuYnVpbGRWYWx1ZXMoYS5sYXN0Q29tcG9uZW50LHQsZSkpfHwhMDt5W3VdPWEsYS5vbGRQb3MrMT49ZCYmKGM9TWF0aC5taW4oYyx1LTEpKSxmKzE+PW0mJihzPU1hdGgubWF4KHMsdSsxKSl9dysrfTtpZihyKShmdW5jdGlvbiB1KCl7c2V0VGltZW91dChmdW5jdGlvbigpe2lmKHc+Z3x8RGF0ZS5ub3coKT5GKXJldHVybiByKHZvaWQgMCk7aCgpfHx1KCl9LDApfSkoKTtlbHNlIGZvcig7dzw9ZyYmRGF0ZS5ub3coKTw9Rjspe2xldCB1PWgoKTtpZih1KXJldHVybiB1fX1hZGRUb1BhdGgoZSx0LGkscixsKXtsZXQgbz1lLmxhc3RDb21wb25lbnQ7cmV0dXJuIG8mJiFsLm9uZUNoYW5nZVBlclRva2VuJiZvLmFkZGVkPT09dCYmby5yZW1vdmVkPT09aT97b2xkUG9zOmUub2xkUG9zK3IsbGFzdENvbXBvbmVudDp7Y291bnQ6by5jb3VudCsxLGFkZGVkOnQscmVtb3ZlZDppLHByZXZpb3VzQ29tcG9uZW50Om8ucHJldmlvdXNDb21wb25lbnR9fTp7b2xkUG9zOmUub2xkUG9zK3IsbGFzdENvbXBvbmVudDp7Y291bnQ6MSxhZGRlZDp0LHJlbW92ZWQ6aSxwcmV2aW91c0NvbXBvbmVudDpvfX19ZXh0cmFjdENvbW1vbihlLHQsaSxyLGwpe2xldCBvPXQubGVuZ3RoLG09aS5sZW5ndGgsZD1lLm9sZFBvcyx3PWQtcixnPTA7Zm9yKDt3KzE8byYmZCsxPG0mJnRoaXMuZXF1YWxzKGlbZCsxXSx0W3crMV0sbCk7KXcrKyxkKyssZysrLGwub25lQ2hhbmdlUGVyVG9rZW4mJihlLmxhc3RDb21wb25lbnQ9e2NvdW50OjEscHJldmlvdXNDb21wb25lbnQ6ZS5sYXN0Q29tcG9uZW50LGFkZGVkOiExLHJlbW92ZWQ6ITF9KTtyZXR1cm4gZyYmIWwub25lQ2hhbmdlUGVyVG9rZW4mJihlLmxhc3RDb21wb25lbnQ9e2NvdW50OmcscHJldmlvdXNDb21wb25lbnQ6ZS5sYXN0Q29tcG9uZW50LGFkZGVkOiExLHJlbW92ZWQ6ITF9KSxlLm9sZFBvcz1kLHd9ZXF1YWxzKGUsdCxpKXtyZXR1cm4gaS5jb21wYXJhdG9yP2kuY29tcGFyYXRvcihlLHQpOmU9PT10fHwhIWkuaWdub3JlQ2FzZSYmZS50b0xvd2VyQ2FzZSgpPT09dC50b0xvd2VyQ2FzZSgpfXJlbW92ZUVtcHR5KGUpe2xldCB0PVtdO2ZvcihsZXQgaT0wO2k8ZS5sZW5ndGg7aSsrKWVbaV0mJnQucHVzaChlW2ldKTtyZXR1cm4gdH1jYXN0SW5wdXQoZSx0KXtyZXR1cm4gZX10b2tlbml6ZShlLHQpe3JldHVybiBBcnJheS5mcm9tKGUpfWpvaW4oZSl7cmV0dXJuIGUuam9pbigiIil9cG9zdFByb2Nlc3MoZSx0KXtyZXR1cm4gZX1nZXQgdXNlTG9uZ2VzdFRva2VuKCl7cmV0dXJuITF9YnVpbGRWYWx1ZXMoZSx0LGkpe2xldCByPVtdLGw7Zm9yKDtlOylyLnB1c2goZSksbD1lLnByZXZpb3VzQ29tcG9uZW50LGRlbGV0ZSBlLnByZXZpb3VzQ29tcG9uZW50LGU9bDtyLnJldmVyc2UoKTtsZXQgbz1yLmxlbmd0aCxtPTAsZD0wLHc9MDtmb3IoO208bzttKyspe2xldCBnPXJbbV07aWYoZy5yZW1vdmVkKWcudmFsdWU9dGhpcy5qb2luKGkuc2xpY2Uodyx3K2cuY291bnQpKSx3Kz1nLmNvdW50O2Vsc2V7aWYoIWcuYWRkZWQmJnRoaXMudXNlTG9uZ2VzdFRva2VuKXtsZXQgeD10LnNsaWNlKGQsZCtnLmNvdW50KTt4PXgubWFwKGZ1bmN0aW9uKEYseSl7bGV0IGY9aVt3K3ldO3JldHVybiBmLmxlbmd0aD5GLmxlbmd0aD9mOkZ9KSxnLnZhbHVlPXRoaXMuam9pbih4KX1lbHNlIGcudmFsdWU9dGhpcy5qb2luKHQuc2xpY2UoZCxkK2cuY291bnQpKTtkKz1nLmNvdW50LGcuYWRkZWR8fCh3Kz1nLmNvdW50KX19cmV0dXJuIHJ9fTt2YXIgUj1jbGFzcyBleHRlbmRzIEN7fSxvZT1uZXcgUjtmdW5jdGlvbiBiZShuLGUsdCl7cmV0dXJuIG9lLmRpZmYobixlLHQpfWZ1bmN0aW9uIF8obixlKXtsZXQgdDtmb3IodD0wO3Q8bi5sZW5ndGgmJnQ8ZS5sZW5ndGg7dCsrKWlmKG5bdF0hPWVbdF0pcmV0dXJuIG4uc2xpY2UoMCx0KTtyZXR1cm4gbi5zbGljZSgwLHQpfWZ1bmN0aW9uICQobixlKXtsZXQgdDtpZighbnx8IWV8fG5bbi5sZW5ndGgtMV0hPWVbZS5sZW5ndGgtMV0pcmV0dXJuIiI7Zm9yKHQ9MDt0PG4ubGVuZ3RoJiZ0PGUubGVuZ3RoO3QrKylpZihuW24ubGVuZ3RoLSh0KzEpXSE9ZVtlLmxlbmd0aC0odCsxKV0pcmV0dXJuIG4uc2xpY2UoLXQpO3JldHVybiBuLnNsaWNlKC10KX1mdW5jdGlvbiBNKG4sZSx0KXtpZihuLnNsaWNlKDAsZS5sZW5ndGgpIT1lKXRocm93IEVycm9yKGBzdHJpbmcgJHtKU09OLnN0cmluZ2lmeShuKX0gZG9lc24ndCBzdGFydCB3aXRoIHByZWZpeCAke0pTT04uc3RyaW5naWZ5KGUpfTsgdGhpcyBpcyBhIGJ1Z2ApO3JldHVybiB0K24uc2xpY2UoZS5sZW5ndGgpfWZ1bmN0aW9uIEgobixlLHQpe2lmKCFlKXJldHVybiBuK3Q7aWYobi5zbGljZSgtZS5sZW5ndGgpIT1lKXRocm93IEVycm9yKGBzdHJpbmcgJHtKU09OLnN0cmluZ2lmeShuKX0gZG9lc24ndCBlbmQgd2l0aCBzdWZmaXggJHtKU09OLnN0cmluZ2lmeShlKX07IHRoaXMgaXMgYSBidWdgKTtyZXR1cm4gbi5zbGljZSgwLC1lLmxlbmd0aCkrdH1mdW5jdGlvbiBTKG4sZSl7cmV0dXJuIE0obixlLCIiKX1mdW5jdGlvbiBEKG4sZSl7cmV0dXJuIEgobixlLCIiKX1mdW5jdGlvbiBVKG4sZSl7cmV0dXJuIGUuc2xpY2UoMCxFZShuLGUpKX1mdW5jdGlvbiBFZShuLGUpe2xldCB0PTA7bi5sZW5ndGg+ZS5sZW5ndGgmJih0PW4ubGVuZ3RoLWUubGVuZ3RoKTtsZXQgaT1lLmxlbmd0aDtuLmxlbmd0aDxlLmxlbmd0aCYmKGk9bi5sZW5ndGgpO2xldCByPUFycmF5KGkpLGw9MDtyWzBdPTA7Zm9yKGxldCBvPTE7bzxpO28rKyl7Zm9yKGVbb109PWVbbF0/cltvXT1yW2xdOnJbb109bDtsPjAmJmVbb10hPWVbbF07KWw9cltsXTtlW29dPT1lW2xdJiZsKyt9bD0wO2ZvcihsZXQgbz10O288bi5sZW5ndGg7bysrKXtmb3IoO2w+MCYmbltvXSE9ZVtsXTspbD1yW2xdO25bb109PWVbbF0mJmwrK31yZXR1cm4gbH1mdW5jdGlvbiBzZShuKXtyZXR1cm4gbi5pbmNsdWRlcyhgXHIKYCkmJiFuLnN0YXJ0c1dpdGgoYApgKSYmIW4ubWF0Y2goL1teXHJdXG4vKX1mdW5jdGlvbiBmZShuKXtyZXR1cm4hbi5pbmNsdWRlcyhgXHIKYCkmJm4uaW5jbHVkZXMoYApgKX1mdW5jdGlvbiBxKG4sZSl7bGV0IHQ9W107Zm9yKGxldCBpIG9mIEFycmF5LmZyb20oZS5zZWdtZW50KG4pKSl7bGV0IHI9aS5zZWdtZW50O3QubGVuZ3RoJiYvXHMvLnRlc3QodFt0Lmxlbmd0aC0xXSkmJi9ccy8udGVzdChyKT90W3QubGVuZ3RoLTFdKz1yOnQucHVzaChyKX1yZXR1cm4gdH1mdW5jdGlvbiBQKG4sZSl7aWYoZSlyZXR1cm4gTChuLGUpWzFdO2xldCB0O2Zvcih0PW4ubGVuZ3RoLTE7dD49MCYmblt0XS5tYXRjaCgvXHMvKTt0LS0pO3JldHVybiBuLnN1YnN0cmluZyh0KzEpfWZ1bmN0aW9uIE8obixlKXtpZihlKXJldHVybiBMKG4sZSlbMF07bGV0IHQ9bi5tYXRjaCgvXlxzKi8pO3JldHVybiB0P3RbMF06IiJ9ZnVuY3Rpb24gTChuLGUpe2lmKCFlKXJldHVybltPKG4pLFAobildO2lmKGUucmVzb2x2ZWRPcHRpb25zKCkuZ3JhbnVsYXJpdHkhPSJ3b3JkIil0aHJvdyBuZXcgRXJyb3IoJ1RoZSBzZWdtZW50ZXIgcGFzc2VkIG11c3QgaGF2ZSBhIGdyYW51bGFyaXR5IG9mICJ3b3JkIicpO2xldCB0PXEobixlKSxpPXRbMF0scj10W3QubGVuZ3RoLTFdLGw9L1xzLy50ZXN0KGkpP2k6IiIsbz0vXHMvLnRlc3Qocik/cjoiIjtyZXR1cm5bbCxvXX12YXIgVD0iYS16QS1aMC05X1xcdXtBRH1cXHV7QzB9LVxcdXtENn1cXHV7RDh9LVxcdXtGNn1cXHV7Rjh9LVxcdXsyQzZ9XFx1ezJDOH0tXFx1ezJEN31cXHV7MkRFfS1cXHV7MkZGfVxcdXsxRTAwfS1cXHV7MUVGRn0iLE9lPW5ldyBSZWdFeHAoYFske1R9XSt8XFxzK3xbXiR7VH1dYCwidWciKSxHPWNsYXNzIGV4dGVuZHMgQ3tlcXVhbHMoZSx0LGkpe3JldHVybiBpLmlnbm9yZUNhc2UmJihlPWUudG9Mb3dlckNhc2UoKSx0PXQudG9Mb3dlckNhc2UoKSksZS50cmltKCk9PT10LnRyaW0oKX10b2tlbml6ZShlLHQ9e30pe2xldCBpO2lmKHQuaW50bFNlZ21lbnRlcil7bGV0IG89dC5pbnRsU2VnbWVudGVyO2lmKG8ucmVzb2x2ZWRPcHRpb25zKCkuZ3JhbnVsYXJpdHkhPSJ3b3JkIil0aHJvdyBuZXcgRXJyb3IoJ1RoZSBzZWdtZW50ZXIgcGFzc2VkIG11c3QgaGF2ZSBhIGdyYW51bGFyaXR5IG9mICJ3b3JkIicpO2k9cShlLG8pfWVsc2UgaT1lLm1hdGNoKE9lKXx8W107bGV0IHI9W10sbD1udWxsO3JldHVybiBpLmZvckVhY2gobz0+ey9ccy8udGVzdChvKT9sPT1udWxsP3IucHVzaChvKTpyLnB1c2goci5wb3AoKStvKTpsIT1udWxsJiYvXHMvLnRlc3QobCk/cltyLmxlbmd0aC0xXT09bD9yLnB1c2goci5wb3AoKStvKTpyLnB1c2gobCtvKTpyLnB1c2gobyksbD1vfSkscn1qb2luKGUpe3JldHVybiBlLm1hcCgodCxpKT0+aT09MD90OnQucmVwbGFjZSgvXlxzKy8sIiIpKS5qb2luKCIiKX1wb3N0UHJvY2VzcyhlLHQpe2lmKCFlfHx0Lm9uZUNoYW5nZVBlclRva2VuKXJldHVybiBlO2xldCBpPW51bGwscj1udWxsLGw9bnVsbDtyZXR1cm4gZS5mb3JFYWNoKG89PntvLmFkZGVkP3I9bzpvLnJlbW92ZWQ/bD1vOigocnx8bCkmJnVlKGksbCxyLG8sdC5pbnRsU2VnbWVudGVyKSxpPW8scj1udWxsLGw9bnVsbCl9KSwocnx8bCkmJnVlKGksbCxyLG51bGwsdC5pbnRsU2VnbWVudGVyKSxlfX0sYWU9bmV3IEc7ZnVuY3Rpb24ga2UobixlLHQpe3JldHVybiB0Py5pZ25vcmVXaGl0ZXNwYWNlIT1udWxsJiYhdC5pZ25vcmVXaGl0ZXNwYWNlP2NlKG4sZSx0KTphZS5kaWZmKG4sZSx0KX1mdW5jdGlvbiB1ZShuLGUsdCxpLHIpe2lmKGUmJnQpe2xldFtsLG9dPUwoZS52YWx1ZSxyKSxbbSxkXT1MKHQudmFsdWUscik7aWYobil7bGV0IHc9XyhsLG0pO24udmFsdWU9SChuLnZhbHVlLG0sdyksZS52YWx1ZT1TKGUudmFsdWUsdyksdC52YWx1ZT1TKHQudmFsdWUsdyl9aWYoaSl7bGV0IHc9JChvLGQpO2kudmFsdWU9TShpLnZhbHVlLGQsdyksZS52YWx1ZT1EKGUudmFsdWUsdyksdC52YWx1ZT1EKHQudmFsdWUsdyl9fWVsc2UgaWYodCl7aWYobil7bGV0IGw9Tyh0LnZhbHVlLHIpO3QudmFsdWU9dC52YWx1ZS5zdWJzdHJpbmcobC5sZW5ndGgpfWlmKGkpe2xldCBsPU8oaS52YWx1ZSxyKTtpLnZhbHVlPWkudmFsdWUuc3Vic3RyaW5nKGwubGVuZ3RoKX19ZWxzZSBpZihuJiZpKXtsZXQgbD1PKGkudmFsdWUsciksW28sbV09TChlLnZhbHVlLHIpLGQ9XyhsLG8pO2UudmFsdWU9UyhlLnZhbHVlLGQpO2xldCB3PSQoUyhsLGQpLG0pO2UudmFsdWU9RChlLnZhbHVlLHcpLGkudmFsdWU9TShpLnZhbHVlLGwsdyksbi52YWx1ZT1IKG4udmFsdWUsbCxsLnNsaWNlKDAsbC5sZW5ndGgtdy5sZW5ndGgpKX1lbHNlIGlmKGkpe2xldCBsPU8oaS52YWx1ZSxyKSxvPVAoZS52YWx1ZSxyKSxtPVUobyxsKTtlLnZhbHVlPUQoZS52YWx1ZSxtKX1lbHNlIGlmKG4pe2xldCBsPVAobi52YWx1ZSxyKSxvPU8oZS52YWx1ZSxyKSxtPVUobCxvKTtlLnZhbHVlPVMoZS52YWx1ZSxtKX19dmFyIEo9Y2xhc3MgZXh0ZW5kcyBDe3Rva2VuaXplKGUpe2xldCB0PW5ldyBSZWdFeHAoYChcXHI/XFxuKXxbJHtUfV0rfFteXFxTXFxuXFxyXSt8W14ke1R9XWAsInVnIik7cmV0dXJuIGUubWF0Y2godCl8fFtdfX0sZGU9bmV3IEo7ZnVuY3Rpb24gY2UobixlLHQpe3JldHVybiBkZS5kaWZmKG4sZSx0KX1mdW5jdGlvbiBtZShuLGUpe2lmKHR5cGVvZiBuPT0iZnVuY3Rpb24iKWUuY2FsbGJhY2s9bjtlbHNlIGlmKG4pZm9yKGxldCB0IGluIG4pT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG4sdCkmJihlW3RdPW5bdF0pO3JldHVybiBlfXZhciBWPWNsYXNzIGV4dGVuZHMgQ3tjb25zdHJ1Y3Rvcigpe3N1cGVyKC4uLmFyZ3VtZW50cyksdGhpcy50b2tlbml6ZT1RfWVxdWFscyhlLHQsaSl7cmV0dXJuIGkuaWdub3JlV2hpdGVzcGFjZT8oKCFpLm5ld2xpbmVJc1Rva2VufHwhZS5pbmNsdWRlcyhgCmApKSYmKGU9ZS50cmltKCkpLCghaS5uZXdsaW5lSXNUb2tlbnx8IXQuaW5jbHVkZXMoYApgKSkmJih0PXQudHJpbSgpKSk6aS5pZ25vcmVOZXdsaW5lQXRFb2YmJiFpLm5ld2xpbmVJc1Rva2VuJiYoZS5lbmRzV2l0aChgCmApJiYoZT1lLnNsaWNlKDAsLTEpKSx0LmVuZHNXaXRoKGAKYCkmJih0PXQuc2xpY2UoMCwtMSkpKSxzdXBlci5lcXVhbHMoZSx0LGkpfX0sQj1uZXcgVjtmdW5jdGlvbiBBKG4sZSx0KXtyZXR1cm4gQi5kaWZmKG4sZSx0KX1mdW5jdGlvbiBTZShuLGUsdCl7cmV0dXJuIHQ9bWUodCx7aWdub3JlV2hpdGVzcGFjZTohMH0pLEIuZGlmZihuLGUsdCl9ZnVuY3Rpb24gUShuLGUpe2Uuc3RyaXBUcmFpbGluZ0NyJiYobj1uLnJlcGxhY2UoL1xyXG4vZyxgCmApKTtsZXQgdD1bXSxpPW4uc3BsaXQoLyhcbnxcclxuKS8pO2lbaS5sZW5ndGgtMV18fGkucG9wKCk7Zm9yKGxldCByPTA7cjxpLmxlbmd0aDtyKyspe2xldCBsPWlbcl07ciUyJiYhZS5uZXdsaW5lSXNUb2tlbj90W3QubGVuZ3RoLTFdKz1sOnQucHVzaChsKX1yZXR1cm4gdH1mdW5jdGlvbiBMZShuKXtyZXR1cm4gbj09Ii4ifHxuPT0iISJ8fG49PSI/In12YXIgWD1jbGFzcyBleHRlbmRzIEN7dG9rZW5pemUoZSl7dmFyIHQ7bGV0IGk9W10scj0wO2ZvcihsZXQgbD0wO2w8ZS5sZW5ndGg7bCsrKXtpZihsPT1lLmxlbmd0aC0xKXtpLnB1c2goZS5zbGljZShyKSk7YnJlYWt9aWYoTGUoZVtsXSkmJmVbbCsxXS5tYXRjaCgvXHMvKSl7Zm9yKGkucHVzaChlLnNsaWNlKHIsbCsxKSksbD1yPWwrMTshKCh0PWVbbCsxXSk9PT1udWxsfHx0PT09dm9pZCAwKSYmdC5tYXRjaCgvXHMvKTspbCsrO2kucHVzaChlLnNsaWNlKHIsbCsxKSkscj1sKzF9fXJldHVybiBpfX0saGU9bmV3IFg7ZnVuY3Rpb24gRGUobixlLHQpe3JldHVybiBoZS5kaWZmKG4sZSx0KX12YXIgWT1jbGFzcyBleHRlbmRzIEN7dG9rZW5pemUoZSl7cmV0dXJuIGUuc3BsaXQoLyhbe306OyxdfFxzKykvKX19LGdlPW5ldyBZO2Z1bmN0aW9uIE1lKG4sZSx0KXtyZXR1cm4gZ2UuZGlmZihuLGUsdCl9dmFyIFo9Y2xhc3MgZXh0ZW5kcyBDe2NvbnN0cnVjdG9yKCl7c3VwZXIoLi4uYXJndW1lbnRzKSx0aGlzLnRva2VuaXplPVF9Z2V0IHVzZUxvbmdlc3RUb2tlbigpe3JldHVybiEwfWNhc3RJbnB1dChlLHQpe2xldHt1bmRlZmluZWRSZXBsYWNlbWVudDppLHN0cmluZ2lmeVJlcGxhY2VyOnI9KGwsbyk9PnR5cGVvZiBvPiJ1Ij9pOm99PXQ7cmV0dXJuIHR5cGVvZiBlPT0ic3RyaW5nIj9lOkpTT04uc3RyaW5naWZ5KEkoZSxudWxsLG51bGwsciksbnVsbCwiICAiKX1lcXVhbHMoZSx0LGkpe3JldHVybiBzdXBlci5lcXVhbHMoZS5yZXBsYWNlKC8sKFtcclxuXSkvZywiJDEiKSx0LnJlcGxhY2UoLywoW1xyXG5dKS9nLCIkMSIpLGkpfX0scGU9bmV3IFo7ZnVuY3Rpb24gSGUobixlLHQpe3JldHVybiBwZS5kaWZmKG4sZSx0KX1mdW5jdGlvbiBJKG4sZSx0LGkscil7ZT1lfHxbXSx0PXR8fFtdLGkmJihuPWkocj09PXZvaWQgMD8iIjpyLG4pKTtsZXQgbDtmb3IobD0wO2w8ZS5sZW5ndGg7bCs9MSlpZihlW2xdPT09bilyZXR1cm4gdFtsXTtsZXQgbztpZihPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwobik9PT0iW29iamVjdCBBcnJheV0iKXtmb3IoZS5wdXNoKG4pLG89bmV3IEFycmF5KG4ubGVuZ3RoKSx0LnB1c2gobyksbD0wO2w8bi5sZW5ndGg7bCs9MSlvW2xdPUkobltsXSxlLHQsaSxTdHJpbmcobCkpO3JldHVybiBlLnBvcCgpLHQucG9wKCksb31pZihuJiZuLnRvSlNPTiYmKG49bi50b0pTT04oKSksdHlwZW9mIG49PSJvYmplY3QiJiZuIT09bnVsbCl7ZS5wdXNoKG4pLG89e30sdC5wdXNoKG8pO2xldCBtPVtdLGQ7Zm9yKGQgaW4gbilPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobixkKSYmbS5wdXNoKGQpO2ZvcihtLnNvcnQoKSxsPTA7bDxtLmxlbmd0aDtsKz0xKWQ9bVtsXSxvW2RdPUkobltkXSxlLHQsaSxkKTtlLnBvcCgpLHQucG9wKCl9ZWxzZSBvPW47cmV0dXJuIG99dmFyIEs9Y2xhc3MgZXh0ZW5kcyBDe3Rva2VuaXplKGUpe3JldHVybiBlLnNsaWNlKCl9am9pbihlKXtyZXR1cm4gZX1yZW1vdmVFbXB0eShlKXtyZXR1cm4gZX19LHdlPW5ldyBLO2Z1bmN0aW9uIFBlKG4sZSx0KXtyZXR1cm4gd2UuZGlmZihuLGUsdCl9ZnVuY3Rpb24gZWUobil7cmV0dXJuIEFycmF5LmlzQXJyYXkobik/bi5tYXAoZT0+ZWUoZSkpOk9iamVjdC5hc3NpZ24oT2JqZWN0LmFzc2lnbih7fSxuKSx7aHVua3M6bi5odW5rcy5tYXAoZT0+T2JqZWN0LmFzc2lnbihPYmplY3QuYXNzaWduKHt9LGUpLHtsaW5lczplLmxpbmVzLm1hcCgodCxpKT0+e3ZhciByO3JldHVybiB0LnN0YXJ0c1dpdGgoIlxcIil8fHQuZW5kc1dpdGgoIlxyIil8fCEoKHI9ZS5saW5lc1tpKzFdKT09PW51bGx8fHI9PT12b2lkIDApJiZyLnN0YXJ0c1dpdGgoIlxcIik/dDp0KyJcciJ9KX0pKX0pfWZ1bmN0aW9uIG5lKG4pe3JldHVybiBBcnJheS5pc0FycmF5KG4pP24ubWFwKGU9Pm5lKGUpKTpPYmplY3QuYXNzaWduKE9iamVjdC5hc3NpZ24oe30sbikse2h1bmtzOm4uaHVua3MubWFwKGU9Pk9iamVjdC5hc3NpZ24oT2JqZWN0LmFzc2lnbih7fSxlKSx7bGluZXM6ZS5saW5lcy5tYXAodD0+dC5lbmRzV2l0aCgiXHIiKT90LnN1YnN0cmluZygwLHQubGVuZ3RoLTEpOnQpfSkpfSl9ZnVuY3Rpb24geGUobil7cmV0dXJuIEFycmF5LmlzQXJyYXkobil8fChuPVtuXSksIW4uc29tZShlPT5lLmh1bmtzLnNvbWUodD0+dC5saW5lcy5zb21lKGk9PiFpLnN0YXJ0c1dpdGgoIlxcIikmJmkuZW5kc1dpdGgoIlxyIikpKSl9ZnVuY3Rpb24gdmUobil7cmV0dXJuIEFycmF5LmlzQXJyYXkobil8fChuPVtuXSksbi5zb21lKGU9PmUuaHVua3Muc29tZSh0PT50LmxpbmVzLnNvbWUoaT0+aS5lbmRzV2l0aCgiXHIiKSkpKSYmbi5ldmVyeShlPT5lLmh1bmtzLmV2ZXJ5KHQ9PnQubGluZXMuZXZlcnkoKGkscik9Pnt2YXIgbDtyZXR1cm4gaS5zdGFydHNXaXRoKCJcXCIpfHxpLmVuZHNXaXRoKCJcciIpfHwoKGw9dC5saW5lc1tyKzFdKT09PW51bGx8fGw9PT12b2lkIDA/dm9pZCAwOmwuc3RhcnRzV2l0aCgiXFwiKSl9KSkpfWZ1bmN0aW9uIHoobil7bGV0IGU9bi5zcGxpdCgvXG4vKSx0PVtdLGk9MDtmdW5jdGlvbiByKGYpe3JldHVybi9eZGlmZiAtLWdpdCAvLnRlc3QoZil9ZnVuY3Rpb24gbChmKXtyZXR1cm4gcihmKXx8L15JbmRleDpccy8udGVzdChmKXx8L15kaWZmKD86IC1yIFx3KykrXHMvLnRlc3QoZil9ZnVuY3Rpb24gbyhmKXtyZXR1cm4vXigtLS18XCtcK1wrKVxzLy50ZXN0KGYpfWZ1bmN0aW9uIG0oZil7cmV0dXJuL15AQFxzLy50ZXN0KGYpfWZ1bmN0aW9uIGQoKXt2YXIgZjtsZXQgcz17fTtzLmh1bmtzPVtdLHQucHVzaChzKTtsZXQgYz0hMTtmb3IoO2k8ZS5sZW5ndGg7KXtsZXQgaD1lW2ldO2lmKG8oaCl8fG0oaCkpYnJlYWs7aWYocihoKSl7aWYoYylyZXR1cm47Yz0hMCxzLmlzR2l0PSEwO2xldCB1PXcoaCk7Zm9yKHUmJihzLm9sZEZpbGVOYW1lPXUub2xkRmlsZU5hbWUscy5uZXdGaWxlTmFtZT11Lm5ld0ZpbGVOYW1lKSxpKys7aTxlLmxlbmd0aDspe2xldCBhPWVbaV07aWYobyhhKXx8bShhKXx8bChhKSlicmVhaztsZXQgcD0vXnJlbmFtZSBmcm9tICguKikvLmV4ZWMoYSk7cCYmKHMub2xkRmlsZU5hbWU9ImEvIitnKHBbMV0pLHMuaXNSZW5hbWU9ITApO2xldCB2PS9ecmVuYW1lIHRvICguKikvLmV4ZWMoYSk7diYmKHMubmV3RmlsZU5hbWU9ImIvIitnKHZbMV0pLHMuaXNSZW5hbWU9ITApO2xldCBXPS9eY29weSBmcm9tICguKikvLmV4ZWMoYSk7VyYmKHMub2xkRmlsZU5hbWU9ImEvIitnKFdbMV0pLHMuaXNDb3B5PSEwKTtsZXQgTj0vXmNvcHkgdG8gKC4qKS8uZXhlYyhhKTtOJiYocy5uZXdGaWxlTmFtZT0iYi8iK2coTlsxXSkscy5pc0NvcHk9ITApO2xldCBiPS9ebmV3IGZpbGUgbW9kZSAoXGQrKS8uZXhlYyhhKTtiJiYocy5pc0NyZWF0ZT0hMCxzLm5ld01vZGU9YlsxXSk7bGV0IGs9L15kZWxldGVkIGZpbGUgbW9kZSAoXGQrKS8uZXhlYyhhKTtrJiYocy5pc0RlbGV0ZT0hMCxzLm9sZE1vZGU9a1sxXSk7bGV0IHJlPS9eb2xkIG1vZGUgKFxkKykvLmV4ZWMoYSk7cmUmJihzLm9sZE1vZGU9cmVbMV0pO2xldCBsZT0vXm5ldyBtb2RlIChcZCspLy5leGVjKGEpO2xlJiYocy5uZXdNb2RlPWxlWzFdKSwvXkJpbmFyeSBmaWxlcyAvLnRlc3QoYSkmJihzLmlzQmluYXJ5PSEwKSxpKyt9Y29udGludWV9ZWxzZSBpZihsKGgpKXtpZihjKXJldHVybjtjPSEwO2xldCB1PS9eKD86SW5kZXg6fGRpZmYoPzogLXIgXHcrKSspXHMrLy5leGVjKGgpO3UmJihzLmluZGV4PWguc3Vic3RyaW5nKHVbMF0ubGVuZ3RoKS50cmltKCkpfWkrK31pZihGKHMpLEYocykscy5vbGRGaWxlTmFtZT09PXZvaWQgMCE9KHMubmV3RmlsZU5hbWU9PT12b2lkIDApKXRocm93IG5ldyBFcnJvcigiTWlzc2luZyAiKyhzLm9sZEZpbGVOYW1lIT09dm9pZCAwPyciKysrIC4uLiInOiciLS0tIC4uLiInKSsiIGZpbGUgaGVhZGVyIGZvciAiKygoZj1zLm9sZEZpbGVOYW1lKSE9PW51bGwmJmYhPT12b2lkIDA/ZjpzLm5ld0ZpbGVOYW1lKSk7Zm9yKDtpPGUubGVuZ3RoOyl7bGV0IGg9ZVtpXTtpZihsKGgpfHxvKGgpfHwvXj09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0vLnRlc3QoaCkpYnJlYWs7bShoKT9zLmh1bmtzLnB1c2goeSgpKTppKyt9fWZ1bmN0aW9uIHcoZil7bGV0IHM9Zi5zdWJzdHJpbmcoMTEpO2lmKHMuc3RhcnRzV2l0aCgnIicpKXtsZXQgaD14KHMpO2lmKGg9PT1udWxsKXJldHVybiBudWxsO2xldCB1PXMuc3Vic3RyaW5nKGgucmF3TGVuZ3RoKzEpLGE7aWYodS5zdGFydHNXaXRoKCciJykpe2xldCBwPXgodSk7aWYocD09PW51bGwpcmV0dXJuIG51bGw7YT1wLmZpbGVOYW1lfWVsc2UgYT11O3JldHVybntvbGRGaWxlTmFtZTpoLmZpbGVOYW1lLG5ld0ZpbGVOYW1lOmF9fWxldCBjPXMuaW5kZXhPZignIicpO2lmKGM+MCl7bGV0IGg9cy5zdWJzdHJpbmcoMCxjLTEpLHU9eChzLnN1YnN0cmluZyhjKSk7cmV0dXJuIHU9PT1udWxsP251bGw6e29sZEZpbGVOYW1lOmgsbmV3RmlsZU5hbWU6dS5maWxlTmFtZX19aWYocy5zdGFydHNXaXRoKCJhLyIpKXtsZXQgaD1bXSx1PTA7Zm9yKDt1PXMuaW5kZXhPZigiIGIvIix1KzEpLHUhPT0tMTspaC5wdXNoKHUpO2lmKGgubGVuZ3RoPjApe2xldCBhPWhbTWF0aC5mbG9vcihoLmxlbmd0aC8yKV07cmV0dXJue29sZEZpbGVOYW1lOnMuc3Vic3RyaW5nKDAsYSksbmV3RmlsZU5hbWU6cy5zdWJzdHJpbmcoYSsxKX19fXJldHVybiBudWxsfWZ1bmN0aW9uIGcoZil7aWYoZi5zdGFydHNXaXRoKCciJykpe2xldCBzPXgoZik7aWYocylyZXR1cm4gcy5maWxlTmFtZX1yZXR1cm4gZn1mdW5jdGlvbiB4KGYpe2lmKCFmLnN0YXJ0c1dpdGgoJyInKSlyZXR1cm4gbnVsbDtsZXQgcz0iIixjPTE7Zm9yKDtjPGYubGVuZ3RoOyl7aWYoZltjXT09PSciJylyZXR1cm57ZmlsZU5hbWU6cyxyYXdMZW5ndGg6YysxfTtpZihmW2NdPT09IlxcIiYmYysxPGYubGVuZ3RoKXN3aXRjaChjKyssZltjXSl7Y2FzZSJhIjpzKz0iXHgwNyI7YnJlYWs7Y2FzZSJiIjpzKz0iXGIiO2JyZWFrO2Nhc2UiZiI6cys9IlxmIjticmVhaztjYXNlIm4iOnMrPWAKYDticmVhaztjYXNlInIiOnMrPSJcciI7YnJlYWs7Y2FzZSJ0IjpzKz0iCSI7YnJlYWs7Y2FzZSJ2IjpzKz0iXHYiO2JyZWFrO2Nhc2UiXFwiOnMrPSJcXCI7YnJlYWs7Y2FzZSciJzpzKz0nIic7YnJlYWs7Y2FzZSIwIjpjYXNlIjEiOmNhc2UiMiI6Y2FzZSIzIjpjYXNlIjQiOmNhc2UiNSI6Y2FzZSI2IjpjYXNlIjciOntpZihjKzI+PWYubGVuZ3RofHxmW2MrMV08IjAifHxmW2MrMV0+IjcifHxmW2MrMl08IjAifHxmW2MrMl0+IjciKXJldHVybiBudWxsO2xldCBoPVtwYXJzZUludChmLnN1YnN0cmluZyhjLGMrMyksOCldO2ZvcihjKz0zO2ZbY109PT0iXFwiJiZmW2MrMV0+PSIwIiYmZltjKzFdPD0iNyI7KXtpZihjKzM+PWYubGVuZ3RofHxmW2MrMl08IjAifHxmW2MrMl0+IjcifHxmW2MrM108IjAifHxmW2MrM10+IjciKXJldHVybiBudWxsO2gucHVzaChwYXJzZUludChmLnN1YnN0cmluZyhjKzEsYys0KSw4KSksYys9NH1zKz1uZXcgVGV4dERlY29kZXIoInV0Zi04IikuZGVjb2RlKG5ldyBVaW50OEFycmF5KGgpKTtjb250aW51ZX1kZWZhdWx0OnJldHVybiBudWxsfWVsc2Ugcys9ZltjXTtjKyt9cmV0dXJuIG51bGx9ZnVuY3Rpb24gRihmKXtsZXQgcz0vXigtLS18XCtcK1wrKVxzKy8uZXhlYyhlW2ldKTtpZihzKXtsZXQgYz1zWzFdLGg9ZVtpXS5zdWJzdHJpbmcoMykudHJpbSgpLnNwbGl0KCIJIiwyKSx1PShoWzFdfHwiIikudHJpbSgpLGE9aFswXTthLnN0YXJ0c1dpdGgoJyInKT9hPWcoYSk6YT1hLnJlcGxhY2UoL1xcXFwvZywiXFwiKSxjPT09Ii0tLSI/KGYub2xkRmlsZU5hbWU9YSxmLm9sZEhlYWRlcj11KTooZi5uZXdGaWxlTmFtZT1hLGYubmV3SGVhZGVyPXUpLGkrK319ZnVuY3Rpb24geSgpe3ZhciBmO2xldCBzPWksYz1lW2krK10saD1jLnNwbGl0KC9AQCAtKFxkKykoPzosKFxkKykpPyBcKyhcZCspKD86LChcZCspKT8gQEAvKSx1PXtvbGRTdGFydDoraFsxXSxvbGRMaW5lczp0eXBlb2YgaFsyXT4idSI/MToraFsyXSxuZXdTdGFydDoraFszXSxuZXdMaW5lczp0eXBlb2YgaFs0XT4idSI/MToraFs0XSxsaW5lczpbXX07dS5vbGRMaW5lcz09PTAmJih1Lm9sZFN0YXJ0Kz0xKSx1Lm5ld0xpbmVzPT09MCYmKHUubmV3U3RhcnQrPTEpO2xldCBhPTAscD0wO2Zvcig7aTxlLmxlbmd0aCYmKHA8dS5vbGRMaW5lc3x8YTx1Lm5ld0xpbmVzfHwhKChmPWVbaV0pPT09bnVsbHx8Zj09PXZvaWQgMCkmJmYuc3RhcnRzV2l0aCgiXFwiKSk7aSsrKXtsZXQgdj1lW2ldLmxlbmd0aD09MCYmaSE9ZS5sZW5ndGgtMT8iICI6ZVtpXVswXTtpZih2PT09IisifHx2PT09Ii0ifHx2PT09IiAifHx2PT09IlxcIil1LmxpbmVzLnB1c2goZVtpXSksdj09PSIrIj9hKys6dj09PSItIj9wKys6dj09PSIgIiYmKGErKyxwKyspO2Vsc2UgdGhyb3cgbmV3IEVycm9yKGBIdW5rIGF0IGxpbmUgJHtzKzF9IGNvbnRhaW5lZCBpbnZhbGlkIGxpbmUgJHtlW2ldfWApfWlmKCFhJiZ1Lm5ld0xpbmVzPT09MSYmKHUubmV3TGluZXM9MCksIXAmJnUub2xkTGluZXM9PT0xJiYodS5vbGRMaW5lcz0wKSxhIT09dS5uZXdMaW5lcyl0aHJvdyBuZXcgRXJyb3IoIkFkZGVkIGxpbmUgY291bnQgZGlkIG5vdCBtYXRjaCBmb3IgaHVuayBhdCBsaW5lICIrKHMrMSkpO2lmKHAhPT11Lm9sZExpbmVzKXRocm93IG5ldyBFcnJvcigiUmVtb3ZlZCBsaW5lIGNvdW50IGRpZCBub3QgbWF0Y2ggZm9yIGh1bmsgYXQgbGluZSAiKyhzKzEpKTtpZihpPGUubGVuZ3RoJiZlW2ldJiYvXlsrIC1dLy50ZXN0KGVbaV0pJiYhbyhlW2ldKSl0aHJvdyBuZXcgRXJyb3IoIkh1bmsgYXQgbGluZSAiKyhzKzEpKyIgaGFzIG1vcmUgbGluZXMgdGhhbiBleHBlY3RlZCAoZXhwZWN0ZWQgIit1Lm9sZExpbmVzKyIgb2xkIGxpbmVzIGFuZCAiK3UubmV3TGluZXMrIiBuZXcgbGluZXMpIik7cmV0dXJuIHV9Zm9yKDtpPGUubGVuZ3RoOylkKCk7cmV0dXJuIHR9ZnVuY3Rpb24geWUobixlLHQpe2xldCBpPSEwLHI9ITEsbD0hMSxvPTE7cmV0dXJuIGZ1bmN0aW9uIG0oKXtpZihpJiYhbCl7aWYocj9vKys6aT0hMSxuK288PXQpcmV0dXJuIG4rbztsPSEwfWlmKCFyKXJldHVybiBsfHwoaT0hMCksZTw9bi1vP24tbysrOihyPSEwLG0oKSl9fWZ1bmN0aW9uIEZlKG4sZSx0PXt9KXtsZXQgaTtpZih0eXBlb2YgZT09InN0cmluZyI/aT16KGUpOkFycmF5LmlzQXJyYXkoZSk/aT1lOmk9W2VdLGkubGVuZ3RoPjEpdGhyb3cgbmV3IEVycm9yKCJhcHBseVBhdGNoIG9ubHkgd29ya3Mgd2l0aCBhIHNpbmdsZSBpbnB1dC4iKTtyZXR1cm4gVGUobixpWzBdLHQpfWZ1bmN0aW9uIFRlKG4sZSx0PXt9KXsodC5hdXRvQ29udmVydExpbmVFbmRpbmdzfHx0LmF1dG9Db252ZXJ0TGluZUVuZGluZ3M9PW51bGwpJiYoc2UobikmJnhlKGUpP2U9ZWUoZSk6ZmUobikmJnZlKGUpJiYoZT1uZShlKSkpO2xldCBpPW4uc3BsaXQoYApgKSxyPWUuaHVua3MsbD10LmNvbXBhcmVMaW5lfHwoKGYscyxjLGgpPT5zPT09aCksbz10LmZ1enpGYWN0b3J8fDAsbT0wO2lmKG88MHx8IU51bWJlci5pc0ludGVnZXIobykpdGhyb3cgbmV3IEVycm9yKCJmdXp6RmFjdG9yIG11c3QgYmUgYSBub24tbmVnYXRpdmUgaW50ZWdlciIpO2lmKCFyLmxlbmd0aClyZXR1cm4gbjtsZXQgZD0iIix3PSExLGc9ITE7Zm9yKGxldCBmPTA7ZjxyW3IubGVuZ3RoLTFdLmxpbmVzLmxlbmd0aDtmKyspe2xldCBzPXJbci5sZW5ndGgtMV0ubGluZXNbZl07c1swXT09IlxcIiYmKGRbMF09PSIrIj93PSEwOmRbMF09PSItIiYmKGc9ITApKSxkPXN9aWYodyl7aWYoZyl7aWYoIW8mJmlbaS5sZW5ndGgtMV09PSIiKXJldHVybiExfWVsc2UgaWYoaVtpLmxlbmd0aC0xXT09IiIpaS5wb3AoKTtlbHNlIGlmKCFvKXJldHVybiExfWVsc2UgaWYoZyl7aWYoaVtpLmxlbmd0aC0xXSE9IiIpaS5wdXNoKCIiKTtlbHNlIGlmKCFvKXJldHVybiExfWZ1bmN0aW9uIHgoZixzLGMsaD0wLHU9ITAsYT1bXSxwPTApe2xldCB2PTAsVz0hMTtmb3IoO2g8Zi5sZW5ndGg7aCsrKXtsZXQgTj1mW2hdLGI9Ti5sZW5ndGg+MD9OWzBdOiIgIixrPU4ubGVuZ3RoPjA/Ti5zdWJzdHIoMSk6TjtpZihiPT09Ii0iKWlmKGwocysxLGlbc10sYixrKSlzKyssdj0wO2Vsc2UgcmV0dXJuIWN8fGlbc109PW51bGw/bnVsbDooYVtwXT1pW3NdLHgoZixzKzEsYy0xLGgsITEsYSxwKzEpKTtpZihiPT09IisiKXtpZighdSlyZXR1cm4gbnVsbDthW3BdPWsscCsrLHY9MCxXPSEwfWlmKGI9PT0iICIpaWYodisrLGFbcF09aVtzXSxsKHMrMSxpW3NdLGIsaykpcCsrLHU9ITAsVz0hMSxzKys7ZWxzZSByZXR1cm4gV3x8IWM/bnVsbDppW3NdJiYoeChmLHMrMSxjLTEsaCsxLCExLGEscCsxKXx8eChmLHMrMSxjLTEsaCwhMSxhLHArMSkpfHx4KGYscyxjLTEsaCsxLCExLGEscCl9cmV0dXJuIHAtPXYscy09dixhLmxlbmd0aD1wLHtwYXRjaGVkTGluZXM6YSxvbGRMaW5lTGFzdEk6cy0xfX1sZXQgRj1bXSx5PTA7Zm9yKGxldCBmPTA7ZjxyLmxlbmd0aDtmKyspe2xldCBzPXJbZl0sYyxoPWkubGVuZ3RoLXMub2xkTGluZXMrbyx1O2ZvcihsZXQgYT0wO2E8PW87YSsrKXt1PXMub2xkU3RhcnQreS0xO2xldCBwPXllKHUsbSxoKTtmb3IoO3UhPT12b2lkIDAmJihjPXgocy5saW5lcyx1LGEpLCFjKTt1PXAoKSk7aWYoYylicmVha31pZighYylyZXR1cm4hMTtmb3IobGV0IGE9bTthPHU7YSsrKUYucHVzaChpW2FdKTtmb3IobGV0IGE9MDthPGMucGF0Y2hlZExpbmVzLmxlbmd0aDthKyspe2xldCBwPWMucGF0Y2hlZExpbmVzW2FdO0YucHVzaChwKX1tPWMub2xkTGluZUxhc3RJKzEseT11KzEtcy5vbGRTdGFydH1mb3IobGV0IGY9bTtmPGkubGVuZ3RoO2YrKylGLnB1c2goaVtmXSk7cmV0dXJuIEYuam9pbihgCmApfWZ1bmN0aW9uIEFlKG4sZSl7bGV0IHQ9dHlwZW9mIG49PSJzdHJpbmciP3oobik6bixpPTA7ZnVuY3Rpb24gcigpe2xldCBsPXRbaSsrXTtpZighbClyZXR1cm4gZS5jb21wbGV0ZSgpO2UubG9hZEZpbGUobCxmdW5jdGlvbihvLG0pe2lmKG8pcmV0dXJuIGUuY29tcGxldGUobyk7bGV0IGQ9RmUobSxsLGUpO2UucGF0Y2hlZChsLGQsZnVuY3Rpb24odyl7aWYodylyZXR1cm4gZS5jb21wbGV0ZSh3KTtyKCl9KX0pfXIoKX1mdW5jdGlvbiBDZShuKXtyZXR1cm4gbj09PXZvaWQgMHx8bj09PSIvZGV2L251bGwiP246bi5zdGFydHNXaXRoKCJhLyIpPyJiLyIrbi5zbGljZSgyKTpuLnN0YXJ0c1dpdGgoImIvIik/ImEvIituLnNsaWNlKDIpOm59ZnVuY3Rpb24gTmUobil7aWYoQXJyYXkuaXNBcnJheShuKSlyZXR1cm4gbi5tYXAodD0+TmUodCkpLnJldmVyc2UoKTtsZXQgZT1PYmplY3QuYXNzaWduKE9iamVjdC5hc3NpZ24oe30sbikse29sZEZpbGVOYW1lOm4uaXNHaXQ/Q2Uobi5uZXdGaWxlTmFtZSk6bi5uZXdGaWxlTmFtZSxvbGRIZWFkZXI6bi5uZXdIZWFkZXIsbmV3RmlsZU5hbWU6bi5pc0dpdD9DZShuLm9sZEZpbGVOYW1lKTpuLm9sZEZpbGVOYW1lLG5ld0hlYWRlcjpuLm9sZEhlYWRlcixvbGRNb2RlOm4ubmV3TW9kZSxuZXdNb2RlOm4ub2xkTW9kZSxpc0NyZWF0ZTpuLmlzRGVsZXRlLGlzRGVsZXRlOm4uaXNDcmVhdGUsaHVua3M6bi5odW5rcy5tYXAodD0+KHtvbGRMaW5lczp0Lm5ld0xpbmVzLG9sZFN0YXJ0OnQubmV3U3RhcnQsbmV3TGluZXM6dC5vbGRMaW5lcyxuZXdTdGFydDp0Lm9sZFN0YXJ0LGxpbmVzOnQubGluZXMubWFwKGk9Pmkuc3RhcnRzV2l0aCgiLSIpP2ArJHtpLnNsaWNlKDEpfWA6aS5zdGFydHNXaXRoKCIrIik/YC0ke2kuc2xpY2UoMSl9YDppKX0pKX0pO3JldHVybiBuLmlzQ29weSYmKGUubmV3RmlsZU5hbWU9Ii9kZXYvbnVsbCIsZS5uZXdIZWFkZXI9dm9pZCAwLGUuaXNEZWxldGU9ITAsZGVsZXRlIGUuaXNDcmVhdGUsZGVsZXRlIGUuaXNDb3B5LGRlbGV0ZSBlLmlzUmVuYW1lLGUuaHVua3M9W10pLGV9ZnVuY3Rpb24gSWUobil7Zm9yKGxldCBlPTA7ZTxuLmxlbmd0aDtlKyspaWYobltlXTwiICJ8fG5bZV0+In4ifHxuW2VdPT09JyInfHxuW2VdPT09IlxcIilyZXR1cm4hMDtyZXR1cm4hMX1mdW5jdGlvbiBFKG4pe2lmKCFJZShuKSlyZXR1cm4gbjtsZXQgZT0nIicsdD1uZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUobiksaT0wO2Zvcig7aTx0Lmxlbmd0aDspe2xldCByPXRbaV07cj09PTc/ZSs9IlxcYSI6cj09PTg/ZSs9IlxcYiI6cj09PTk/ZSs9IlxcdCI6cj09PTEwP2UrPSJcXG4iOnI9PT0xMT9lKz0iXFx2IjpyPT09MTI/ZSs9IlxcZiI6cj09PTEzP2UrPSJcXHIiOnI9PT0zND9lKz0nXFwiJzpyPT09OTI/ZSs9IlxcXFwiOnI+PTMyJiZyPD0xMjY/ZSs9U3RyaW5nLmZyb21DaGFyQ29kZShyKTplKz0iXFwiK3IudG9TdHJpbmcoOCkucGFkU3RhcnQoMywiMCIpLGkrK31yZXR1cm4gZSs9JyInLGV9dmFyIHRlPXtpbmNsdWRlSW5kZXg6ITAsaW5jbHVkZVVuZGVybGluZTohMCxpbmNsdWRlRmlsZUhlYWRlcnM6ITB9LHplPXtpbmNsdWRlSW5kZXg6ITEsaW5jbHVkZVVuZGVybGluZTohMSxpbmNsdWRlRmlsZUhlYWRlcnM6ITB9LGplPXtpbmNsdWRlSW5kZXg6ITEsaW5jbHVkZVVuZGVybGluZTohMSxpbmNsdWRlRmlsZUhlYWRlcnM6ITF9O2Z1bmN0aW9uIGllKG4sZSx0LGkscixsLG8pe2xldCBtO28/dHlwZW9mIG89PSJmdW5jdGlvbiI/bT17Y2FsbGJhY2s6b306bT1vOm09e30sdHlwZW9mIG0uY29udGV4dD4idSImJihtLmNvbnRleHQ9NCk7bGV0IGQ9bS5jb250ZXh0O2lmKG0ubmV3bGluZUlzVG9rZW4pdGhyb3cgbmV3IEVycm9yKCJuZXdsaW5lSXNUb2tlbiBtYXkgbm90IGJlIHVzZWQgd2l0aCBwYXRjaC1nZW5lcmF0aW9uIGZ1bmN0aW9ucywgb25seSB3aXRoIGRpZmZpbmcgZnVuY3Rpb25zIik7aWYobS5jYWxsYmFjayl7bGV0e2NhbGxiYWNrOmd9PW07QSh0LGksT2JqZWN0LmFzc2lnbihPYmplY3QuYXNzaWduKHt9LG0pLHtjYWxsYmFjazp4PT57bGV0IEY9dyh4KTtnKEYpfX0pKX1lbHNlIHJldHVybiB3KEEodCxpLG0pKTtmdW5jdGlvbiB3KGcpe2lmKCFnKXJldHVybjtnLnB1c2goe3ZhbHVlOiIiLGxpbmVzOltdfSk7ZnVuY3Rpb24geCh1KXtyZXR1cm4gdS5tYXAoZnVuY3Rpb24oYSl7cmV0dXJuIiAiK2F9KX1sZXQgRj1bXSx5PTAsZj0wLHM9W10sYz0xLGg9MTtmb3IobGV0IHU9MDt1PGcubGVuZ3RoO3UrKyl7bGV0IGE9Z1t1XSxwPWEubGluZXN8fF9lKGEudmFsdWUpO2lmKGEubGluZXM9cCxhLmFkZGVkfHxhLnJlbW92ZWQpe2lmKCF5KXtsZXQgdj1nW3UtMV07eT1jLGY9aCx2JiYocz1kPjA/eCh2LmxpbmVzLnNsaWNlKC1kKSk6W10seS09cy5sZW5ndGgsZi09cy5sZW5ndGgpfWZvcihsZXQgdiBvZiBwKXMucHVzaCgoYS5hZGRlZD8iKyI6Ii0iKSt2KTthLmFkZGVkP2grPXAubGVuZ3RoOmMrPXAubGVuZ3RofWVsc2V7aWYoeSlpZihwLmxlbmd0aDw9ZCoyJiZ1PGcubGVuZ3RoLTIpZm9yKGxldCB2IG9mIHgocCkpcy5wdXNoKHYpO2Vsc2V7bGV0IHY9TWF0aC5taW4ocC5sZW5ndGgsZCk7Zm9yKGxldCBOIG9mIHgocC5zbGljZSgwLHYpKSlzLnB1c2goTik7bGV0IFc9e29sZFN0YXJ0Onksb2xkTGluZXM6Yy15K3YsbmV3U3RhcnQ6ZixuZXdMaW5lczpoLWYrdixsaW5lczpzfTtGLnB1c2goVykseT0wLGY9MCxzPVtdfWMrPXAubGVuZ3RoLGgrPXAubGVuZ3RofX1mb3IobGV0IHUgb2YgRilmb3IobGV0IGE9MDthPHUubGluZXMubGVuZ3RoO2ErKyl1LmxpbmVzW2FdLmVuZHNXaXRoKGAKYCk/dS5saW5lc1thXT11LmxpbmVzW2FdLnNsaWNlKDAsLTEpOih1LmxpbmVzLnNwbGljZShhKzEsMCwiXFwgTm8gbmV3bGluZSBhdCBlbmQgb2YgZmlsZSIpLGErKyk7cmV0dXJue29sZEZpbGVOYW1lOm4sbmV3RmlsZU5hbWU6ZSxvbGRIZWFkZXI6cixuZXdIZWFkZXI6bCxodW5rczpGfX19ZnVuY3Rpb24gaihuLGUpe3ZhciB0LGkscixsLG8sbTtpZihlfHwoZT10ZSksQXJyYXkuaXNBcnJheShuKSl7aWYobi5sZW5ndGg+MSYmIWUuaW5jbHVkZUZpbGVIZWFkZXJzJiYhbi5ldmVyeShnPT5nLmlzR2l0KSl0aHJvdyBuZXcgRXJyb3IoIkNhbm5vdCBvbWl0IGZpbGUgaGVhZGVycyBvbiBhIG11bHRpLWZpbGUgcGF0Y2guIChUaGUgcmVzdWx0IHdvdWxkIGJlIHVucGFyc2VhYmxlOyBob3cgd291bGQgYSB0b29sIHRyeWluZyB0byBhcHBseSB0aGUgcGF0Y2gga25vdyB3aGljaCBjaGFuZ2VzIGFyZSB0byB3aGljaCBmaWxlPykiKTtyZXR1cm4gbi5tYXAoZz0+aihnLGUpKS5qb2luKGAKYCl9bGV0IGQ9W107aWYobi5pc0dpdCl7aWYoZT10ZSwhbi5vbGRGaWxlTmFtZSl0aHJvdyBuZXcgRXJyb3IoIm9sZEZpbGVOYW1lIG11c3QgYmUgc3BlY2lmaWVkIGZvciBHaXQgcGF0Y2hlcyIpO2lmKCFuLm5ld0ZpbGVOYW1lKXRocm93IG5ldyBFcnJvcigibmV3RmlsZU5hbWUgbXVzdCBiZSBzcGVjaWZpZWQgZm9yIEdpdCBwYXRjaGVzIik7bGV0IGc9bi5vbGRGaWxlTmFtZSx4PW4ubmV3RmlsZU5hbWU7bi5pc0NyZWF0ZSYmZz09PSIvZGV2L251bGwiP2c9eC5yZXBsYWNlKC9eYlwvLywiYS8iKTpuLmlzRGVsZXRlJiZ4PT09Ii9kZXYvbnVsbCImJih4PWcucmVwbGFjZSgvXmFcLy8sImIvIikpLGQucHVzaCgiZGlmZiAtLWdpdCAiK0UoZykrIiAiK0UoeCkpLG4uaXNEZWxldGUmJmQucHVzaCgiZGVsZXRlZCBmaWxlIG1vZGUgIisoKHQ9bi5vbGRNb2RlKSE9PW51bGwmJnQhPT12b2lkIDA/dDoiMTAwNjQ0IikpLG4uaXNDcmVhdGUmJmQucHVzaCgibmV3IGZpbGUgbW9kZSAiKygoaT1uLm5ld01vZGUpIT09bnVsbCYmaSE9PXZvaWQgMD9pOiIxMDA2NDQiKSksbi5vbGRNb2RlJiZuLm5ld01vZGUmJiFuLmlzRGVsZXRlJiYhbi5pc0NyZWF0ZSYmKGQucHVzaCgib2xkIG1vZGUgIituLm9sZE1vZGUpLGQucHVzaCgibmV3IG1vZGUgIituLm5ld01vZGUpKSxuLmlzUmVuYW1lJiYoZC5wdXNoKCJyZW5hbWUgZnJvbSAiK0UoKChyPW4ub2xkRmlsZU5hbWUpIT09bnVsbCYmciE9PXZvaWQgMD9yOiIiKS5yZXBsYWNlKC9eYVwvLywiIikpKSxkLnB1c2goInJlbmFtZSB0byAiK0UoKChsPW4ubmV3RmlsZU5hbWUpIT09bnVsbCYmbCE9PXZvaWQgMD9sOiIiKS5yZXBsYWNlKC9eYlwvLywiIikpKSksbi5pc0NvcHkmJihkLnB1c2goImNvcHkgZnJvbSAiK0UoKChvPW4ub2xkRmlsZU5hbWUpIT09bnVsbCYmbyE9PXZvaWQgMD9vOiIiKS5yZXBsYWNlKC9eYVwvLywiIikpKSxkLnB1c2goImNvcHkgdG8gIitFKCgobT1uLm5ld0ZpbGVOYW1lKSE9PW51bGwmJm0hPT12b2lkIDA/bToiIikucmVwbGFjZSgvXmJcLy8sIiIpKSkpfWVsc2UgZS5pbmNsdWRlSW5kZXgmJm4ub2xkRmlsZU5hbWU9PW4ubmV3RmlsZU5hbWUmJm4ub2xkRmlsZU5hbWUhPT12b2lkIDAmJmQucHVzaCgiSW5kZXg6ICIrbi5vbGRGaWxlTmFtZSksZS5pbmNsdWRlVW5kZXJsaW5lJiZkLnB1c2goIj09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0iKTtsZXQgdz1uLmh1bmtzLmxlbmd0aD4wO2UuaW5jbHVkZUZpbGVIZWFkZXJzJiZuLm9sZEZpbGVOYW1lIT09dm9pZCAwJiZuLm5ld0ZpbGVOYW1lIT09dm9pZCAwJiYoIW4uaXNHaXR8fHcpJiYoZC5wdXNoKCItLS0gIitFKG4ub2xkRmlsZU5hbWUpKyhuLm9sZEhlYWRlcj8iCSIrbi5vbGRIZWFkZXI6IiIpKSxkLnB1c2goIisrKyAiK0Uobi5uZXdGaWxlTmFtZSkrKG4ubmV3SGVhZGVyPyIJIituLm5ld0hlYWRlcjoiIikpKTtmb3IobGV0IGc9MDtnPG4uaHVua3MubGVuZ3RoO2crKyl7bGV0IHg9bi5odW5rc1tnXSxGPXgub2xkTGluZXM9PT0wP3gub2xkU3RhcnQtMTp4Lm9sZFN0YXJ0LHk9eC5uZXdMaW5lcz09PTA/eC5uZXdTdGFydC0xOngubmV3U3RhcnQ7ZC5wdXNoKCJAQCAtIitGKyIsIit4Lm9sZExpbmVzKyIgKyIreSsiLCIreC5uZXdMaW5lcysiIEBAIik7Zm9yKGxldCBmIG9mIHgubGluZXMpZC5wdXNoKGYpfXJldHVybiBkLmpvaW4oYApgKStgCmB9ZnVuY3Rpb24gV2UobixlLHQsaSxyLGwsbyl7aWYodHlwZW9mIG89PSJmdW5jdGlvbiImJihvPXtjYWxsYmFjazpvfSksbz8uY2FsbGJhY2spe2xldHtjYWxsYmFjazptfT1vO2llKG4sZSx0LGkscixsLE9iamVjdC5hc3NpZ24oT2JqZWN0LmFzc2lnbih7fSxvKSx7Y2FsbGJhY2s6ZD0+e20oZD9qKGQsby5oZWFkZXJPcHRpb25zKTp2b2lkIDApfX0pKX1lbHNle2xldCBtPWllKG4sZSx0LGkscixsLG8pO3JldHVybiBtP2oobSxvPy5oZWFkZXJPcHRpb25zKTp2b2lkIDB9fWZ1bmN0aW9uIFJlKG4sZSx0LGkscixsKXtyZXR1cm4gV2UobixuLGUsdCxpLHIsbCl9ZnVuY3Rpb24gX2Uobil7bGV0IGU9bi5lbmRzV2l0aChgCmApLHQ9bi5zcGxpdChgCmApLm1hcChpPT5pK2AKYCk7cmV0dXJuIGU/dC5wb3AoKTp0LnB1c2godC5wb3AoKS5zbGljZSgwLC0xKSksdH1mdW5jdGlvbiAkZShuKXtsZXQgZT1bXSx0LGk7Zm9yKGxldCByPTA7cjxuLmxlbmd0aDtyKyspdD1uW3JdLHQuYWRkZWQ/aT0xOnQucmVtb3ZlZD9pPS0xOmk9MCxlLnB1c2goW2ksdC52YWx1ZV0pO3JldHVybiBlfWZ1bmN0aW9uIFVlKG4pe2xldCBlPVtdO2ZvcihsZXQgdD0wO3Q8bi5sZW5ndGg7dCsrKXtsZXQgaT1uW3RdO2kuYWRkZWQ/ZS5wdXNoKCI8aW5zPiIpOmkucmVtb3ZlZCYmZS5wdXNoKCI8ZGVsPiIpLGUucHVzaChxZShpLnZhbHVlKSksaS5hZGRlZD9lLnB1c2goIjwvaW5zPiIpOmkucmVtb3ZlZCYmZS5wdXNoKCI8L2RlbD4iKX1yZXR1cm4gZS5qb2luKCIiKX1mdW5jdGlvbiBxZShuKXtsZXQgZT1uO3JldHVybiBlPWUucmVwbGFjZSgvJi9nLCImYW1wOyIpLGU9ZS5yZXBsYWNlKC88L2csIiZsdDsiKSxlPWUucmVwbGFjZSgvPi9nLCImZ3Q7IiksZT1lLnJlcGxhY2UoLyIvZywiJnF1b3Q7IiksZX1leHBvcnR7QyBhcyBEaWZmLHplIGFzIEZJTEVfSEVBREVSU19PTkxZLHRlIGFzIElOQ0xVREVfSEVBREVSUyxqZSBhcyBPTUlUX0hFQURFUlMsRmUgYXMgYXBwbHlQYXRjaCxBZSBhcyBhcHBseVBhdGNoZXMsd2UgYXMgYXJyYXlEaWZmLEkgYXMgY2Fub25pY2FsaXplLG9lIGFzIGNoYXJhY3RlckRpZmYsJGUgYXMgY29udmVydENoYW5nZXNUb0RNUCxVZSBhcyBjb252ZXJ0Q2hhbmdlc1RvWE1MLFJlIGFzIGNyZWF0ZVBhdGNoLFdlIGFzIGNyZWF0ZVR3b0ZpbGVzUGF0Y2gsZ2UgYXMgY3NzRGlmZixQZSBhcyBkaWZmQXJyYXlzLGJlIGFzIGRpZmZDaGFycyxNZSBhcyBkaWZmQ3NzLEhlIGFzIGRpZmZKc29uLEEgYXMgZGlmZkxpbmVzLERlIGFzIGRpZmZTZW50ZW5jZXMsU2UgYXMgZGlmZlRyaW1tZWRMaW5lcyxrZSBhcyBkaWZmV29yZHMsY2UgYXMgZGlmZldvcmRzV2l0aFNwYWNlLGogYXMgZm9ybWF0UGF0Y2gscGUgYXMganNvbkRpZmYsQiBhcyBsaW5lRGlmZix6IGFzIHBhcnNlUGF0Y2gsTmUgYXMgcmV2ZXJzZVBhdGNoLGhlIGFzIHNlbnRlbmNlRGlmZixpZSBhcyBzdHJ1Y3R1cmVkUGF0Y2gsYWUgYXMgd29yZERpZmYsZGUgYXMgd29yZHNXaXRoU3BhY2VEaWZmfTsK"
```
