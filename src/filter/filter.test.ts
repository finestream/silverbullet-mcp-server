import test from "node:test";
import assert from "node:assert/strict";
import { checkPage, codePlaces, FileIndex, findTransclusions, isCodePlace, transclusionTargets } from "./filter.ts";
import { cases, matrixReader } from "./cases.ts";
import { readFileSync } from "node:fs";
import { compileAllowlist, isNeverAllowed, NEVER_ALLOWED, parseAllowlist, REVIEWED_MEMBERS, SHIPPED_ALLOWLIST, shippedAllowlist, validateAllowlist } from "./allowlist.ts";

test("filter: every case of the matrix gets the verdict the security model asks for, with the shipped allowlist", () => {
  const allow = shippedAllowlist();
  const wrong = cases
    .map((c) => ({ ...c, verdict: checkPage(c.page, allow, matrixReader).ok ? "accept" : "reject" }))
    .filter((c) => c.verdict !== c.expect)
    .map((c) => `${c.id} ${c.name}: expected ${c.expect}, got ${c.verdict}`);
  assert.deepEqual(wrong, []);
  assert.equal(cases.length, 100);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, "every case has its own id");
});

test("filter: a violation names the rule, the line and the range of the directive", () => {
  const page = "# Title\n\nText ${1 + 1}\n\nBad: ${space.readPage(\"CONFIG\")} tail\n";
  const v = checkPage(page, shippedAllowlist());
  assert.equal(v.ok, false);
  assert.equal(v.directives, 2);
  assert.equal(v.violations.length, 1);
  const [x] = v.violations;
  assert.equal(x.rule, "denied-name");
  assert.equal(x.detail, "space.readPage");
  assert.equal(x.line, 5);
  assert.equal(page.slice(x.from, x.to), '${space.readPage("CONFIG")}');
});

test("filter: a page full of unclosed ${ is refused within a bounded time", () => {
  const t0 = performance.now();
  const v = checkPage("${".repeat(200_000), shippedAllowlist());
  assert.equal(v.ok, false);
  assert.equal(v.violations[0].rule, "too-complex");
  assert.ok(performance.now() - t0 < 2000, `${Math.round(performance.now() - t0)} ms`);
  // A realistic page with a few unclosed ${ is fine.
  assert.ok(checkPage("Cost: ${ not closed\n".repeat(200) + "Sum ${1 + 1}\n", shippedAllowlist()).ok);
});

test("filter: a fence violation spans the fence", () => {
  const page = "Text\n\n```space-lua\nfunction f() end\n```\n\nMore\n";
  const [x] = checkPage(page, shippedAllowlist()).violations;
  assert.equal(x.rule, "fence");
  assert.equal(page.slice(x.from, x.to), "```space-lua\nfunction f() end\n```");
});

test("filter: the same reason is reported once per directive", () => {
  const v = checkPage("${space.readPage(space.readPage(\"a\"))}\n", shippedAllowlist());
  assert.deepEqual(v.violations.map((x) => `${x.rule}: ${x.detail}`), ["denied-name: space.readPage"]);
});

test("allowlist: the shipped list is valid and the file format parses comments and blank lines", () => {
  assert.deepEqual(validateAllowlist(SHIPPED_ALLOWLIST), []);
  const entries = parseAllowlist("# comment\n\nquery\ntemplate.each  # trailing\n  templates.*\n");
  assert.deepEqual(entries, ["query", "template.each", "templates.*"]);
});

test("allowlist: the shipped file config/allowlist is the shipped list and is valid (the image carries it; an invalid file refuses to serve)", () => {
  const entries = parseAllowlist(readFileSync(new URL("../../config/allowlist", import.meta.url), "utf8"));
  assert.deepEqual(entries, [...SHIPPED_ALLOWLIST]);
  assert.deepEqual(validateAllowlist(entries), []);
});

test("allowlist: a library's function is not on the shipped list; the operator's entry admits it and nothing beside it", () => {
  const page = "${mylib.views.page(_CTX.currentPage.name)}\n";
  assert.deepEqual(checkPage(page, shippedAllowlist()).violations.map((x) => `${x.rule}: ${x.detail}`), ["call-not-allowed: mylib.views.page"]);
  assert.ok(!SHIPPED_ALLOWLIST.some((e) => e.startsWith("views")), "no library name on the shipped list");
  const allow = compileAllowlist([...SHIPPED_ALLOWLIST, "mylib.views.*"]);
  assert.ok(checkPage(page, allow).ok);
  assert.ok(!checkPage("${mylib.other()}\n", allow).ok);
  assert.ok(!checkPage("${views.page(_CTX.currentPage.name)}\n", allow).ok);
});

test("allowlist: entries that name or cover a never-allowed name are invalid", () => {
  const problems = validateAllowlist(["space.readPage", "config.*", "template.*", "index.*", "*", "*.new", "tag.define", "load", "bad name", "string.*"]);
  const bad = problems.map((p) => p.split('"')[1]);
  assert.deepEqual([...new Set(bad)], ["space.readPage", "config.*", "template.*", "index.*", "*", "*.new", "tag.define", "load", "bad name"]);
});

test("allowlist: `name.*` admits the name and everything under it, `*.method` admits that method on any value", () => {
  const allow = compileAllowlist(["query", "templates.*", "*.upper"]);
  assert.ok(allow.allows(["query"]));
  assert.ok(allow.allows(["templates"]));
  assert.ok(allow.allows(["templates", "pageItem"]));
  assert.ok(!allow.allows(["query", "x"]));
  assert.ok(allow.allows(["p", "name", "upper"]));
  assert.ok(!allow.allows(["upper"]));
  assert.ok(checkPage('${query[[from p = index.tag "x" where p.name:upper() == "A"]]}', compileAllowlist(["query", "index.tag", "*.upper"])).ok);
});

test("allowlist: an exact entry naming a reviewed member of a never-allowed namespace is valid; a wildcard under it or an unknown member is not", () => {
  assert.deepEqual(validateAllowlist(["os.date", "os.time", "schema.string", "markdown.parseMarkdown", "system.getVersion"]), []);
  const problems = validateAllowlist(["os.*", "*.date", "os.getenv", "os.exit", "os", "markdown.expandMarkdown", "template.fromPage", "template.*", "lua.evalExpression", "identity.define", "identity.mentions"]);
  assert.deepEqual(problems, [
    '"os.*" covers the never-allowed name "os"',
    '"os.getenv" is under the never-allowed name "os" and is not a reviewed member (docs/security.md, section 6)',
    '"os.exit" is under the never-allowed name "os" and is not a reviewed member (docs/security.md, section 6)',
    '"os" is a never-allowed name',
    '"markdown.expandMarkdown" is under the never-allowed name "markdown" and is not a reviewed member (docs/security.md, section 6)',
    '"template.fromPage" is a never-allowed name',
    '"template.*" covers the never-allowed name "template.new"',
    '"template.*" covers the never-allowed name "template.fromPage"',
    '"template.*" covers the never-allowed name "template.createPageFromTemplate"',
    '"lua.evalExpression" is under the never-allowed name "lua" and is not a reviewed member (docs/security.md, section 6)',
    '"identity.define" is a never-allowed name',
  ]);
  // `*.date` is a valid entry (no never-allowed name ends in `.date`), but it admits nothing under `os`: see below.
});

test("filter: a reviewed member passes only with its exact entry; the refusal names the rule and says an exact entry would admit it", () => {
  const page = 'Today: ${os.date("%Y-%m-%d")}, ${os.time()}\n';
  const shipped = checkPage(page, shippedAllowlist());
  assert.equal(shipped.ok, false);
  assert.deepEqual(shipped.violations.map((v) => `${v.rule}: ${v.detail}`), [
    "denied-name: os.date (allowable by an exact allowlist entry; not on this allowlist)",
    "denied-name: os.time (allowable by an exact allowlist entry; not on this allowlist)",
  ]);
  assert.ok(checkPage(page, compileAllowlist([...SHIPPED_ALLOWLIST, "os.date", "os.time"])).ok);
  // The entry admits that member and nothing else under the namespace.
  const only = compileAllowlist([...SHIPPED_ALLOWLIST, "os.date"]);
  assert.ok(checkPage('${os.date("%Y")}\n', only).ok);
  assert.deepEqual(checkPage("${os.time()}\n", only).violations.map((v) => v.rule), ["denied-name"]);
  assert.deepEqual(checkPage("${os.clock}\n", only).violations.map((v) => v.rule), ["denied-name"]);
  assert.deepEqual(checkPage("${os}\n", only).violations.map((v) => v.rule), ["denied-name"]);
  assert.deepEqual(checkPage('${os.date.x("%Y")}\n', only).violations.map((v) => v.rule), ["denied-name"]);
  // Wildcards never reach under a never-allowed name, even when valid as entries.
  assert.equal(checkPage('${os.date("%Y")}\n', compileAllowlist([...SHIPPED_ALLOWLIST, "*.date"])).ok, false);
  // An unreviewed member is refused without the hint.
  assert.deepEqual(checkPage('${markdown.expandMarkdown("x")}\n', only).violations.map((v) => v.detail), ["markdown.expandMarkdown"]);
  // A reviewed member in a query clause, bound names untouched.
  assert.ok(checkPage('${query[[from p = index.tag "page" where p.date == os.date("%Y-%m-%d") select p.name]]}\n', only).ok);
});

test("allowlist: the reviewed members all lie under a never-allowed name, none is itself never allowed, and no shipped entry is one", () => {
  for (const m of REVIEWED_MEMBERS) {
    assert.ok(m.includes("."), `${m} is not a member`);
    assert.ok(isNeverAllowed(m), `${m} is not under a never-allowed name`);
    assert.ok(!NEVER_ALLOWED.includes(m), `${m} is never allowed itself`);
  }
  assert.deepEqual(SHIPPED_ALLOWLIST.filter((e) => REVIEWED_MEMBERS.includes(e)), [], "the shipped list adds no reviewed member by itself");
  assert.deepEqual(validateAllowlist(REVIEWED_MEMBERS), []);
});

test("filter: a transclusion violation names the rule, the line, the transclusion and the reason; without a reader transclusions are not checked", () => {
  const page = "# Title\n\nSee below.\n\n![[Private/Plan#Budget|the budget]] and more\n";
  const v = checkPage(page, shippedAllowlist(), matrixReader);
  assert.equal(v.ok, false);
  assert.deepEqual(v.violations.map((x) => `${x.line} ${x.rule}: ${x.detail}`), ["5 transclusion-denied: ![[Private/Plan#Budget|the budget]]: no r on Private/Plan"]);
  assert.equal(page.slice(v.violations[0].from, v.violations[0].to), "![[Private/Plan#Budget|the budget]]");
  assert.ok(checkPage(page, shippedAllowlist()).ok);
});

test("filter: the targets of a transclusion are every file it may resolve to; the shortest reading of ![[…]] is the one SilverBullet looks up", () => {
  const targets = (raw: string, image = false) => transclusionTargets(raw, "Notes/Matrix", image).map((t) => `${t.path}${t.lookup ? " +" : ""}`).sort();
  assert.deepEqual(targets("CONFIG"), ["CONFIG.md +"]);
  assert.deepEqual(targets("/CONFIG.md"), ["CONFIG.md +"]);
  assert.deepEqual(targets("^CONFIG|alias"), ["CONFIG.md +"]);
  assert.deepEqual(targets("Private/Plan.MD"), ["Private/Plan.MD +"]);
  assert.deepEqual(targets("x.pdf"), ["x.pdf +"]);
  assert.deepEqual(targets("a.b c"), ["a.b c.md +"], "no extension: not only letters and digits");
  assert.deepEqual(targets("Private/Plan#Budget"), ["Private/Plan#Budget.md", "Private/Plan.md +"]);
  // `@` may be part of a page name or start a position: both readings
  assert.deepEqual(targets("People/@ann@12"), ["People/.md +", "People/@ann.md", "People/@ann@12.md"]);
  assert.deepEqual(targets("#Intro"), []);
  assert.deepEqual(targets("Notes/Matrix#Intro"), ["Notes/Matrix#Intro.md"]);
  assert.deepEqual(targets("../Private/Plan.md", true), ["Private/Plan.md"]);
  assert.deepEqual(targets("Plan", true), ["Notes/Plan.md", "Plan.md"]);
  assert.deepEqual(targets("/Private%2FPlan", true), ["Private%2FPlan.md", "Private/Plan.md"]);
  assert.deepEqual(targets("https://example.org/x.png", true), []);
  assert.deepEqual(targets("data:image/png;base64,AAAA", true), []);
});

test("filter: transclusions are found in time linear in the page, whatever unclosed openers it holds", () => {
  for (const piece of ["![[", "![a](", "![", "![[a]", "![[#", "![[a]] ", "![[a|", "![a]"]) {
    const page = piece.repeat(200_000) + "\n![[CONFIG]]\n";
    const t0 = performance.now();
    const found = findTransclusions(page);
    assert.ok(performance.now() - t0 < 1000, `${JSON.stringify(piece)}: ${Math.round(performance.now() - t0)} ms`);
    assert.equal(found[found.length - 1].raw, "CONFIG", `${JSON.stringify(piece)}: the transclusion at the end is still found`);
  }
  // Several openers before one close: the first and the last are both reported.
  assert.deepEqual(findTransclusions("![[a ![[b ![[CONFIG]]").map((t) => t.raw), ["a ![[b ![[CONFIG", "CONFIG"]);
  assert.deepEqual(findTransclusions("![x](/a) ![[b|c]] ![y](<d e> \"t\")").map((t) => `${t.image ? "image" : "wiki"} ${t.raw}`), ["image /a", "wiki b|c", "image d e"]);
});

test("filter: a directive is judged by the end each release takes: 3.0 does not count braces in Lua strings, long brackets and comments", () => {
  const allow = shippedAllowlist();
  const call = "tostring(1)";
  for (const page of [
    `x \${"{" .. ${call}} y`,
    `x \${'{' .. ${call}} y`,
    `x \${[[{]] .. ${call}} y`,
    `x \${[==[{]==] .. ${call}} y`,
    `x \${1 --[[ { ]] + ${call}} y`,
    `x \${1 --[==[ { ]==] + ${call}} y`,
    `x \${"\\"{" .. ${call}} y`,
    `| a |\n|---|\n| \${"{" .. ${call}} |\n`,
    `x \${${call}} y`,
  ]) {
    const v = checkPage(page, allow);
    assert.ok(v.violations.some((x) => x.rule === "call-not-allowed" && x.detail === "tostring"), `${page}: ${JSON.stringify(v.violations)}`);
  }
  for (const page of ['x ${"{"} y', 'x ${"a" .. [[{]]} y', 'x ${query[[from p = index.tag "page" where p.name == "{" select p.name]]} y', "x ${ { a = 1 } } y"]) {
    assert.equal(checkPage(page, allow).ok, true, page);
  }
  // An end only one of them takes is checked as well.
  assert.equal(checkPage('x ${"}" .. "a"} y', allow).ok, false, "2.12 ends it inside the string, where it does not parse");
});

test("filter: every ${ is judged on its own, since SilverBullet looks for a directive's end within its block", () => {
  const allow = shippedAllowlist();
  for (const page of ["a ${[[ {\n\n${tostring(1)} } ]] }\n", "a ${[[ {\n\n- ${tostring(1)} } ]] }\n", "${[[ {\n# ${tostring(1)} } ]] }\n", '${"${tostring(1)}"}\n']) {
    const v = checkPage(page, allow);
    assert.ok(v.violations.some((x) => x.detail === "tostring"), `${JSON.stringify(page)}: ${JSON.stringify(v.violations)}`);
  }
});

test("filter: page variables of 3.0 (assignments) are refused", () => {
  const allow = shippedAllowlist();
  for (const body of ["x = 1", "local x = 1", " x=1", 'string = "a"', 'total = string.len("a")', "x = y", "x == 1 and 2"]) {
    assert.equal(checkPage(`a \${${body}} b`, allow).ok, false, body);
  }
});

test("filter: many openers cost a bounded time", () => {
  for (const piece of ["${", '${"', "${[[", "${--[[", "${ { ", "${}", '${"a"} ', "${[[ { }]] }"]) {
    const t0 = performance.now();
    checkPage(piece.repeat(20_000), shippedAllowlist());
    assert.ok(performance.now() - t0 < 5000, `${piece}: ${Math.round(performance.now() - t0)} ms`);
  }
});

test("file index: the file of exactly the path, otherwise every file whose path ends in it, in any case", () => {
  const index = new FileIndex(["index.md", "Private/Plan.md", "Notes/plan.md", "Private/Plans.md", "img.png", "Docs/x.pdf", "x.pdf.md", "Docs/Upper.MD"]);
  assert.ok(index.has("Private/Plan.md") && !index.has("Private/Plan") && !index.has("private/plan.md"));
  assert.deepEqual(index.others("Private/Plan.md"), [], "the exact path");
  assert.deepEqual(index.others("private/plan.md"), ["Private/Plan.md"]);
  assert.deepEqual(index.others("Plan.md"), ["Private/Plan.md", "Notes/plan.md"]);
  assert.deepEqual(index.others("plan.MD"), ["Private/Plan.md", "Notes/plan.md"], "the extension in any case");
  assert.deepEqual(index.others("Upper.md"), ["Docs/Upper.MD"]);
  assert.deepEqual(index.others("x.pdf"), ["Docs/x.pdf"], "the page x.pdf.md is not the file x.pdf");
  assert.deepEqual(index.others("IMG.png"), ["img.png"]);
  assert.deepEqual(index.others("lan.md"), [], "a part of a segment is no end");
  assert.deepEqual(index.others("Missing.md"), []);
  assert.equal(index.others("plan.md"), index.others("PLAN.md"), "one array for every spelling");
});

test("filter: the image form is judged as it is, ![[…]] with the lookup; each text and each file once", () => {
  const asked: string[] = [];
  const page = "![[Deep]] ![[Deep]] ![[Deep#Part]] ![x](Deep) ![x](Deep) ![[pic.png]] ![y](pic.png)\n".repeat(50);
  const v = checkPage(page, shippedAllowlist(), {
    page: "Notes/Page",
    denied(path, lookup) {
      asked.push(`${path} ${lookup}`);
      return lookup && path === "Deep.md" ? "no r" : null;
    },
  });
  assert.deepEqual(asked.sort(), ["Deep.md false", "Deep.md true", "Notes/Deep.md false", "Notes/pic.png false", "pic.png false", "pic.png true"]);
  assert.equal(v.violations.length, 150, "every place is reported");
});

test("filter: many transclusions cost a bounded time, however many files the space has", () => {
  const files = Array.from({ length: 3000 }, (_, i) => `Folder ${i % 50}/Page ${i}.md`);
  const index = new FileIndex(files);
  for (const page of ["![[Nope#a@b$c]]\n".repeat(2000), Array.from({ length: 2000 }, (_, i) => `![[n${i}#a@b]]\n`).join(""), Array.from({ length: 2000 }, (_, i) => `![[Page ${i}]]\n`).join("")]) {
    const t0 = performance.now();
    let found = 0;
    checkPage(page, shippedAllowlist(), {
      page: "Notes/Page",
      denied(path, lookup) {
        if (lookup) found += index.others(path).length;
        return null;
      },
    });
    assert.equal(found, page.includes("Page 1]]") ? 2000 : 0);
    assert.ok(performance.now() - t0 < 1000, `${page.slice(0, 20)}: ${Math.round(performance.now() - t0)} ms`);
  }
});

test("code places: Library/ always, CONFIG on SilverBullet 2 only", () => {
  for (const page of ["Library/Config", "Library/Any/Page"]) assert.ok(isCodePlace(page, false) && isCodePlace(page, true), page);
  for (const page of ["Library", "library/x", "Notes/Library/x", "Config"]) assert.ok(!isCodePlace(page, false) && !isCodePlace(page, true), page);
  assert.ok(isCodePlace("CONFIG", false) && !isCodePlace("CONFIG", true));
  assert.equal(codePlaces(false), "CONFIG and Library/");
  assert.equal(codePlaces(true), "Library/");
});
