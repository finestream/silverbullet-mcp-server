// What the row filter of render-note and screenshot-note rests on (docs/security.md, section
// 12): every reading index function of the shipped allowlist is filtered or carries no page
// data; the rows of the filtered ones name their page under the fields the filter reads; the
// server's filter hides a denied page in the expansion and in the editor, Linked Mentions
// included; every row equals its stored object, which the filter requires of a row it keeps; resolveAnchor reads the index past the filter of `tag`. Runs as alice on gamma
// with pages of its own under RowCheck/, removed at the end.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { sb, T, S, sleep } from "../lib/env.ts";
import { SHIPPED_ALLOWLIST } from "../../src/filter/allowlist.ts";
import { NO_PAGE_DATA, OBJECT_FUNCTIONS, ROW_FILTER, ROW_FUNCTIONS, RESTORE_SCRIPT, luaString, navigateScript, renderScript, rowRulesLua } from "../../src/render.ts";
import { compileAccessList, parseAccessList, rowRules } from "../../src/access.ts";

const HIDDEN = "RowCheck/Hidden";
const OPEN = "RowCheck/Open";
const TARGET = "RowCheck/Target";
const ANCHOR = "sbmcp_rowcheck";
/** The rules of a reader who may read everything but RowCheck/Hidden. */
const RULES = { exact: new Map([[HIDDEN, false]]), folders: new Map<string, boolean>(), root: true };
const files = [`${HIDDEN}.md`, `${OPEN}.md`, `${TARGET}.md`, "RowCheck/data.csv"];

const lua = async (script: string) => {
  const r = await sb.lua(T.alice, S.gamma, script);
  assert.equal(r.status, 200, r.raw);
  if (r.error) throw new Error(r.error);
  return r.result;
};
const refs = async () => JSON.parse(String(await lua(`return js.window.eval("JSON.stringify([...document.querySelectorAll('#sb-main a[data-ref]')].map((a) => a.dataset.ref))")`))) as string[];
/** Shows the page and waits until its links, Linked Mentions included, have stopped changing. */
const shown = async (script: string) => {
  await lua(script);
  let last = "";
  let stable = 0;
  for (let i = 0; i < 60 && stable < 4; i++) {
    await sleep(250);
    const now = JSON.stringify(await refs());
    stable = now === last ? stable + 1 : 0;
    last = now;
  }
  return JSON.parse(last) as string[];
};

before(async () => {
  await sb.write(T.admin, S.gamma, `${HIDDEN}.md`, `---\ntags: rowcheck\n$ref: ${ANCHOR}\n---\n# Hidden heading\n\n* [ ] rowcheck task hidden [[${TARGET}]]\n* rowcheck item hidden #rowcheck\n\nMentions [[${TARGET}]] and [[RowCheck/Aspiring]] hidden. #rowcheck\n\n| a | b |\n|---|---|\n| rowcheck | 1 |\n\n* rowcheck forged item hidden [page: ${OPEN}]\n* [ ] rowcheck forged page hidden [tag: page] [name: ${OPEN}]\n`);
  await sb.write(T.admin, S.gamma, `${OPEN}.md`, `* [ ] rowcheck task open\n\nMentions [[${TARGET}]] openly.\n`);
  await sb.write(T.admin, S.gamma, `${TARGET}.md`, `Target.\n\n\${template.each(query[[from t = index.tasks() where string.find(t.name, "rowcheck", 1, true) ~= nil]], templates.taskItem)}\n`);
  await sb.write(T.admin, S.gamma, "RowCheck/data.csv", "a,b\n1,2\n");
  // Written through the file API: the runtime's client learns about them when it syncs.
  for (let i = 0; i < 120; i++) {
    const ready = await lua(`return #query[[from r = index.relations() where r.page == "${HIDDEN}" and r.to == "${TARGET}"]] > 0 and #query[[from r = index.relations() where r.page == "${OPEN}"]] > 0 and #query[[from d = index.documents() where d.name == "RowCheck/data.csv"]] > 0`);
    if (ready === true) return;
    await sleep(500);
  }
  assert.fail("the runtime never indexed the RowCheck pages");
});

after(async () => {
  await sb.lua(T.alice, S.gamma, RESTORE_SCRIPT);
  for (const f of files) await sb.remove(T.admin, S.gamma, f);
});

test("rows: every index function of the shipped allowlist is filtered or classified as carrying no page data, and exists in the release", async () => {
  const allowlisted = SHIPPED_ALLOWLIST.filter((n) => n.startsWith("index.")).map((n) => n.slice("index.".length));
  const classified = new Set([...ROW_FUNCTIONS, ...OBJECT_FUNCTIONS, ...NO_PAGE_DATA]);
  assert.deepEqual(allowlisted.filter((f) => !classified.has(f)), [], "an allowlisted index function the row filter does not know");
  const types = (await lua(`local out = {} for _, f in ipairs({${[...classified].map((f) => JSON.stringify(f)).join(", ")}}) do out[f] = type(index[f]) end return out`)) as Record<string, string>;
  for (const f of classified) assert.equal(types[f], "function", `index.${f} exists`);
});

test("rows: the functions classified as carrying no page data return nothing of a page", async () => {
  const r = (await lua(`local out = {}
out.describeSchema = {pcall(index.describeSchema)}
out.tagSchema = {pcall(index.tagSchema, "rowcheck")}
out.aggregates = {pcall(index.aggregates)}
out.isAvailable = {pcall(index.isAvailable)}
out.extractFrontmatter = {pcall(index.extractFrontmatter, "---\\na: 1\\n---\\n")}
return out`)) as Record<string, unknown>;
  for (const f of NO_PAGE_DATA) {
    assert.equal((r[f] as unknown[] | undefined)?.[0], true, `index.${f} answers: ${JSON.stringify(r[f])}`);
    const text = JSON.stringify(r[f] ?? null);
    assert.doesNotMatch(text, /RowCheck|rowcheck task|Hidden heading/, `${f}: ${text.slice(0, 300)}`);
  }
});

test("rows: every row of each filtered function names its page under the fields the filter reads; the rows of the check's pages name them; a row whose attributes name another page does not pass as it", async () => {
  const calls: Array<[string, string]> = ROW_FUNCTIONS.map((f) => [f, f === "subPages" ? `index.subPages("RowCheck")` : f === "tag" || f === "objects" ? `index.${f}("task")` : `index.${f}()`]);
  const r = (await lua(`${ROW_FILTER}
local out = {}
${calls.map(([f, call]) => `do
  local rows = ${call}
  out[${JSON.stringify(f)}] = {all = #query[[from o = rows]], without = #query[[from o = rows where sbmcp_page(o) == nil and not string.find(o.text or "", "forged", 1, true)]], forged = #query[[from o = rows where string.find(o.text or "", "forged", 1, true) and sbmcp_page(o) ~= nil and sbmcp_page(o) ~= "${HIDDEN}"]], mine = #query[[from o = rows where string.startsWith(sbmcp_page(o) or "", "RowCheck/")]]}
end`).join("\n")}
return out`)) as Record<string, { all: number; without: number; mine: number; forged: number }>;
  for (const [f] of calls) {
    const c = r[f];
    assert.ok(c && c.all > 0, `index.${f} returns rows: ${JSON.stringify(c)}`);
    assert.equal(c.without, 0, `index.${f}: every row has a page (${c.without} of ${c.all} without)`);
    assert.equal(c.forged, 0, `index.${f}: a row whose attributes name another page passes as that page`);
    // metaPages lists only meta pages (Library/), none of the check's.
    if (f !== "metaPages") assert.ok(c.mine > 0, `index.${f}: the check's pages show under their own names`);
  }
});

test("rows: every row equals its getObjectByRef lookup under its own page, field for field (the filter keeps a row only then)", async () => {
  const tags = ["task", "item", "page", "project", "rowcheck"];
  const calls: Array<[string, string]> = [
    ...ROW_FUNCTIONS.filter((f) => f !== "tag" && f !== "objects").map((f): [string, string] => [f, f === "subPages" ? `index.subPages("RowCheck")` : `index.${f}()`]),
    ...tags.flatMap((t): Array<[string, string]> => [[`tag(${t})`, `index.tag(${JSON.stringify(t)})`], [`objects(${t})`, `index.objects(${JSON.stringify(t)})`]]),
  ];
  const r = (await lua(`${ROW_FILTER}
local function differing(a, b)
  if type(b) ~= "table" then return {"(no stored object)"} end
  local out = {}
  for k, v in pairs(a) do if not sbmcp_same(v, b[k]) then out[#out + 1] = tostring(k) end end
  for k, _ in pairs(b) do if a[k] == nil then out[#out + 1] = tostring(k) end end
  table.sort(out)
  return out
end
local out = {}
${calls.map(([f, call]) => `do
  local rows = ${call}
  local n, mine, bad = 0, 0, {}
  for _, o in ipairs(query[[from o = rows]]) do
    local p = sbmcp_page(o)
    -- Rows that forge another page through attributes are meant to differ.
    if p ~= nil and not string.find(o.text or "", "forged", 1, true) then
      n = n + 1
      if string.startsWith(p, "RowCheck/") then mine = mine + 1 end
      local ok, stored = pcall(index.getObjectByRef, p, o.tag, o.ref)
      if not ok then stored = nil end
      if not sbmcp_same(o, stored) then bad[#bad + 1] = {ref = tostring(o.ref), fields = differing(o, stored)} end
    end
  end
  out[${JSON.stringify(f)}] = {n = n, mine = mine, bad = bad}
end`).join("\n")}
return out`)) as Record<string, { n: number; mine: number; bad: Array<{ ref: string; fields: string[] }> }>;
  for (const [f] of calls) {
    const c = r[f];
    assert.ok(c, `index.${f} ran`);
    // An empty Lua table comes back as {}.
    const bad = Array.isArray(c.bad) ? c.bad : [];
    const shown = bad.slice(0, 5).map((b) => `${b.ref}: ${b.fields.join(", ")}`).join("; ");
    assert.equal(bad.length, 0, `index.${f}: ${bad.length} of ${c.n} rows differ from their stored object in: ${shown}`);
  }
  // Positive control: the comparison ran over the check's own pages, not over nothing.
  for (const f of ["pages", "items", "tasks", "links", "relations", "documents", "tag(task)", "objects(task)"]) assert.ok(r[f].mine > 0, `index.${f}: rows of the check's pages were compared`);
});

test("rows: the server's filter hides the denied page in the expansion, and in the editor's query and Linked Mentions; the allowed page shows; nothing is hidden without it", async () => {
  const md = (await lua(renderScript(TARGET, RULES))) as { markdown: string };
  assert.match(md.markdown, /rowcheck task open/, "the allowed page's task (positive control)");
  assert.doesNotMatch(md.markdown, /hidden/, md.markdown);
  try {
    const filtered = await shown(navigateScript(TARGET, RULES));
    assert.ok(filtered.some((r) => r.startsWith(`${OPEN}@`)), `the allowed page's task and mention show: ${filtered.join(", ")}`);
    assert.deepEqual(filtered.filter((r) => r.startsWith(HIDDEN)), [], "nothing of the denied page");
  } finally {
    await lua(RESTORE_SCRIPT);
  }
  const plain = await shown(`editor.navigate(${JSON.stringify(TARGET)}) return 1`);
  assert.ok(plain.filter((r) => r.startsWith(`${HIDDEN}@`)).length >= 2, `without the filter the denied page's task and mention show: ${plain.join(", ")}`);
  const mentions = String(await lua(`return js.window.eval("document.querySelector('#sb-main').innerText")`));
  assert.match(mentions, /Linked Mentions/, "the editor shows Linked Mentions");
  await lua(RESTORE_SCRIPT);
});

test("[watch] rows: resolveAnchor reads the index past the filter of `tag`, so it needs a filter of its own", async () => {
  const r = (await lua(`${ROW_FILTER}
sbmcp_rows(${"{exact = {[\"" + HIDDEN + "\"] = false}, folders = {}, root = true, own = \"\"}"})
local own = index.resolveAnchor("${ANCHOR}")
index.resolveAnchor = _G.__sbmcp_index_saved.resolveAnchor
local past = index.resolveAnchor("${ANCHOR}")
local tagged = #query[[from o = index.tag "anchor" where o.ref == "${ANCHOR}"]]
for f, fn in pairs(_G.__sbmcp_index_saved) do index[f] = fn end
_G.__sbmcp_index_saved = nil
_G.__sbmcp_rules = nil
return {own = own.ok, past = past.ok, tagged = tagged}`)) as { own: boolean; past: boolean; tagged: number };
  assert.equal(r.tagged, 0, "the filter of tag hides the anchor object");
  assert.equal(r.own, false, "resolveAnchor's own filter hides it");
  assert.equal(r.past, true, "without its own filter resolveAnchor still finds the anchor on the denied page");
});

test("rows: the filter's lookup in SilverBullet's Lua agrees with acl.rights on generated names, for users, groups and `-` between groups", async () => {
  const acl = compileAccessList(
    parseAccessList(`
@agents notes /               r
@agents notes CONFIG          -
@agents notes Library/        -
@agents notes Library/Public/ r
@agents notes Library/Public/Secret -
@ops    notes Shared/         -
@agents notes Shared/         r
bot     notes Shared/         rx
bot     notes Shared/Deep/    -
bot     notes Shared/Deep/Open r
`).entries,
  );
  const segments = ["CONFIG", "Library", "Public", "Secret", "Shared", "Deep", "Open", "Other x"];
  const names: string[] = [];
  for (const a of segments) {
    names.push(a);
    for (const b of segments) {
      names.push(`${a}/${b}`);
      for (const c of segments) names.push(`${a}/${b}/${c}`);
    }
  }
  for (const groups of [["agents"], ["agents", "ops"]]) {
    const rules = rowRules(acl, "bot", groups, "notes");
    assert.ok(rules);
    const got = (await lua(`${ROW_FILTER}
_G.__sbmcp_rules = ${rowRulesLua(rules, "\u0001")}
local out = {}
for i, p in ipairs({${names.map(luaString).join(", ")}}) do out[i] = sbmcp_may(p) end
_G.__sbmcp_rules = nil
return out`)) as boolean[];
    names.forEach((n, i) => assert.equal(got[i], acl.rights("bot", groups, "notes", `${n}.md`).has("r"), `bot (${groups.join(",")}) on ${n}`));
  }
});
