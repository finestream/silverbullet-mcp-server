// Configuration from the environment (README, "Configuration"): where
// SilverBullet is, the four configuration files, the file types, the scan and
// render settings, the name of the scan's technical user, the proposal
// folders, OAuth and Cloudflare Access. Secrets are files (the credentials
// file); nothing secret is read from a variable.

import { readFileSync, statSync, watchFile, unwatchFile } from "node:fs";
import { loadOAuthConfig, type OAuthConfig } from "./oauth.ts";
import { loadCfAccessConfig, type CfAccessConfig } from "./cf-access.ts";
import { isCodePlace } from "./filter/filter.ts";

export type ScanMode = "report" | "quarantine";

export type Config = {
  sbUrl: string;
  port: number;
  credentialsFile: string;
  accessListFile: string;
  allowlistFile: string;
  allowedFilesFile: string;
  /** File types the server writes; shipped default `.md` only. */
  fileTypes: string[];
  /** Milliseconds between scans; 0 means no scheduled scan (the start scan still runs). */
  scanInterval: number;
  scanMode: ScanMode;
  /** The report page of every guarded space: a page name or a path (`Space/MCP Server`), without leading slash or `.md`. */
  reportPage: string;
  /** The folder the proposal tools write to (docs/proposals.md, section 4): ends in `/`, no leading slash. */
  proposalsDir: string;
  /** The folder of the library's working copies, which no proposal may target: ends in `/`, no leading slash. */
  workingCopiesDir: string;
  /** The technical user of the scan (docs/security.md, section 7): the credentials-file line that holds the scan's token. */
  scanUser: string;
  /** The spaces the server guards; empty means every space the scan user can see. */
  spaces: string[];
  /** Tool calls per user and minute; 0 means no limit. */
  rateLimit: number;
  logLevel: "debug" | "info";
  /** Runtime API calls in flight at once, over all runtimes (docs/architecture.md, section 5). */
  renderParallel: number;
  /** Milliseconds a render or screenshot call may take in all, queue included. */
  renderTimeout: number;
  /** Milliseconds a render waits for the runtime's index to hold a write made through the server, before the reboot fallback (docs/security.md, section 12). */
  indexWait: number;
  /** The OAuth resource server settings (docs/oauth.md); null means static bearers only. */
  oauth: OAuthConfig | null;
  /** Cloudflare Access in front of the server (docs/cloudflare-access.md); null means its assertions are not looked at. */
  cfAccess: CfAccessConfig | null;
};

export const DEFAULT_FILE_TYPES = [".md"];

/** The name of the scan's technical user unless `MCP_SCAN_USER` says otherwise. */
export const DEFAULT_SCAN_USER = "scan";
const DEFAULT_REPORT_PAGE = "MCP Server";
/** The library's defaults of `proposalPrefix` and `workingCopyPrefix`, so that both match out of the box. */
export const DEFAULT_PROPOSALS_DIR = "Proposals/";
export const DEFAULT_WORKING_COPIES_DIR = "Working copies/";

/** Types SilverBullet executes or serves as code; they can never be written through the server. */
export const NEVER_WRITTEN_TYPES = [".plug.js", ".js", ".mjs", ".cjs", ".html", ".htm", ".xhtml", ".svg", ".lua"];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dir = env.MCP_CONFIG_DIR ?? "/etc/silverbullet-mcp";
  return {
    sbUrl: (env.SB_URL ?? "http://silverbullet:3000").replace(/\/+$/, ""),
    port: parseCount("PORT", set(env.PORT) ?? "4000", 0, 65535),
    credentialsFile: env.MCP_CREDENTIALS_FILE ?? "/run/secrets/credentials",
    accessListFile: env.MCP_ACCESS_LIST_FILE ?? `${dir}/access-list`,
    allowlistFile: env.MCP_ALLOWLIST_FILE ?? `${dir}/allowlist`,
    allowedFilesFile: env.MCP_ALLOWED_FILES_FILE ?? `${dir}/allowed-files`,
    fileTypes: parseFileTypes(env.MCP_FILE_TYPES ?? DEFAULT_FILE_TYPES.join(",")),
    scanInterval: parseDuration("MCP_SCAN_INTERVAL", set(env.MCP_SCAN_INTERVAL) ?? "15m"),
    scanMode: env.MCP_SCAN_MODE === "quarantine" ? "quarantine" : "report",
    reportPage: parseReportPage(env.MCP_REPORT_PAGE),
    ...parseProposalFolders(env.MCP_PROPOSALS_DIR, env.MCP_WORKING_COPIES_DIR),
    scanUser: env.MCP_SCAN_USER?.trim() || DEFAULT_SCAN_USER,
    spaces: (env.MCP_SPACES ?? "").split(",").map((s) => s.trim().replace(/^\//, "")).filter(Boolean),
    rateLimit: parseCount("MCP_RATE_LIMIT", set(env.MCP_RATE_LIMIT) ?? "120", 0),
    logLevel: env.MCP_LOG_LEVEL === "debug" ? "debug" : "info",
    renderParallel: parseCount("MCP_RENDER_PARALLEL", set(env.MCP_RENDER_PARALLEL) ?? "4", 1),
    renderTimeout: parseDuration("MCP_RENDER_TIMEOUT", set(env.MCP_RENDER_TIMEOUT) ?? "90s"),
    indexWait: parseDuration("MCP_INDEX_WAIT", set(env.MCP_INDEX_WAIT) ?? "5s"),
    oauth: loadOAuthConfig(env),
    cfAccess: loadCfAccessConfig(env),
  };
}

/** The value, or undefined when it is unset or blank: compose passes an unset `${VAR}` as an empty string, which means the default. */
function set(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

/** The report page name: trimmed, without leading slashes or a trailing `.md` (the scan adds it); blank means the default. */
export function parseReportPage(text: string | undefined): string {
  return (text ?? "").trim().replace(/^\/+/, "").replace(/\.md$/, "").trim() || DEFAULT_REPORT_PAGE;
}

/** A folder: trimmed, without leading slashes, ending in one `/`; blank means the default. */
export function parseFolder(text: string | undefined, fallback: string): string {
  const folder = (text ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "").trim();
  return folder ? `${folder}/` : fallback;
}

/**
 * Why a folder cannot hold proposals or working copies, or null: a name the tools refuse (the rules
 * of `normalizeName`), or a place for code, where the write filter does not apply.
 */
export function folderProblem(folder: string): string | null {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(folder)) return "holds a control character or a backslash";
  if (folder.slice(0, -1).split("/").some((segment) => segment === "" || segment === "." || segment === ".." || segment.startsWith("."))) return 'has an empty, "." or dot-prefixed segment';
  if (isCodePlace(folder) || isCodePlace(folder.slice(0, -1))) return "lies in CONFIG or Library/, where pages are code and the write filter does not apply";
  return null;
}

/**
 * The proposal folder and the folder of the working copies; throws when one lies inside the other,
 * as the library refuses to work then (a working copy in the proposal folder could be written by
 * the agents that write proposals), or when either is not a folder for data pages.
 */
export function parseProposalFolders(proposals: string | undefined, workingCopies: string | undefined): { proposalsDir: string; workingCopiesDir: string } {
  const proposalsDir = parseFolder(proposals, DEFAULT_PROPOSALS_DIR);
  const workingCopiesDir = parseFolder(workingCopies, DEFAULT_WORKING_COPIES_DIR);
  for (const [name, folder] of [["MCP_PROPOSALS_DIR", proposalsDir], ["MCP_WORKING_COPIES_DIR", workingCopiesDir]]) {
    const problem = folderProblem(folder);
    if (problem) throw new Error(`${name} ("${folder}") ${problem}`);
  }
  if (proposalsDir.startsWith(workingCopiesDir) || workingCopiesDir.startsWith(proposalsDir)) {
    throw new Error(`MCP_PROPOSALS_DIR ("${proposalsDir}") and MCP_WORKING_COPIES_DIR ("${workingCopiesDir}") must not lie inside each other`);
  }
  return { proposalsDir, workingCopiesDir };
}

export function parseFileTypes(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .map((t) => (t.startsWith(".") ? t : `.${t}`));
}

/** Problems with the configured file types; a type that executes or is served as code cannot be added. */
export function validateFileTypes(types: readonly string[]): string[] {
  const problems: string[] = [];
  for (const t of types) {
    const never = NEVER_WRITTEN_TYPES.find((n) => n === t || n.endsWith(t));
    if (never) problems.push(`"${t}" covers "${never}", a type SilverBullet executes or serves as code`);
  }
  return problems;
}

/**
 * A whole number from `min` to `max`; throws, naming the variable, on anything else, so that a
 * misconfigured server does not start (`Number("4o")` would be NaN: the render cap would then
 * never grant and the rate limit never trigger).
 */
export function parseCount(name: string, text: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = /^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN;
  if (!(n >= min && n <= max)) throw new Error(`${name} must be a whole number ${max === Number.MAX_SAFE_INTEGER ? `of at least ${min}` : `from ${min} to ${max}`}, not "${text}"`);
  return n;
}

/** The longest delay a Node.js timer keeps (about 24.8 days); a longer one fires after 1 ms. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Milliseconds from `0`, `500ms`, `30s`, `15m`, `2h`, `1d`, or plain seconds, at most what a timer
 * keeps; throws, naming the variable, on anything else.
 */
export function parseDuration(name: string, text: string): number {
  const m = text.trim().match(/^(\d+)\s*(ms|s|m|h|d)?$/);
  const ms = m ? Number(m[1]) * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] ?? "s"] as number) : NaN;
  if (!(ms <= MAX_TIMER_MS)) throw new Error(`${name} must be a duration of at most 24 days, such as 0, 500ms, 30s, 15m, 2h or 1d, not "${text}"`);
  return ms;
}

/**
 * A configuration file parsed into a value, re-read when it changes on disk (polled, so that
 * bind-mounted secrets and symlinked files work alike). A file that cannot be read keeps the
 * last good value and records the problem.
 */
export class WatchedFile<T> {
  value: T | null = null;
  problems: string[] = [];
  present = false;
  private mtime = 0;
  private listeners: Array<() => void> = [];

  readonly path: string;
  private readonly parse: (text: string) => { value: T; problems: string[] };
  private readonly required: boolean;

  constructor(path: string, parse: (text: string) => { value: T; problems: string[] }, required = true) {
    this.path = path;
    this.parse = parse;
    this.required = required;
  }

  load(): this {
    try {
      const stat = statSync(this.path);
      this.mtime = stat.mtimeMs;
      const text = readFileSync(this.path, "utf8");
      const { value, problems } = this.parse(text);
      this.value = value;
      this.problems = problems;
      this.present = true;
    } catch (e) {
      this.present = false;
      this.problems = this.required ? [`cannot read ${this.path}: ${(e as Error).message}`] : [];
      if (!this.required) this.value = this.parse("").value;
    }
    return this;
  }

  watch(intervalMs = 2000): this {
    watchFile(this.path, { interval: intervalMs }, (curr) => {
      if (curr.mtimeMs !== this.mtime || (curr.mtimeMs === 0) !== !this.present) {
        this.load();
        for (const l of this.listeners) l();
      }
    });
    return this;
  }

  onChange(listener: () => void): this {
    this.listeners.push(listener);
    return this;
  }

  close() {
    unwatchFile(this.path);
  }
}
