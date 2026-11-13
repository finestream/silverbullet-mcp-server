
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
-- Whether a page text holds HTML as the renderer sees it (an inline tag,
-- an HTML block, a comment), which the formatted view shows only in
-- part: the review then opens on the text view. The parse tree decides,
-- so `<name>` in a code span or a fence and a plain "a < b" do not
-- count. Should the parser fail, the text counts as holding HTML.
-----------------------------------------------------------------------
proposals.htmlNodes = {
	HTMLTag = true, HTMLBlock = true, HTMLOpenTag = true, HTMLCloseTag = true,
	CommentBlock = true, Comment = true, ProcessingInstruction = true,
}

function proposals.holdsHtml(text)
	if type(text) ~= "string" then return false end
	local function walk(node)
		if proposals.htmlNodes[node.type] then return true end
		for _, child in ipairs(node.children or {}) do
			if walk(child) then return true end
		end
		return false
	end
	local ok, found = pcall(function() return walk(markdown.parseMarkdown(text)) end)
	if not ok then return true end
	return found
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
