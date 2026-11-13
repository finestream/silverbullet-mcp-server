// The access list (docs/security.md, section 4): per user or group, space and
// path, what an agent may do through this server. Deny by default; the most
// specific path wins; on the same path a user entry wins over group entries;
// between groups `-` wins, otherwise rights add up. A folder entry `X/` covers
// the page `X` too (SilverBullet stores it beside the folder); an entry for
// the exact page is the exception and wins over every folder entry.

export type Right = "r" | "w" | "d" | "x";
export type Rights = Set<Right>;

export type AccessEntry = {
  /** `alice` or `@agents`. */
  subject: string;
  /** A space prefix, or `*` for every space. */
  space: string;
  /** `/` for the whole space, an exact page name, or a folder ending in `/` (which covers the page of that name too). */
  path: string;
  /** The rights, empty for `-`. */
  rights: Rights;
  deny: boolean;
  line: number;
};

export type AccessList = {
  entries: AccessEntry[];
  /** The rights of a user on one page or file of a space. */
  rights(user: string, groups: readonly string[], space: string, path: string): Rights;
  /** The entries that apply to the user in a space, for `list-spaces`. */
  entriesFor(user: string, groups: readonly string[], space: string): AccessEntry[];
};

export const NO_RIGHTS: Rights = new Set();

const RIGHTS = /^[rwdx]+$/;

/**
 * Parses the file: `subject space path rights`, whitespace-separated, `#` comments. A page name
 * may contain single spaces: the path is everything between the space and the rights.
 */
export function parseAccessList(text: string): { entries: AccessEntry[]; problems: string[] } {
  const entries: AccessEntry[] = [];
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) return;
    const tokens = line.split(/\s+/);
    if (tokens.length < 4) {
      problems.push(`line ${i + 1}: expected "user-or-group space path rights", got "${line}"`);
      return;
    }
    const subject = tokens[0];
    const space = tokens[1];
    const rightsText = tokens[tokens.length - 1];
    const path = tokens.slice(2, -1).join(" ");
    if (rightsText !== "-" && !RIGHTS.test(rightsText)) {
      problems.push(`line ${i + 1}: rights must be letters of "rwdx" or "-", got "${rightsText}"`);
      return;
    }
    entries.push({
      subject,
      space,
      path,
      rights: new Set(rightsText === "-" ? [] : (rightsText.split("") as Right[])),
      deny: rightsText === "-",
      line: i + 1,
    });
  });
  return { entries, problems };
}

/** The page name the list is matched against: the file name without `.md` for pages, the file name otherwise. */
export function pageNameOf(file: string): string {
  return file.endsWith(".md") ? file.slice(0, -3) : file;
}

/** Whether a path (the whole space, an exact name, or a folder ending in `/`) covers a name. */
export function pathMatches(entryPath: string, page: string): boolean {
  if (entryPath === "/") return true;
  if (entryPath.endsWith("/")) return page.startsWith(entryPath);
  return page === entryPath;
}

/** Whether an entry's path covers a page name: as `pathMatches`, and a folder `X/` covers the page `X`, stored as `X.md` beside it. */
function entryMatches(entryPath: string, page: string): boolean {
  return pathMatches(entryPath, page) || (entryPath !== "/" && entryPath === `${page}/`);
}

/** An exact entry is the most specific; among folders the longer path; the whole space is the least specific. */
function specificity(entryPath: string): number {
  if (entryPath === "/") return 0;
  return entryPath.endsWith("/") ? entryPath.length : Infinity;
}

export function compileAccessList(entries: AccessEntry[]): AccessList {
  const applicable = (user: string, groups: readonly string[], space: string) => {
    const subjects = new Set([user, ...groups.map((g) => `@${g}`)]);
    return entries.filter((e) => subjects.has(e.subject) && (e.space === space || e.space === "*"));
  };
  return {
    entries,
    rights(user, groups, space, file) {
      const page = pageNameOf(file);
      const matching = applicable(user, groups, space).filter((e) => entryMatches(e.path, page));
      if (matching.length === 0) return NO_RIGHTS;
      const best = Math.max(...matching.map((e) => specificity(e.path)));
      const atBest = matching.filter((e) => specificity(e.path) === best);
      const own = atBest.filter((e) => !e.subject.startsWith("@"));
      const chosen = own.length > 0 ? own : atBest;
      if (chosen.some((e) => e.deny)) return NO_RIGHTS;
      const out: Rights = new Set();
      for (const e of chosen) for (const r of e.rights) out.add(r);
      return out;
    },
    entriesFor(user, groups, space) {
      return applicable(user, groups, space);
    },
  };
}

export const rightsText = (rights: Rights) => (rights.size === 0 ? "-" : (["r", "w", "d", "x"] as const).filter((r) => rights.has(r)).join(""));

/** A user as the access list sees it: the name and the groups of its credentials line. */
export type Subject = { user: string; groups: readonly string[] };

/**
 * The users who may render `page` (`x`) and may not read `target` (`r`). A render runs with the
 * user's SilverBullet rights, so a transclusion of `target` in `page` would show it to them
 * (docs/security.md, sections 5 and 12).
 */
export function renderersWithoutRead(acl: AccessList, subjects: readonly Subject[], space: string, page: string, target: string): string[] {
  return subjects
    .filter((s) => acl.rights(s.user, s.groups, space, page).has("x") && !acl.rights(s.user, s.groups, space, target).has("r"))
    .map((s) => s.user);
}

/** A name that lies under an entry's path and under no more specific one: the rights there are the entry's own reach. */
const sampleOf = (entryPath: string) => (entryPath === "/" ? "\u0001" : entryPath.endsWith("/") ? `${entryPath}\u0001` : entryPath);
const pathText = (entryPath: string) => (entryPath === "/" ? "the rest of the space" : entryPath);

/** The distinct paths of the entries that apply to the user in a space, the whole space included, each with the rights of its own reach. */
function reach(acl: AccessList, user: string, groups: readonly string[], space: string): Array<{ path: string; rights: Rights }> {
  const paths = [...new Set(["/", ...acl.entriesFor(user, groups, space).map((e) => e.path)])];
  return paths.map((path) => ({ path, rights: acl.rights(user, groups, space, sampleOf(path)) }));
}

/**
 * Whether the user may read a page, per path, for the row filter of a render (docs/security.md,
 * section 12): `exact` for the exact entries, `folders` for the folder entries (`X/`), `root`
 * for the rest of the space. The render script looks a page name up in that order, the folders
 * from the longest down (`ruleAllows`); the result is that of `acl.rights` for every name.
 */
export type RowRules = { exact: Map<string, boolean>; folders: Map<string, boolean>; root: boolean };

/** The row rules of a user in a space; null when the user may read every path they reach there, so that there is nothing to hide. */
export function rowRules(acl: AccessList, user: string, groups: readonly string[], space: string): RowRules | null {
  const paths = reach(acl, user, groups, space);
  if (paths.every((p) => p.rights.has("r"))) return null;
  const rules: RowRules = { exact: new Map(), folders: new Map(), root: false };
  for (const { path, rights } of paths) {
    if (path === "/") rules.root = rights.has("r");
    else (path.endsWith("/") ? rules.folders : rules.exact).set(path, rights.has("r"));
  }
  return rules;
}

/** The lookup of the render script's row filter, step for step: the exact name, the folder of the same name, each parent folder from the longest, the root. */
export function ruleAllows(rules: RowRules, page: string): boolean {
  const exact = rules.exact.get(page);
  if (exact !== undefined) return exact;
  for (let q = page; ; ) {
    const folder = rules.folders.get(`${q}/`);
    if (folder !== undefined) return folder;
    const i = q.lastIndexOf("/");
    if (i < 0) break;
    q = q.slice(0, i);
  }
  return rules.root;
}

/**
 * Per space, the users who have `x` on some path and no `r` on another (a `-`, or no entry at
 * all): a render there can show them what the list keeps from `read-note`. One line per space,
 * for the warnings of docs/security.md, section 11. `*` stands for every space not named.
 */
export function rendersWithDenials(acl: AccessList, subjects: readonly Subject[]): string[] {
  const out: string[] = [];
  const spaces = [...new Set(acl.entries.map((e) => e.space))].sort();
  for (const space of spaces) {
    const users: string[] = [];
    for (const s of subjects) {
      const paths = reach(acl, s.user, s.groups, space);
      const withX = paths.filter((p) => p.rights.has("x")).map((p) => p.path);
      const withoutR = paths.filter((p) => !p.rights.has("r")).map((p) => p.path);
      if (withX.length && withoutR.length) users.push(`${s.user} (x on ${withX.map(pathText).join(", ")}; no r on ${withoutR.map(pathText).join(", ")})`);
    }
    if (users.length) {
      out.push(`rendering beside a denial in ${space === "*" ? "every space" : `space ${space}`}: ${users.join("; ")}. A render shows what SilverBullet lets the user see: a page with x can show a page without r, by a transclusion or a query`);
    }
  }
  return out;
}
