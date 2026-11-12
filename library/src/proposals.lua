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

proposals.version = "@VERSION@"
proposals.format = @FORMAT@
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
