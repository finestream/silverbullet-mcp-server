// The scan (docs/security.md, sections 7 and 8) and the transform check
// (section 10), as the technical user (`MCP_SCAN_USER`, default `scan`): which spaces are guarded,
// which release the instance runs and, on SilverBullet 2, whether CONFIG holds
// the shipped transform block, which pages outside Library/ (and CONFIG on
// SilverBullet 2) hold code, which files are not pages; the report page per
// space; the quarantine when the operator chose it.

import { checkPage, codePlaces, FileIndex, isCodePlace, type TransclusionCheck, type Verdict, type Violation } from "./filter/filter.ts";
import { checkPageLimited, CheckTimeout } from "./filter/check.ts";
import { compileAllowlist, type Allowlist } from "./filter/allowlist.ts";
import { pageNameOf, pathMatches, renderersWithoutRead, type AccessList, type Subject } from "./access.ts";
import { SbError, majorOf, type SilverBullet, type SbFile } from "./sb.ts";
import type { Config } from "./config.ts";
import type { State, SpaceState, Finding, FileFinding } from "./state.ts";
import type { Log } from "./log.ts";
import { checkLibrary, LIBRARY_PAGE } from "./proposal.ts";
import { parser as mdParser } from "@lezer/markdown";

/** The rule of a page whose check did not end within the limit (docs/security.md, section 7). */
export const TIMEOUT_RULE = "timeout";

/** The index-time transform block, verbatim as in docs/security.md, section 10. The checks in test/ assert that. */
export const SHIPPED_TRANSFORM = `-- Shipped with the MCP server. Keep verbatim; the server checks for it at start.
local function confine(o)
  local page = string.match(o.ref, "^(.*)@%d+$") or ""
  if page == "CONFIG" or string.startsWith(page, "Library/") then return o end
  if o.script then o.script = "-- not loaded: outside CONFIG and Library/" end
  if o.style then o.style = "/* not loaded: outside CONFIG and Library/ */" end
  return o
end
tag.define { name = "space-lua", transform = confine }
tag.define { name = "space-style", transform = confine }`;

/** The major release since which SilverBullet runs space-lua and space-style from Library/ only (docs/facts/execution-model.md, section 8). */
export const LIBRARY_ONLY_SINCE = 3;

/** Whether a CONFIG page holds the shipped block, verbatim, inside a space-lua fence. */
export function hasTransform(configSource: string): boolean {
  const src = configSource.replace(/\r\n/g, "\n");
  const tree = mdParser.parse(src);
  let found = false;
  tree.iterate({
    enter(n) {
      if (found || n.name !== "FencedCode") return;
      const info = n.node.getChild("CodeInfo");
      const lang = info ? src.slice(info.from, info.to).trim().split(/\s+/)[0] : "";
      if (lang !== "space-lua") return;
      const body = src.slice(n.from, n.to);
      if (body.includes(SHIPPED_TRANSFORM)) found = true;
    },
  });
  return found;
}

export type AllowedFile = { space: string; path: string };

/** The allowed-files list: `space path` per line, `*` for every space; a path is a file or a folder ending in `/`. */
export function parseAllowedFiles(text: string): { value: AllowedFile[]; problems: string[] } {
  const value: AllowedFile[] = [];
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) return;
    const sp = line.indexOf(" ");
    if (sp === -1) {
      problems.push(`line ${i + 1}: expected "space path"`);
      return;
    }
    value.push({ space: line.slice(0, sp), path: line.slice(sp + 1).trim() });
  });
  return { value, problems };
}

export type ScanDeps = {
  sb: SilverBullet;
  state: State;
  config: Config;
  log: Log;
  scanToken: () => string | null;
  /** The spaces to start discovery from: every default space of the credentials file. */
  seedSpaces: () => string[];
  allowlist: () => Allowlist | null;
  allowedFiles: () => AllowedFile[];
  /** The access list and the users of the credentials file, for the transclusion rule; without them it is not checked. */
  accessList?: () => AccessList | null;
  subjects?: () => readonly Subject[];
  /** The server's version, which the review library must have. */
  version: string;
};

export type ScanSummary = { spaces: string[]; findings: number; files: number; unguarded: string[]; missingTransform: string[]; ms: number };

export class Scanner {
  private readonly d: ScanDeps;

  constructor(d: ScanDeps) {
    this.d = d;
  }

  /**
   * The configured list; otherwise every space prefix of the instance the scan user can see, from
   * the `/.config` of any reachable space. Without a token: the default spaces of the credentials
   * file and the spaces seen before, so that each is reported as unguarded.
   */
  async discover(token: string | null): Promise<string[]> {
    if (this.d.config.spaces.length) return [...this.d.config.spaces].sort();
    const known = new Set<string>([...this.d.seedSpaces(), ...this.d.state.spaces.keys()]);
    if (!token) return [...known].sort();
    for (const space of [...known]) {
      try {
        const cfg = await this.d.sb.config(token, space);
        for (const p of cfg.spacePrefixes) known.add(p.replace(/^\//, ""));
        break;
      } catch {}
    }
    return [...known].sort();
  }

  /** One full scan over every space; updates the state and writes the report pages. */
  async run(): Promise<ScanSummary> {
    const t0 = performance.now();
    const { state, log } = this.d;
    if (state.scanning) throw new Error("a scan is already running");
    state.scanning = true;
    const summary: ScanSummary = { spaces: [], findings: 0, files: 0, unguarded: [], missingTransform: [], ms: 0 };
    try {
      const token = this.d.scanToken();
      for (const space of await this.discover(token)) {
        const s = state.space(space);
        summary.spaces.push(space);
        if (!token) {
          s.guarded = false;
          s.unguardedReason = `the credentials file has no line for the technical user "${this.d.config.scanUser}"`;
          summary.unguarded.push(space);
          continue;
        }
        try {
          await this.scanSpace(space, token, s);
        } catch (e) {
          log.error("scan.space.failed", { space, error: (e as Error).message });
          s.guarded = false;
          s.unguardedReason = `the scan failed: ${(e as Error).message}`;
        }
        if (!s.guarded) summary.unguarded.push(space);
        if (s.guarded && s.transform !== "present" && s.transform !== "not-needed") summary.missingTransform.push(space);
        summary.findings += s.findings.length;
        summary.files += s.files.length;
      }
    } finally {
      state.scanning = false;
    }
    summary.ms = Math.round(performance.now() - t0);
    log.info("scan.done", { ...summary });
    return summary;
  }

  private async scanSpace(space: string, token: string, s: SpaceState) {
    const { sb, config, log } = this.d;
    const t0 = performance.now();
    let readOnly: boolean;
    try {
      readOnly = (await sb.config(token, space)).readOnly;
    } catch (e) {
      s.guarded = false;
      s.unguardedReason = e instanceof SbError && (e.status === 403 || e.status === 401) ? `the user "${this.d.config.scanUser}" is not a member of the space` : `cannot read the space's configuration: ${(e as Error).message}`;
      return;
    }
    if (readOnly) {
      s.guarded = false;
      s.unguardedReason = `the user "${this.d.config.scanUser}" is a read member; it must be a write member to write the report page`;
      return;
    }
    s.guarded = true;
    s.unguardedReason = null;

    // The transform in CONFIG. SilverBullet 3 loads code from Library/ only and needs none. On a release
    // that cannot be told both hold: the block is required as on 2, and CONFIG is checked as on 3. On 2
    // only CONFIG counts: it does not run Library/Config before the initial index, so a block there (as
    // a downgrade leaves it) comes too late.
    try {
      s.release = await sb.version(token, space);
    } catch (e) {
      // A failure says nothing about the release: the last one named still holds.
      log.warn("scan.release.failed", { space, error: (e as Error).message, release: s.release });
    }
    const major = majorOf(s.release);
    s.libraryOnly = major === null || major >= LIBRARY_ONLY_SINCE;
    if (major !== null && s.libraryOnly) s.transform = "not-needed";
    else {
      try {
        const cfg = await sb.read(token, space, "CONFIG.md");
        s.transform = hasTransform(cfg.body.toString("utf8")) ? "present" : "missing";
      } catch (e) {
        if (e instanceof SbError && e.status === 404) s.transform = "missing";
        else throw e;
      }
    }

    // The review library, for the proposal tools; a page that cannot be read refuses them only.
    try {
      const page = await sb.read(token, space, `${LIBRARY_PAGE}.md`);
      s.library = checkLibrary(page.body.toString("utf8"), this.d.version);
    } catch (e) {
      if (e instanceof SbError && e.status === 404) s.library = checkLibrary(null, this.d.version);
      else s.library = { version: null, format: null, problem: `the library page ${LIBRARY_PAGE} cannot be read: ${(e as Error).message}` };
    }

    // Pages outside the code places, and files that are not pages.
    const allow = this.d.allowlist();
    const files = await sb.list(token, space);
    const findings: Finding[] = [];
    const nonPages: FileFinding[] = [];
    const quarantined: string[] = [];
    const allowed = this.d.allowedFiles().filter((a) => a.space === space || a.space === "*");
    let pagesChecked = 0;
    const reportFile = `${config.reportPage}.md`;
    const index = new FileIndex(files.map((f) => f.name));
    for (const f of files) {
      const page = pageNameOf(f.name);
      if (isCodePlace(page, s.libraryOnly)) continue;
      if (!f.name.endsWith(".md")) {
        if (!allowed.some((a) => pathMatches(a.path, f.name))) nonPages.push({ file: f.name, contentType: f.contentType, size: f.size });
        continue;
      }
      if (f.name === reportFile) continue; // the server's own page
      if (!allow) continue; // without a valid allowlist the filter has nothing to decide with; the server refuses to serve anyway
      pagesChecked++;
      const read = await sb.read(token, space, f.name);
      const source = read.body.toString("utf8");
      const transclusion = this.transclusionCheck(space, page, index);
      let verdict: Verdict;
      try {
        verdict = await checkPageLimited(source, allow, transclusion);
      } catch (e) {
        if (!(e instanceof CheckTimeout)) throw e;
        // Undecidable within the limit: a finding on the whole page (line 0), never quarantined,
        // since the neutralised page could not be checked either.
        findings.push({ page, line: 0, rule: TIMEOUT_RULE, detail: e.message });
        log.warn("scan.timeout", { space, page, size: source.length });
        continue;
      }
      if (verdict.ok) continue;
      if (config.scanMode === "quarantine") {
        const neutralised = quarantine(source, verdict.violations);
        // The neutralised page must pass the filter itself; otherwise it stays a finding.
        if (await checkPageLimited(neutralised, allow, transclusion).then((v) => v.ok, () => false)) {
          try {
            await sb.write(token, space, f.name, neutralised, { ifMatch: read.etag ?? undefined });
            quarantined.push(page);
            log.warn("scan.quarantined", { space, page, violations: verdict.violations.length });
            continue;
          } catch (e) {
            log.error("scan.quarantine.failed", { space, page, error: (e as Error).message });
          }
        } else {
          log.error("scan.quarantine.failed", { space, page, error: "the neutralised page still holds code" });
        }
      }
      for (const v of verdict.violations) findings.push({ page, line: v.line, rule: v.rule, detail: v.detail });
    }
    s.findings = findings;
    s.files = nonPages;
    s.quarantined = quarantined;
    s.lastScan = new Date();
    s.scanMs = Math.round(performance.now() - t0);
    s.pagesChecked = pagesChecked;
    await this.writeReport(space, token, s, files);
  }

  /**
   * The scan has no writer to ask about: a transclusion is a finding when a user who may render
   * the page (`x`) may not read its target (`r`), whoever wrote the page (docs/security.md, section 7).
   */
  private transclusionCheck(space: string, page: string, index: FileIndex): TransclusionCheck | undefined {
    const acl = this.d.accessList?.();
    const subjects = this.d.subjects?.() ?? [];
    if (!acl) return undefined;
    const renderers = subjects.filter((s) => acl.rights(s.user, s.groups, space, page).has("x"));
    const judge = (path: string) => {
      const who = renderersWithoutRead(acl, renderers, space, page, path);
      return who.length ? `${who.join(", ")} may render this page (x) and may not read ${pageNameOf(path)}` : null;
    };
    // The files a name may stand for are judged once, however the page spells it.
    const judged = new Map<readonly string[], string | null>();
    return {
      page,
      denied(path, lookup) {
        const why = judge(path);
        if (why !== null || !lookup || renderers.length === 0) return why;
        const others = index.others(path);
        let other = judged.get(others);
        if (other === undefined) {
          other = null;
          for (const file of others) if ((other = judge(file)) !== null) break;
          judged.set(others, other);
        }
        return other;
      },
    };
  }

  private async writeReport(space: string, token: string, s: SpaceState, files: SbFile[]) {
    const { sb, config, state, log } = this.d;
    const text = safeReport(renderReport(space, s, state, config, files.length));
    const file = `${config.reportPage}.md`;
    try {
      await sb.write(token, space, file, text);
    } catch (e) {
      log.error("scan.report.failed", { space, error: (e as Error).message });
    }
  }
}

/** A fence longer than any run of backticks in the text, so that the text cannot close it. */
const fenceFor = (text: string) => "`".repeat(Math.max(3, (text.match(/`+/g) ?? []).reduce((m, t) => Math.max(m, t.length), 0) + 1));

/**
 * Neutralises the violations in place, keeping the text visible: an executable fence becomes a
 * `lua` fence, a baked marker loses its `#`, anything else is wrapped in a code span (or a fenced
 * block when it spans a blank line, which would end a code span), and the page is tagged
 * #quarantined. Violations may lie in one another and overlap: those that touch are taken together,
 * and wrapped as one when one of them is wrapped.
 */
export function quarantine(source: string, violations: Violation[]): string {
  type Cluster = { from: number; to: number; parts: Violation[] };
  const clusters: Cluster[] = [];
  for (const v of [...violations].sort((a, b) => a.from - b.from)) {
    const last = clusters[clusters.length - 1];
    if (last && v.from <= last.to) {
      last.to = Math.max(last.to, v.to);
      last.parts.push(v);
    } else clusters.push({ from: v.from, to: v.to, parts: [v] });
  }
  const isFence = (v: Violation) => v.rule === "fence" || v.rule === "fence-hidden";
  const isBaked = (v: Violation) => source.startsWith("<!--#lua", v.from);
  let out = "";
  let done = 0;
  for (const c of clusters) {
    let piece = source.slice(c.from, c.to);
    // Fences and markers first, the last one first, so that the offsets of those before it still hold.
    const inPlace = new Map(c.parts.filter((v) => isFence(v) || isBaked(v)).map((v) => [v.from - c.from, v]));
    for (const [at, v] of [...inPlace].sort(([a], [b]) => b - a)) {
      const rest = piece.slice(at);
      const neutral = isFence(v) ? rest.replace(/^([ \t]{0,3}(?:`{3,}|~{3,})[ \t]*)(space-lua|space-config|space-style)\b[^\n]*/, "$1lua") : "<!-- #lua" + rest.slice("<!--#lua".length);
      piece = piece.slice(0, at) + neutral;
    }
    if (c.parts.some((v) => !isFence(v) && !isBaked(v))) {
      if (/\n[ \t]*\n/.test(piece)) {
        const fence = fenceFor(piece);
        piece = `\n${fence}text\n${piece}\n${fence}\n`;
      } else {
        const ticks = fenceFor(piece).slice(2); // one more backtick than any run inside, at least one
        piece = `${ticks}${piece}${ticks}`;
      }
    }
    out += source.slice(done, c.from) + piece;
    done = c.to;
  }
  out += source.slice(done);
  if (!/(^|\s)#quarantined(\s|$)/.test(out)) out = out.replace(/\s*$/, "\n\n#quarantined\n");
  return out;
}

/** The report page may contain no directive at all, whatever a page name, a detail or a file name holds. */
const NO_DIRECTIVES = compileAllowlist([]);

/**
 * Makes sure the report page is inert: if the rendered page holds a directive, a baked marker or an
 * executable fence (a page name such as `A ${...}` would smuggle one in), the whole report goes into
 * one fenced block that nothing inside can close.
 */
export function safeReport(text: string): string {
  const verdict = checkPage(text, NO_DIRECTIVES);
  if (verdict.ok && verdict.directives === 0) return text;
  const plain = text.replace(/<!--#/g, "<!-- #");
  const fence = fenceFor(plain);
  return `# Report\n\nA name or a detail in this report would have been live Markdown; the report is shown as plain text.\n\n${fence}text\n${plain}\n${fence}\n`;
}

/** Page names that are safe inside a wiki link; everything else goes into a code span. */
const LINKABLE = /^[A-Za-z0-9 _.()/-]+$/;
const pageRef = (page: string) => (LINKABLE.test(page) ? `[[${page}]]` : cell(page));

/** Inert in SilverBullet whatever it held: no backtick, pipe or newline, no `${`, no baked marker (which the baker would find even inside a code span). */
const inert = (s: string) => s.replace(/`/g, "'").replace(/\n/g, " ").replace(/\$\{/g, "$ {").replace(/<!--#/g, "<!-- #");
const cell = (s: string) => "`" + inert(s).replace(/\|/g, "\\|") + "`";

/** The report page (docs/security.md, section 8). Holds no directive: every detail is in a code span. */
export function renderReport(space: string, s: SpaceState, state: State, config: Config, fileCount: number): string {
  const lines: string[] = [];
  const now = new Date().toISOString();
  lines.push(`# ${config.reportPage}`, "");
  lines.push(`Written by the MCP server's scan as the user \`${config.scanUser}\` on ${now}; overwritten on every scan. What it means: [docs/security.md](https://github.com/finestream/silverbullet-mcp-server/blob/main/docs/security.md), sections 7 to 9.`, "");
  lines.push("## State", "");
  const refusal = state.refusal(space);
  const block = state.renderBlock(space);
  lines.push(`* Space: \`${space}\``);
  lines.push(`* Serving: ${refusal ? `**no**. ${cell(refusal)}` : "yes"}`);
  lines.push(`* Rendering: ${block ? `**blocked**. ${cell(block)}` : "available where the access list grants x"}`);
  lines.push(`* SilverBullet: ${s.release ? cell(s.release) : "release not named"}`);
  lines.push(`* Transform block in CONFIG: ${s.transform === "present" ? "present" : s.transform === "not-needed" ? "not needed (SilverBullet 3 loads code from Library/ only)" : "**missing**"}`);
  lines.push(`* Proposals library: ${s.library.problem ? `**proposal tools unavailable**: ${cell(s.library.problem)}` : `version ${s.library.version}, proposal tools available`}`);
  lines.push(`* Allowlist: ${state.allowlist.ok ? "valid" : `**invalid**: ${cell(state.allowlist.problems.join("; "))}`}`);
  lines.push(`* Last scan: ${s.lastScan?.toISOString() ?? "never"}, ${s.scanMs} ms, ${s.pagesChecked} page(s) checked, ${fileCount} file(s) seen`);
  lines.push(`* Scan mode: ${config.scanMode === "quarantine" ? "quarantine" : "report-only"}; interval: ${config.scanInterval === 0 ? "none (start and SIGHUP only)" : `${Math.round(config.scanInterval / 60000)} min`}`);
  lines.push("");
  lines.push(`## Findings (${s.findings.length})`, "");
  if (s.findings.length) {
    lines.push("| Page | Line | Rule | Detail |", "|---|---|---|---|");
    for (const f of s.findings) lines.push(`| ${pageRef(f.page)} | ${f.line} | ${cell(f.rule)} | ${cell(f.detail)} |`);
  } else if (!state.allowlist.ok) lines.push("Pages were not checked: the allowlist is invalid, and the server refuses to serve.");
  else lines.push(`None: every page outside ${codePlaces(s.libraryOnly)} is data, and none transcludes what a user who may render it may not read.`);
  lines.push("");
  if (s.quarantined.length) {
    lines.push(`## Quarantined in this run (${s.quarantined.length})`, "");
    for (const p of s.quarantined) lines.push(`* ${pageRef(p)}`);
    lines.push("");
  }
  lines.push(`## Files that are not pages (${s.files.length})`, "");
  if (s.files.length) {
    lines.push("Outside the allowed-files list. The operator removes them or allows them by path.", "", "| File | Type | Size |", "|---|---|---|");
    for (const f of s.files) lines.push(`| ${cell(f.file)} | ${cell(f.contentType)} | ${f.size} |`);
  } else lines.push("None outside the allowed-files list.");
  lines.push("");
  if (state.relaxed.length) {
    lines.push("## Settings weaker than the shipped defaults", "");
    for (const r of state.relaxed) lines.push(`* ${cell(r)}`);
    lines.push("");
  }
  lines.push("## Statistics since start", "");
  lines.push(`* Server started: ${state.startedAt.toISOString()}`);
  lines.push(`* Users seen: ${[...state.usersSeen].sort().map((u) => `\`${u}\``).join(", ") || "none"}`);
  lines.push(`* Spaces seen: ${[...state.spacesSeen].sort().map((u) => `\`${u}\``).join(", ") || "none"}`);
  if (state.requests.size) {
    lines.push("", "| Tool | Calls |", "|---|---|");
    for (const [tool, n] of [...state.requests].sort()) lines.push(`| ${cell(tool)} | ${n} |`);
  }
  if (state.refusals.size) {
    lines.push("", "| Refused by | Calls |", "|---|---|");
    for (const [control, n] of [...state.refusals].sort()) lines.push(`| ${cell(control)} | ${n} |`);
  }
  lines.push("");
  const runtimes = [...state.runtimes.values()].filter((r) => r.space === space).sort((a, b) => (a.user < b.user ? -1 : 1));
  lines.push(`## Runtimes used in this space since start (${runtimes.length})`, "");
  lines.push("Each is a headless browser of about 200 MiB inside the SilverBullet container, started by the first render of that user here and kept by SilverBullet until it restarts or an administrator stops it (Admin, Runtimes). The server cannot stop them.", "");
  if (runtimes.length) {
    lines.push("| User | First used | Last used | Calls | Reboots |", "|---|---|---|---|---|");
    for (const r of runtimes) lines.push(`| \`${r.user}\` | ${r.firstUsed.toISOString()} | ${r.lastUsed.toISOString()} | ${r.calls} | ${r.reboots} |`);
  } else lines.push("None.");
  lines.push("");
  return lines.join("\n");
}
