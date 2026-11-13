import test from "node:test";
import assert from "node:assert/strict";
import { compileAccessList, parseAccessList, renderersWithoutRead, rendersWithDenials, rightsText, rowRules, ruleAllows } from "./access.ts";

const LIST = `
# user-or-group  space    path            rights
@agents          notes    /               r
@agents          notes    CONFIG          -
@agents          notes    SETTINGS        -
@agents          notes    Library/        -
@agents          notes    Shared/         rw
writer-bot       notes    Shared/Bot/     rwdx
writer-bot       notes    Shared/         rwx
@ops             notes    Shared/         -
@readers         *        Public/         r
alice            notes    ZZ Agent internal/Claude code/  rwd
`;

const { entries, problems } = parseAccessList(LIST);
const acl = compileAccessList(entries);
const rights = (user: string, groups: string[], space: string, file: string) => rightsText(acl.rights(user, groups, space, file));

test("access: the file parses, with page names that contain spaces", () => {
  assert.deepEqual(problems, []);
  assert.equal(entries.length, 10);
  assert.equal(entries[9].path, "ZZ Agent internal/Claude code/");
});

test("access: deny by default", () => {
  assert.equal(rights("nobody", [], "notes", "Shared/x.md"), "-");
  assert.equal(rights("writer-bot", ["agents"], "other", "Shared/x.md"), "-");
});

test("access: the shipped example of the security model", () => {
  assert.equal(rights("writer-bot", ["agents"], "notes", "index.md"), "r");
  assert.equal(rights("writer-bot", ["agents"], "notes", "CONFIG.md"), "-");
  assert.equal(rights("writer-bot", ["agents"], "notes", "Library/Std/Config.md"), "-");
  assert.equal(rights("writer-bot", ["agents"], "notes", "Shared/Note.md"), "rwx", "the user entry wins on the same path");
  assert.equal(rights("writer-bot", ["agents"], "notes", "Shared/Bot/Note.md"), "rwdx", "the most specific path replaces the others");
  assert.equal(rights("other-bot", ["agents"], "notes", "Shared/Note.md"), "rw");
  assert.equal(rights("other-bot", ["agents"], "notes", "Shared/Bot/Note.md"), "rw", "a folder entry covers its subfolders");
});

test("access: between groups on the same path `-` wins, otherwise rights add up", () => {
  assert.equal(rights("x", ["agents", "ops"], "notes", "Shared/Note.md"), "-");
  assert.equal(rights("x", ["agents", "readers"], "notes", "Public/P.md"), "r");
  const { entries: e2 } = parseAccessList("@a notes Shared/ r\n@b notes Shared/ w\n");
  assert.equal(rightsText(compileAccessList(e2).rights("x", ["a", "b"], "notes", "Shared/N.md")), "rw");
});

test("access: an exact page entry matches that page only; `*` matches every space", () => {
  assert.equal(rights("x", ["agents"], "notes", "CONFIG.md"), "-");
  assert.equal(rights("x", ["agents"], "notes", "CONFIG/sub.md"), "r", "an exact entry does not cover the folder of the same name");
  assert.equal(rights("x", ["readers"], "anything", "Public/P.md"), "r");
  assert.equal(rights("alice", [], "notes", "ZZ Agent internal/Claude code/Plan.md"), "rwd");
  assert.equal(rights("alice", [], "notes", "ZZ Agent internal/shared.md"), "-");
});

test("access: a folder entry covers the page of the same name; an exact entry is the exception", () => {
  assert.equal(rights("other-bot", ["agents"], "notes", "Shared.md"), "rw", "Shared/ covers the page Shared");
  assert.equal(rights("other-bot", ["agents"], "notes", "Library.md"), "-");
  assert.equal(rights("writer-bot", ["agents"], "notes", "Shared/Bot.md"), "rwdx", "Shared/Bot/ is more specific than Shared/ for the page Shared/Bot");
  assert.equal(rights("alice", [], "notes", "ZZ Agent internal/Claude code.md"), "rwd");
  assert.equal(rights("other-bot", ["agents"], "notes", "Shared.png"), "r", "a file that is not the page is not covered");
  assert.equal(rights("other-bot", ["agents"], "notes", "Sharedx.md"), "r");

  const list = (text: string) => {
    const a = compileAccessList(parseAccessList(text).entries);
    return (user: string, groups: string[], file: string) => rightsText(a.rights(user, groups, "notes", file));
  };
  // the exception: the exact entry wins for the page, whatever the order and however long the folder path
  const except = list("bot notes Area/ rwd\nbot notes Area r\nbot notes Area/Sub/ rw\nbot notes Area/Sub -\n");
  assert.equal(except("bot", [], "Area.md"), "r");
  assert.equal(except("bot", [], "Area/Page.md"), "rwd");
  assert.equal(except("bot", [], "Area/Sub.md"), "-");
  assert.equal(except("bot", [], "Area/Sub/Page.md"), "rw");
  // the other way round: the page alone, the folder denied
  const pageOnly = list("bot notes / r\nbot notes Area/ -\nbot notes Area r\n");
  assert.equal(pageOnly("bot", [], "Area.md"), "r");
  assert.equal(pageOnly("bot", [], "Area/Page.md"), "-");
  // an exact group entry wins over a user's folder entry: the path decides before the subject
  const mixed = list("bot notes Area/ rw\n@agents notes Area -\n");
  assert.equal(mixed("bot", ["agents"], "Area.md"), "-");
  assert.equal(mixed("bot", ["agents"], "Area/Page.md"), "rw");
});

test("access: non-page files are matched by their file name", () => {
  const { entries: e } = parseAccessList("bot notes Pictures/ r\nbot notes report.csv rw\n");
  const a = compileAccessList(e);
  assert.equal(rightsText(a.rights("bot", [], "notes", "Pictures/a.png")), "r");
  assert.equal(rightsText(a.rights("bot", [], "notes", "report.csv")), "rw");
  assert.equal(rightsText(a.rights("bot", [], "notes", "report.md")), "-");
});

test("access: malformed lines are reported and skipped", () => {
  const { entries: e, problems: p } = parseAccessList("bot notes /\nbot notes / q\nbot notes / r\n");
  assert.equal(e.length, 1);
  assert.equal(p.length, 2);
});

const SUBJECTS = [
  { user: "writer-bot", groups: ["agents"] },
  { user: "reader", groups: ["agents"] },
  { user: "guest", groups: ["readers"] },
];

test("access: who may render a page and may not read a target", () => {
  const who = (page: string, target: string) => renderersWithoutRead(acl, SUBJECTS, "notes", page, target);
  assert.deepEqual(who("Shared/Plan", "CONFIG"), ["writer-bot"]);
  assert.deepEqual(who("Shared/Plan", "Library/Code"), ["writer-bot"]);
  assert.deepEqual(who("Shared/Plan", "Notes/One"), []);
  assert.deepEqual(who("Notes/One", "CONFIG"), [], "nobody has x there");
});

test("access: a user with x on one path and no r on another is reported per space; a list without x reports nothing", () => {
  const lines = rendersWithDenials(acl, SUBJECTS);
  assert.equal(lines.length, 1, lines.join("\n"));
  assert.match(lines[0], /^rendering beside a denial in space notes: writer-bot \(x on Shared\/, Shared\/Bot\/; no r on CONFIG, SETTINGS, Library\/\)\. /);
  const plain = compileAccessList(parseAccessList("@agents * / r\n@agents * CONFIG -\n").entries);
  assert.deepEqual(rendersWithDenials(plain, SUBJECTS), []);
  // deny by default: x on a folder and no entry for the rest of the space
  const narrow = compileAccessList(parseAccessList("reader * Drafts/ rwx\n").entries);
  assert.deepEqual(rendersWithDenials(narrow, SUBJECTS), ["rendering beside a denial in every space: reader (x on Drafts/; no r on the rest of the space). A render shows what SilverBullet lets the user see: a page with x can show a page without r, by a transclusion or a query"]);
  // an exception page under a folder with x is a denial like any other
  const except = compileAccessList(parseAccessList("reader * Drafts/ rx\nreader * Drafts -\nreader * / r\n").entries);
  assert.match(rendersWithDenials(except, SUBJECTS)[0], /reader \(x on Drafts\/; no r on Drafts\)/);
  // x everywhere and no denial: nothing to report
  const open = compileAccessList(parseAccessList("reader * / rx\n").entries);
  assert.deepEqual(rendersWithDenials(open, SUBJECTS), []);
});

test("row rules: the lookup of the render script's row filter agrees with acl.rights on every generated name, for users, groups, `-` between groups and `*`", () => {
  const list = compileAccessList(
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
@agents *     Elsewhere/      -
narrow  notes Drafts/         rx
`).entries,
  );
  const segments = ["CONFIG", "Library", "Public", "Secret", "Shared", "Deep", "Open", "Drafts", "Elsewhere", "Other"];
  const names = new Set<string>();
  for (const a of segments) {
    names.add(a);
    for (const b of segments) {
      names.add(`${a}/${b}`);
      for (const c of segments) names.add(`${a}/${b}/${c}`);
    }
  }
  const subjects = [
    { user: "bot", groups: ["agents"] },
    { user: "bot", groups: ["agents", "ops"] },
    { user: "other", groups: ["agents", "ops"] },
    { user: "other", groups: ["agents"] },
    { user: "narrow", groups: [] },
  ];
  for (const s of subjects) {
    const rules = rowRules(list, s.user, s.groups, "notes");
    assert.ok(rules, `${s.user} ${s.groups.join(",")}: there is something to hide`);
    for (const n of names) assert.equal(ruleAllows(rules!, n), list.rights(s.user, s.groups, "notes", `${n}.md`).has("r"), `${s.user} (${s.groups.join(",")}) on ${n}`);
  }
});

test("row rules: none when the user may read every path they reach; a folder entry covers the page of its name; an exact entry wins", () => {
  assert.equal(rowRules(compileAccessList(parseAccessList("bot notes / rx\nbot notes Shared/ rw\n").entries), "bot", [], "notes"), null);
  const rules = rowRules(compileAccessList(parseAccessList("bot notes / r\nbot notes Hidden/ -\nbot notes Hidden/Open r\n").entries), "bot", [], "notes")!;
  assert.deepEqual([...rules.folders], [["Hidden/", false]]);
  assert.deepEqual([...rules.exact], [["Hidden/Open", true]]);
  assert.equal(rules.root, true);
  assert.equal(ruleAllows(rules, "Hidden"), false, "Hidden/ covers the page Hidden");
  assert.equal(ruleAllows(rules, "Hidden/Open"), true);
  assert.equal(ruleAllows(rules, "Hidden/Open/Sub"), false, "an exact entry does not cover the folder of the same name");
  assert.equal(ruleAllows(rules, "HiddenNot"), true);
  // deny by default: no entry for the rest of the space
  const narrow = rowRules(compileAccessList(parseAccessList("bot notes Drafts/ rx\n").entries), "bot", [], "notes")!;
  assert.equal(narrow.root, false);
  assert.equal(ruleAllows(narrow, "Drafts/One"), true);
  assert.equal(ruleAllows(narrow, "index"), false);
});
