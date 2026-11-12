
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
