// The tool surface (docs/architecture.md, "Tool surface"), registered per
// request for the authenticated user. Every tool resolves the space, checks
// the refuse-to-serve state, then the access list, then calls SilverBullet as
// that user; writes pass the file-type check and the write filter first; the
// render tools need `x`, render pages only, are refused while the scan has
// findings in the space, and return nothing when the render loaded a page or
// file the caller may not read (docs/security.md, sections 7 and 12). The
// proposal tools test a change against its target and write a proposal page
// instead of the target (docs/proposals.md, section 4).
// Tool names and input shapes follow Ahmad-A0/silverbullet-mcp (MIT) so that
// clients written for v1 keep working.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AccessList, Right, Rights, Subject } from "./access.ts";
import { pageNameOf, renderersWithoutRead, rightsText } from "./access.ts";
import type { Allowlist } from "./filter/allowlist.ts";
import { describe, isCodePlace, TRANSCLUSION_RULE, type Verdict } from "./filter/filter.ts";
import { checkPageLimited, CheckTimeout } from "./filter/check.ts";
import type { Credential } from "./credentials.ts";
import { diffOf, prepareEdits, type Edit } from "./edit.ts";
import { formatProposal, outsideProposalFolders, type Proposal } from "./proposal.ts";
import { RuntimeError, SbError, SilverBullet, type SbFile } from "./sb.ts";
import type { State } from "./state.ts";
import { judgeLoads, RenderTimeout, type Loads, type Renderer } from "./render.ts";
import { NEVER_WRITTEN_TYPES, type Config } from "./config.ts";
import type { Log } from "./log.ts";
import { matchAll, MatchTimeout, type MatchItem } from "./match.ts";

/** A revision as the tools show it: SilverBullet's ETag without its quotation marks (`sha256:<hex>`); a weak ETag is left as it is. */
export const revisionOf = (etag: string | null): string | null => (etag === null || etag.startsWith("W/") ? etag : etag.replace(/^"(.*)"$/, "$1"));

/** Whether a revision a caller gave, with or without the quotation marks, is the strong ETag the file is at. */
export const sameRevision = (etag: string | null, given: string): boolean => {
  const current = revisionOf(etag);
  return current !== null && !current.startsWith("W/") && current === revisionOf(given.trim());
};

export type Context = {
  user: Credential;
  sb: SilverBullet;
  acl: AccessList;
  /** Every user of the credentials file, for the transclusion rule of the write filter. */
  subjects: readonly Subject[];
  allow: Allowlist;
  config: Config;
  state: State;
  log: Log;
  cache: Cache;
  renderer: Renderer;
};

/** A refusal by one of the server's own controls; the message says which. */
export type Control = "access-list" | "write-filter" | "file-type" | "refuse-to-serve" | "render-block" | "render-check" | "revision" | "input" | "proposals";

export class Refusal extends Error {
  readonly control: Control;

  constructor(control: Control, message: string) {
    super(message);
    this.name = "Refusal";
    this.control = control;
  }
}

const LISTING_TTL = 30_000;

/** Listings and the space's `readOnly` flag per (user, space), 30 s; page contents per (user, space, file, lastModified), bounded. Nothing is shared across users. */
export class Cache {
  private listings = new Map<string, { files: SbFile[]; expires: number }>();
  private readOnly = new Map<string, { value: boolean; expires: number }>();
  private contents = new Map<string, string>();

  listing(user: string, space: string): SbFile[] | null {
    const e = this.listings.get(`${user}\n${space}`);
    return e && e.expires > Date.now() ? e.files : null;
  }
  setListing(user: string, space: string, files: SbFile[]) {
    this.listings.set(`${user}\n${space}`, { files, expires: Date.now() + LISTING_TTL });
  }
  spaceReadOnly(user: string, space: string): boolean | null {
    const e = this.readOnly.get(`${user}\n${space}`);
    return e && e.expires > Date.now() ? e.value : null;
  }
  setSpaceReadOnly(user: string, space: string, value: boolean) {
    this.readOnly.set(`${user}\n${space}`, { value, expires: Date.now() + LISTING_TTL });
  }
  invalidate(user: string, space: string) {
    this.listings.delete(`${user}\n${space}`);
  }
  content(user: string, space: string, file: string, lastModified: number): string | undefined {
    return this.contents.get(`${user}\n${space}\n${file}\n${lastModified}`);
  }
  setContent(user: string, space: string, file: string, lastModified: number, text: string) {
    if (this.contents.size >= 256) this.contents.delete(this.contents.keys().next().value!);
    this.contents.set(`${user}\n${space}\n${file}\n${lastModified}`, text);
  }
}

const result = (data: Record<string, unknown>, text: string): CallToolResult => ({ content: [{ type: "text", text }], structuredContent: data });
const failure = (text: string): CallToolResult => ({ content: [{ type: "text", text }], isError: true });

/** An unreachable SilverBullet did not refuse anything (status 0); every other status is its answer. */
const sbFailure = (e: SbError): string => (e.status === 0 ? e.message : `SilverBullet refused: ${e.message}`);

const TEXT_TYPES = /^(text\/|application\/(json|yaml|x-yaml|xml|javascript|toml))/;

/** `Agent/Plan` means `Agent/Plan.md`; a name whose last segment has an extension is taken as is. */
export function normalizeName(filename: string): string {
  const name = filename.replace(/^\/+/, "");
  if (name.length === 0 || name.length > 1000) throw new Refusal("input", "The file name is empty or longer than 1000 characters.");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(name)) throw new Refusal("input", "The file name holds a control character or a backslash.");
  for (const segment of name.split("/")) {
    if (segment === "" || segment === "." || segment === ".." || segment.startsWith(".")) {
      throw new Refusal("input", `The file name "${filename}" has an empty, "." or dot-prefixed segment; SilverBullet refuses those and so does this server.`);
    }
  }
  const last = name.slice(name.lastIndexOf("/") + 1);
  return last.includes(".") ? name : `${name}.md`;
}

const SPACE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const REGEX_LIMIT = 300;
/** The largest page the server writes, in characters. */
const PAGE_LIMIT = 1_000_000;

/** A user-supplied regex: bounded in length, compiled (to validate) or refused. */
function validRegex(pattern: string, flags: string, what: string): { pattern: string; flags: string } {
  if (pattern.length > REGEX_LIMIT) throw new Refusal("input", `${what} is longer than ${REGEX_LIMIT} characters.`);
  try {
    new RegExp(pattern, flags);
  } catch (e) {
    throw new Refusal("input", `${what} is not a valid regex: ${(e as Error).message}`);
  }
  return { pattern, flags };
}

/** Matches in a worker with a time limit; a pattern that backtracks catastrophically is refused, not served. */
async function matched(re: { pattern: string; flags: string }, items: MatchItem[]) {
  try {
    return await matchAll(re.pattern, re.flags, items);
  } catch (e) {
    if (e instanceof MatchTimeout) throw new Refusal("input", e.message);
    throw e;
  }
}

/** The names of `files` that match a user pattern. */
async function matchingNames(re: { pattern: string; flags: string }, files: SbFile[]): Promise<Set<string>> {
  const results = await matched(re, files.map((f) => ({ id: f.name, text: f.name, lines: false })));
  return new Set(results.filter((r) => r.count > 0).map((r) => r.id));
}

export function registerTools(server: McpServer, ctx: Context) {
  const { user, sb, acl, subjects, allow, config, state, log, cache, renderer } = ctx;
  const token = user.token;

  const resolveSpace = (space: string | undefined): string => {
    const s = space ?? user.defaultSpace;
    if (!s) throw new Refusal("input", `No space given and user "${user.user}" has no default space; pass the "space" parameter.`);
    if (!SPACE_NAME.test(s)) throw new Refusal("input", `"${s}" is not a space name (letters, digits, "_" and "-").`);
    return s;
  };

  /** The report page is the scan's; nothing writes or deletes it through the tools. */
  const notReportPage = (file: string) => {
    if (pageNameOf(file) === config.reportPage) {
      throw new Refusal("input", `"${config.reportPage}" is the server's report page, written by the scan; it cannot be changed through the tools.`);
    }
  };

  const serving = (space: string) => {
    const refusal = state.refusal(space);
    if (refusal) throw new Refusal("refuse-to-serve", refusal);
  };

  const rightsOn = (space: string, file: string) => acl.rights(user.user, user.groups, space, file);

  const need = (space: string, file: string, ...rights: Right[]) => {
    const have = rightsOn(space, file);
    for (const r of rights) {
      if (!have.has(r)) {
        throw new Refusal("access-list", `Denied by the access list: user "${user.user}" has no "${r}" on ${space}/${pageNameOf(file)} (effective rights: ${rightsText(have)}).`);
      }
    }
  };

  const listing = async (space: string): Promise<SbFile[]> => {
    const cached = cache.listing(user.user, space);
    if (cached) return cached;
    const files = await sb.list(token, space);
    cache.setListing(user.user, space, files);
    return files;
  };

  /** The files of a space the user may read. */
  const visible = async (space: string) => (await listing(space)).filter((f) => rightsOn(space, f.name).has("r"));

  /** Whether SilverBullet grants this user read only in the space (`/.config`; the `perm` field of the listing does not tell, docs/architecture.md, "Access and identity"). */
  const spaceReadOnly = async (space: string): Promise<boolean> => {
    const cached = cache.spaceReadOnly(user.user, space);
    if (cached !== null) return cached;
    const value = (await sb.config(token, space)).readOnly;
    cache.setSpaceReadOnly(user.user, space, value);
    return value;
  };

  /**
   * The rights the user has on a file through this server: the access list, narrowed to what
   * SilverBullet grants (no `w` or `d` for a read-only member). What `need` reports in a refusal
   * for the access list; `x` also needs the Runtime API, which only a render tells.
   */
  const effectiveRights = (space: string, file: string, readOnly: boolean): Rights => {
    const have = rightsOn(space, file);
    if (!readOnly) return have;
    return new Set([...have].filter((r) => r !== "w" && r !== "d"));
  };

  const checkFileType = (file: string) => {
    const lower = file.toLowerCase();
    const never = NEVER_WRITTEN_TYPES.find((t) => lower.endsWith(t));
    if (never) throw new Refusal("file-type", `Refused by the file-type rule: "${never}" files are executed or served as code by SilverBullet and are never written through this server.`);
    if (!config.fileTypes.some((t) => lower.endsWith(t))) {
      throw new Refusal("file-type", `Refused by the file-type rule: "${file}" is not of an allowed type (allowed: ${config.fileTypes.join(", ")}).`);
    }
  };

  /**
   * The write filter on the page that would result (docs/security.md, section 5): no code, and no
   * transclusion of a page that the writer, or a user who may render this page, may not read. The
   * check runs in a worker with a time limit; a page it cannot decide in time is refused too.
   */
  const checkContent = async (space: string, file: string, content: string, outcome = "Nothing was written.") => {
    if (!file.toLowerCase().endsWith(".md") || isCodePlace(pageNameOf(file))) return;
    const page = pageNameOf(file);
    let verdict: Verdict;
    try {
      verdict = await checkPageLimited(content, allow, {
        page,
        denied(target) {
          if (!rightsOn(space, target).has("r")) return `user "${user.user}" has no "r" on ${space}/${target}`;
          // Other users are not named to the writer; the report page names them to the operator.
          if (renderersWithoutRead(acl, subjects, space, page, target).length) return `a user who may render this page ("x") has no "r" on ${space}/${target}`;
          return null;
        },
      });
    } catch (e) {
      if (e instanceof CheckTimeout) throw new Refusal("write-filter", `Refused by the write filter: ${e.message}. ${outcome} Split the page, or simplify its Markdown (docs/security.md, section 5).`);
      throw e;
    }
    if (verdict.ok) return;
    const code = verdict.violations.filter((v) => v.rule !== TRANSCLUSION_RULE);
    const transclusions = verdict.violations.filter((v) => v.rule === TRANSCLUSION_RULE);
    const parts: string[] = [];
    if (code.length) parts.push(`the page would hold code (${code.map(describe).join("; ")})`);
    if (transclusions.length) parts.push(`the page would transclude what its reader may not read (${transclusions.map(describe).join("; ")})`);
    const rules: string[] = [];
    if (code.length) rules.push("no code fences, no function definitions or assignments, calls only to allowed functions");
    if (transclusions.length) rules.push("no transclusion of a page or file that the writer, or a user who may render the page, may not read");
    throw new Refusal("write-filter", `Refused by the write filter: ${parts.join("; and ")}. ${outcome} Pages outside CONFIG and Library/ are data: ${rules.join("; ")} (docs/security.md, section 5).`);
  };

  /** After a write or delete through the server: the listing is stale, the page's findings go, and a render waits for the index to hold the change. */
  const written = (space: string, file: string, deleted = false) => {
    cache.invalidate(user.user, space);
    state.dropFindings(space, pageNameOf(file), deleted ? file : undefined);
    if (file.endsWith(".md")) state.recordWrite(space, pageNameOf(file));
  };

  const readText = async (space: string, file: string) => {
    const r = await sb.read(token, space, file);
    return { text: r.body.toString("utf8"), etag: r.etag, contentType: r.contentType };
  };

  /**
   * Writes a file as the user, after the file-type check and the write filter; without `overwrite`
   * only a file that does not exist yet, refused with `exists` otherwise (counted under `control`,
   * a revision conflict unless given). `outcome` closes a refusal. The caller checks the rights.
   */
  const createFile = async (space: string, file: string, body: string | Buffer, overwrite: boolean, exists: string, opts: { control?: Control; outcome?: string } = {}) => {
    checkFileType(file);
    if (typeof body === "string") await checkContent(space, file, body, opts.outcome);
    const r = await sb.write(token, space, file, body, overwrite ? {} : { ifNoneMatch: "*" }).catch((e) => {
      if (e instanceof SbError && e.status === 412 && !overwrite) throw new Refusal(opts.control ?? "revision", exists);
      throw e;
    });
    written(space, file);
    return r;
  };

  /** Wraps a handler: refusals and SilverBullet's errors become tool errors; every call is logged. */
  const tool = <A extends Record<string, unknown>>(name: string, fn: (args: A) => Promise<CallToolResult>, spaceOf: (a: A) => string | undefined = (a) => a.space as string | undefined) => {
    return async (args: A): Promise<CallToolResult> => {
      const t0 = performance.now();
      const space = spaceOf(args) ?? user.defaultSpace;
      state.count(state.requests, name);
      state.usersSeen.add(user.user);
      if (space) state.spacesSeen.add(space);
      const done = (outcome: string, detail?: string) => log.request({ user: user.user, space, tool: name, outcome, ms: Math.round(performance.now() - t0), detail });
      try {
        const out = await fn(args);
        done("ok");
        return out;
      } catch (e) {
        if (e instanceof Refusal) {
          state.count(state.refusals, e.control);
          done(`refused:${e.control}`);
          return failure(e.message);
        }
        if (e instanceof SbError) {
          done(`silverbullet:${e.status}`);
          return failure(e.status === 0 ? `Error: ${e.message}` : sbFailure(e));
        }
        if (e instanceof RuntimeError) {
          done(`runtime:${e.status}`);
          return failure(e.status === 403 || e.status === 401 ? `SilverBullet refused: ${e.message}` : `Rendering failed: ${e.message}`);
        }
        if (e instanceof RenderTimeout) {
          done("timeout");
          return failure(e.message);
        }
        done("error", (e as Error).message);
        return failure(`Error: ${(e as Error).message}`);
      }
    };
  };

  const space = z.string().min(1).optional().describe("Space prefix, for example alpha; default: the user's default space");

  server.registerTool(
    "list-spaces",
    {
      title: "List spaces",
      description: "The spaces this user may reach, with SilverBullet's access level, the access-list entries that apply, and the server's state per space.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {},
    },
    tool("list-spaces", async () => {
      const prefixes = new Set<string>(state.spaces.keys());
      if (user.defaultSpace) {
        try {
          for (const p of (await sb.config(token, user.defaultSpace)).spacePrefixes) prefixes.add(p.replace(/^\//, ""));
        } catch {}
      }
      const spaces: Array<Record<string, unknown>> = [];
      for (const s of [...prefixes].sort()) {
        let readOnly: boolean;
        try {
          readOnly = (await sb.config(token, s)).readOnly;
        } catch {
          continue; // not a member, or no such space
        }
        const entries = acl.entriesFor(user.user, user.groups, s).map((e) => ({ subject: e.subject, path: e.path, rights: rightsText(e.rights) }));
        spaces.push({ space: s, silverbullet: readOnly ? "read" : "write", accessList: entries, refusal: state.refusal(s), renderBlocked: state.renderBlock(s) });
      }
      const text = spaces.length
        ? spaces
            .map((s) => `${s.space}: SilverBullet ${s.silverbullet}; access list: ${(s.accessList as Array<{ path: string; rights: string }>).map((e) => `${e.path} ${e.rights}`).join(", ") || "no entries (nothing allowed)"}${s.refusal ? `; NOT SERVED: ${s.refusal}` : ""}${s.renderBlocked ? `; rendering blocked` : ""}`)
            .join("\n")
        : "No space is reachable with this user's token.";
      return result({ user: user.user, defaultSpace: user.defaultSpace, spaces }, text);
    }, () => undefined),
  );

  server.registerTool(
    "list-notes",
    {
      title: "List notes",
      description: "List the files of a space the user may read (pages and other files), each with the user's effective rights through this server (the access list, within what SilverBullet grants), with optional name filter and cursor paging.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        space,
        namePattern: z.string().optional().describe("JavaScript regex matched against the file name, case-insensitive"),
        limit: z.number().int().min(1).max(500).default(100),
        cursor: z.string().optional().describe("nextCursor of the previous page; keep the filters unchanged"),
      },
    },
    tool("list-notes", async ({ space: sp, namePattern, limit, cursor }) => {
      const s = resolveSpace(sp);
      serving(s);
      let files = await visible(s);
      if (namePattern) {
        const hits = await matchingNames(validRegex(namePattern, "i", "namePattern"), files);
        files = files.filter((f) => hits.has(f.name));
      }
      files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const total = files.length;
      let after = "";
      if (cursor !== undefined) {
        after = Buffer.from(cursor, "base64url").toString("utf8");
        if (!after || Buffer.from(after).toString("base64url") !== cursor) throw new Refusal("input", "Invalid cursor.");
      }
      const remaining = files.filter((f) => f.name > after);
      const page = remaining.slice(0, limit);
      const nextCursor = remaining.length > page.length ? Buffer.from(page[page.length - 1].name).toString("base64url") : null;
      // The rights shown are the effective ones, not SilverBullet's `perm` field: the access list may grant less than SilverBullet, and `perm` says `rw` even for a read-only member.
      const readOnly = page.length ? await spaceReadOnly(s) : false;
      const notes = page.map((f) => {
        const rights = effectiveRights(s, f.name, readOnly);
        return { name: f.name, rights: rightsText(rights), perm: rights.has("w") ? "rw" : "ro", size: f.size, lastModified: f.lastModified, contentType: f.contentType };
      });
      return result(
        { space: s, notes, total, nextCursor },
        `${s}: ${total} file(s)${namePattern ? ` matching /${namePattern}/i` : ""}\n${notes.map((n) => `- ${n.name} (${n.perm === "rw" ? "read-write" : "read-only"}: ${n.rights})`).join("\n")}${nextCursor ? `\nNext cursor: ${nextCursor}` : ""}`,
      );
    }),
  );

  server.registerTool(
    "read-note",
    {
      title: "Read note",
      description: "Read a file as stored (the source), with its revision for edit-note. Cheap: never starts a browser. Up to 50,000 characters by default; continue with nextOffset. For a page with its expressions, queries and transclusions evaluated, see render-note; edits are always based on this source and its revision.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        space,
        filename: z.string().min(1).describe("Page name or file name; `.md` is added when the name has no extension"),
        offset: z.number().int().min(0).default(0).describe("Character offset (UTF-16 code units)"),
        limit: z.number().int().min(1).max(100_000).default(50_000),
      },
    },
    tool("read-note", async ({ space: sp, filename, offset, limit }) => {
      const s = resolveSpace(sp);
      serving(s);
      const file = normalizeName(filename);
      need(s, file, "r");
      const r = await sb.read(token, s, file);
      const isText = file.endsWith(".md") || TEXT_TYPES.test(r.contentType);
      if (!isText) {
        const data = r.body.toString("base64");
        return result({ space: s, filename: file, revision: revisionOf(r.etag), contentType: r.contentType, encoding: "base64", content: data, totalBytes: r.body.length }, `${file}: ${r.body.length} bytes of ${r.contentType}, base64 in structuredContent.content`);
      }
      const full = r.body.toString("utf8");
      const content = full.slice(offset, offset + limit);
      const nextOffset = offset + content.length < full.length ? offset + content.length : null;
      return result({ space: s, filename: file, content, revision: revisionOf(r.etag), offset, totalCharacters: full.length, nextOffset }, content + (nextOffset !== null ? `\n[Truncated; continue with offset=${nextOffset}]` : ""));
    }),
  );

  server.registerTool(
    "read-multiple-notes",
    {
      title: "Read multiple notes",
      description: "Read several pages at once, by name or by a name pattern.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        space,
        filenames: z.array(z.string().min(1)).min(1).max(100).optional(),
        namePattern: z.string().optional().describe("JavaScript regex over file names, case-insensitive"),
        maxResults: z.number().int().min(1).max(100).default(50),
        contentLimit: z.number().int().min(1).max(100_000).default(50_000).describe("Maximum characters per note"),
      },
    },
    tool("read-multiple-notes", async ({ space: sp, filenames, namePattern, maxResults, contentLimit }) => {
      const s = resolveSpace(sp);
      serving(s);
      if (!filenames && !namePattern) throw new Refusal("input", "Give filenames or a namePattern.");
      const names = new Set<string>((filenames ?? []).map(normalizeName));
      if (namePattern) {
        for (const name of await matchingNames(validRegex(namePattern, "i", "namePattern"), await visible(s))) names.add(name);
      }
      const notes: Array<Record<string, unknown>> = [];
      for (const file of [...names].slice(0, maxResults)) {
        try {
          need(s, file, "r");
          const r = await readText(s, file);
          notes.push({ filename: file, revision: revisionOf(r.etag), content: r.text.slice(0, contentLimit), truncated: r.text.length > contentLimit, totalCharacters: r.text.length });
        } catch (e) {
          notes.push({ filename: file, error: e instanceof SbError ? sbFailure(e) : (e as Error).message });
        }
      }
      const text = notes.map((n) => (n.error ? `## ${n.filename}\nError: ${n.error}` : `## ${n.filename}\n${n.content}${n.truncated ? "\n[Truncated; use read-note to continue]" : ""}`)).join("\n\n---\n\n");
      return result({ space: s, notes, total: notes.length, errors: notes.filter((n) => n.error).length }, text || "No notes matched.");
    }),
  );

  server.registerTool(
    "search-notes",
    {
      title: "Search notes",
      description: "Full-text search over the pages the user may read, with paging.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        space,
        query: z.string().min(1).describe("Text or JavaScript regex"),
        useRegex: z.boolean().default(true),
        caseSensitive: z.boolean().default(false),
        searchType: z.enum(["content", "title", "both"]).default("both"),
        maxResults: z.number().int().min(1).max(100).default(10).describe("Notes per page"),
        page: z.number().int().min(1).default(1),
        contextLines: z.number().int().min(0).max(20).default(1),
        maxMatchesPerNote: z.number().int().min(1).max(100).default(20),
      },
    },
    tool("search-notes", async ({ space: sp, query, useRegex, caseSensitive, searchType, maxResults, page, contextLines, maxMatchesPerNote }) => {
      const s = resolveSpace(sp);
      serving(s);
      const re = validRegex(useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi", "query");
      const pages = (await visible(s)).filter((f) => f.name.endsWith(".md"));
      type Match = { type: "title" | "content"; line: number; content: string; matchCount: number; context?: string };
      const hits: Array<{ filename: string; matches: Match[]; score: number }> = [];
      const errors: Array<{ filename: string; message: string }> = [];
      // Fetch the contents on this thread, match everything in the worker, then build the results.
      const texts = new Map<string, string>();
      const items: MatchItem[] = [];
      for (const f of pages) {
        if (searchType !== "content") items.push({ id: `title\n${f.name}`, text: f.name, lines: false });
        if (searchType !== "title") {
          try {
            let text = cache.content(user.user, s, f.name, f.lastModified);
            if (text === undefined) {
              text = (await readText(s, f.name)).text;
              cache.setContent(user.user, s, f.name, f.lastModified, text);
            }
            texts.set(f.name, text);
            items.push({ id: `content\n${f.name}`, text, lines: true });
          } catch (e) {
            errors.push({ filename: f.name, message: (e as Error).message });
          }
        }
      }
      const found = new Map((await matched(re, items)).map((r) => [r.id, r]));
      for (const f of pages) {
        const matches: Match[] = [];
        const title = found.get(`title\n${f.name}`);
        if (title && title.count > 0) matches.push({ type: "title", line: 0, content: f.name, matchCount: title.count });
        const content = found.get(`content\n${f.name}`);
        if (content && content.lines) {
          const lines = texts.get(f.name)!.split("\n");
          for (const [i, n] of content.lines) {
            const from = Math.max(0, i - contextLines);
            const to = Math.min(lines.length - 1, i + contextLines);
            matches.push({ type: "content", line: i + 1, content: lines[i].trim().slice(0, 2000), matchCount: n, context: contextLines > 0 ? lines.slice(from, to + 1).join("\n").slice(0, 4000) : undefined });
          }
        }
        if (matches.length) hits.push({ filename: f.name, matches, score: matches.reduce((a, m) => a + m.matchCount, 0) });
      }
      hits.sort((a, b) => b.score - a.score);
      const totalResults = hits.length;
      const totalPages = Math.max(1, Math.ceil(totalResults / maxResults));
      const start = (page - 1) * maxResults;
      const results = hits.slice(start, start + maxResults).map((h) => ({ ...h, matchesTruncated: h.matches.length > maxMatchesPerNote, matches: h.matches.slice(0, maxMatchesPerNote) }));
      const text = totalResults === 0
        ? `No matches for "${query}" in ${s}.`
        : `SEARCH "${query}" in ${s}: ${totalResults} note(s) | page ${page}/${totalPages}\n\n` +
          results.map((r, i) => `${start + i + 1}. ${r.filename} (${r.score}x)\n` + r.matches.slice(0, 3).map((m) => (m.type === "title" ? "  • title match" : `  • L${m.line}: ${m.content.slice(0, 100)}`)).join("\n") + (r.matches.length > 3 ? `\n  • … ${r.matches.length - 3} more` : "")).join("\n") +
          (errors.length ? `\n\nWarning: ${errors.length} note(s) could not be read.` : "");
      return result({ space: s, query, results, totalResults, page, totalPages, nextPage: page < totalPages ? page + 1 : null, errors }, text);
    }),
  );

  server.registerTool(
    "create-note",
    {
      title: "Create note",
      description: "Create a page (or, where allowed, another file). Pages outside CONFIG and Library/ must hold no code and transclude nothing their reader may not read: the write filter refuses them otherwise.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: {
        space,
        filename: z.string().min(1).describe("Page name or file name; `.md` is added when the name has no extension"),
        content: z.string().max(PAGE_LIMIT),
        encoding: z.enum(["utf8", "base64"]).default("utf8").describe("base64 for binary files"),
        overwrite: z.boolean().default(false).describe("Replace an existing file; prefer edit-note for pages"),
      },
    },
    tool("create-note", async ({ space: sp, filename, content, encoding, overwrite }) => {
      const s = resolveSpace(sp);
      serving(s);
      const file = normalizeName(filename);
      notReportPage(file);
      need(s, file, "w");
      const body = encoding === "base64" ? Buffer.from(content, "base64") : content;
      const r = await createFile(s, file, body, overwrite, `${file} already exists in ${s}. Use edit-note, or overwrite=true.`);
      return result({ space: s, filename: file, revision: revisionOf(r.etag), overwrite }, `Created ${s}/${file} (revision ${revisionOf(r.etag)})`);
    }),
  );

  server.registerTool(
    "edit-note",
    {
      title: "Edit note",
      description: "Apply exact, case-sensitive edits to a page as one conditional write. expectedRevision is the revision read-note, create-note or edit-note returned (`sha256:<hex>`; the quotation marks of an ETag are accepted); a stale revision is rejected. dryRun returns the diff without writing.",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      inputSchema: {
        space,
        filename: z.string().min(1),
        edits: z
          .array(
            z
              .object({
                oldText: z.string().min(1).max(100_000).describe("Exact, case-sensitive text in the original"),
                newText: z.string().max(100_000).describe("Literal replacement"),
                expectedMatches: z.number().int().min(1).max(10_000).default(1),
              })
              .strict(),
          )
          .min(1)
          .max(100)
          .describe("Non-overlapping edits, all matched against the original content"),
        expectedRevision: z.string().min(1).describe("The revision returned by read-note or a previous dry run"),
        dryRun: z.boolean().default(false),
      },
    },
    tool("edit-note", async ({ space: sp, filename, edits, expectedRevision, dryRun }) => {
      const s = resolveSpace(sp);
      serving(s);
      const file = normalizeName(filename);
      notReportPage(file);
      need(s, file, "r", "w");
      checkFileType(file);
      const original = await readText(s, file);
      if (!original.etag || original.etag.startsWith("W/")) throw new Refusal("revision", "SilverBullet returned no strong revision; conditional editing is unavailable. Nothing was written.");
      if (!sameRevision(original.etag, expectedRevision)) {
        throw new Refusal("revision", `Revision conflict: ${file} is at ${revisionOf(original.etag)}, not ${revisionOf(expectedRevision.trim())}. Read it again before editing. Nothing was written.`);
      }
      let prepared: { content: string; counts: number[] };
      try {
        prepared = prepareEdits(original.text, edits);
      } catch (e) {
        throw new Refusal("input", (e as Error).message);
      }
      const changed = prepared.content !== original.text;
      if (prepared.content.length > PAGE_LIMIT) throw new Refusal("input", `The page would be longer than ${PAGE_LIMIT} characters. Nothing was written.`);
      if (changed) await checkContent(s, file, prepared.content);
      const { diff, truncated } = diffOf(file, original.text, prepared.content);
      let revision: string | null = revisionOf(original.etag);
      if (!dryRun && changed) {
        const w = await sb.write(token, s, file, prepared.content, { ifMatch: original.etag }).catch((e) => {
          if (e instanceof SbError && e.status === 412) throw new Refusal("revision", `Revision conflict: ${file} changed while editing. Read it again. Nothing was written.`);
          throw e;
        });
        revision = revisionOf(w.etag);
        written(s, file);
      }
      const data = { space: s, filename: file, dryRun, changed, applied: !dryRun && changed, replacements: prepared.counts, previousRevision: revisionOf(original.etag), revision, diff, diffTruncated: truncated };
      return result(data, `${dryRun ? "Preview" : changed ? "Edited" : "Unchanged"}: ${s}/${file}${!dryRun && changed ? ` (revision ${revision})` : ""}\n${diff}${truncated ? "\n[Diff truncated]" : ""}`);
    }),
  );

  server.registerTool(
    "delete-note",
    {
      title: "Delete note",
      description: "Delete a file. Needs the d right; with expectedRevision the delete is conditional (a revision is `sha256:<hex>`, as read-note returns it; the quotation marks of an ETag are accepted).",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: {
        space,
        filename: z.string().min(1),
        expectedRevision: z.string().min(1).optional(),
      },
    },
    tool("delete-note", async ({ space: sp, filename, expectedRevision }) => {
      const s = resolveSpace(sp);
      serving(s);
      const file = normalizeName(filename);
      notReportPage(file);
      need(s, file, "d");
      const given = expectedRevision === undefined ? undefined : revisionOf(expectedRevision.trim());
      if (given !== undefined && (!given || given.startsWith("W/"))) throw new Refusal("revision", `Revision conflict: ${file} is not at ${given || "an empty revision"}; a revision is sha256:<hex> as read-note returns it. Nothing was deleted.`);
      await sb.delete(token, s, file, given ? { ifMatch: `"${given}"` } : {}).catch((e) => {
        if (e instanceof SbError && e.status === 412) throw new Refusal("revision", `Revision conflict: ${file} is not at ${given}. Read it again. Nothing was deleted.`);
        throw e;
      });
      written(s, file, true);
      return result({ space: s, filename: file, deleted: true }, `Deleted ${s}/${file}`);
    }),
  );

  /** How every refusal of a proposal tool ends. */
  const PROPOSED = "Nothing was proposed.";

  /** A page a proposal may name as its target or new name (docs/proposals.md, section 4). */
  const proposable = (file: string, what: string) => {
    if (!file.endsWith(".md")) throw new Refusal("file-type", `Refused by the file-type rule: a proposal changes pages (.md) only; ${what} "${file}" is another file type.`);
    notReportPage(file);
    const page = pageNameOf(file);
    if (isCodePlace(page)) throw new Refusal("input", `${what} ${page} is CONFIG or lies in Library/, where pages are code; a proposal changes data pages only. ${PROPOSED}`);
    const why = outsideProposalFolders(page, config);
    if (why) throw new Refusal("input", `${what} ${why}; the library applies no proposal there. ${PROPOSED}`);
  };

  /**
   * What every proposal tool checks first: the space is served, the library is there in this
   * server's version, the target is a page a proposal may name, the user may read it and write
   * the proposal page, and the target is at the revision given. Returns the target as read.
   */
  const proposalStart = async (args: { space?: string; filename: string; name: string; expectedRevision: string; reason: string }) => {
    const s = resolveSpace(args.space);
    serving(s);
    const refusal = state.proposalsRefusal(s);
    if (refusal) throw new Refusal("proposals", refusal);
    if (args.reason.trim() === "") throw new Refusal("input", `The reason is empty; say why the change is proposed, for the person who reviews it. ${PROPOSED}`);
    const file = normalizeName(args.filename);
    proposable(file, "The target");
    const proposal = normalizeName(`${config.proposalsDir}${args.name.replace(/^\/+/, "")}`);
    if (!proposal.endsWith(".md")) throw new Refusal("input", `The proposal name "${args.name}" ends in a file extension; give a page name without a dot in its last part. ${PROPOSED}`);
    notReportPage(proposal);
    need(s, file, "r");
    need(s, proposal, "w");
    const original = await readText(s, file);
    if (!original.etag || original.etag.startsWith("W/")) throw new Refusal("revision", `SilverBullet returned no strong revision; a proposal cannot be tied to the target. ${PROPOSED}`);
    if (!sameRevision(original.etag, args.expectedRevision)) {
      throw new Refusal("revision", `Revision conflict: ${file} is at ${revisionOf(original.etag)}, not ${revisionOf(args.expectedRevision.trim())}. Read it again before proposing. ${PROPOSED}`);
    }
    return { s, file, page: pageNameOf(file), proposal, original, revision: revisionOf(original.etag)! };
  };

  /** Refuses a proposal the user could carry out with one of the other tools. */
  const notOwnRight = async (s: string, file: string, right: Right, use: string) => {
    if (effectiveRights(s, file, await spaceReadOnly(s)).has(right)) {
      throw new Refusal("input", `User "${user.user}" has "${right}" on ${s}/${pageNameOf(file)} and makes this change itself: use ${use}. ${PROPOSED}`);
    }
  };

  /** Writes the proposal page as the user, through the same checks as create-note; a name in use is refused. */
  const writeProposal = async (s: string, file: string, p: Proposal) => {
    const text = formatProposal(p);
    if (text.length > PAGE_LIMIT) throw new Refusal("input", `The proposal page would be longer than ${PAGE_LIMIT} characters. ${PROPOSED}`);
    const r = await createFile(s, file, text, false, `A proposal named ${pageNameOf(file)} exists already in ${s}; choose another name. ${PROPOSED}`, { control: "input", outcome: PROPOSED });
    return revisionOf(r.etag);
  };

  const proposalArgs = {
    space,
    reason: z.string().max(100_000).describe("Why the change is proposed, for the person who reviews it"),
    name: z.string().min(1).max(200).describe("The proposal page's name, inside the server's proposal folder"),
    group: z.string().min(1).max(200).optional().describe("A label shared by proposals that belong together, for example a task number; the review takes a group as one batch"),
  };
  const PROPOSAL_RULES = "None writes the target: the proposal page is written to the server's proposal folder, where a person reviews it and applies it with their own rights. Needs r on the target and w on the proposal page; the target must be at expectedRevision.";

  server.registerTool(
    "propose-edit",
    {
      title: "Propose edit",
      description: `Propose edits to a page the user may not write, with the arguments of edit-note: tested against the page as it is now (every old text found as often as expected, no overlap, the result passes the write filter), and answered with the diff. ${PROPOSAL_RULES} A user who may write the page uses edit-note.`,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: {
        ...proposalArgs,
        filename: z.string().min(1).describe("The target page"),
        edits: z
          .array(
            z
              .object({
                oldText: z.string().min(1).max(100_000).describe("Exact, case-sensitive text in the target"),
                newText: z.string().max(100_000).describe("Literal replacement; may be empty"),
                expectedMatches: z.number().int().min(1).max(10_000).default(1),
              })
              .strict(),
          )
          .min(1)
          .max(100)
          .describe("Non-overlapping edits, all matched against the target as it is"),
        expectedRevision: z.string().min(1).describe("The target's revision, as read-note returns it"),
      },
    },
    tool("propose-edit", async (args) => {
      const { s, file, page, proposal, original, revision } = await proposalStart(args);
      await notOwnRight(s, file, "w", "edit-note");
      let prepared: { content: string; counts: number[] };
      try {
        prepared = prepareEdits(original.text, args.edits as Edit[], PROPOSED);
      } catch (e) {
        throw new Refusal("input", (e as Error).message);
      }
      if (prepared.content === original.text) throw new Refusal("input", `The edits change nothing. ${PROPOSED}`);
      if (prepared.content.length > PAGE_LIMIT) throw new Refusal("input", `The page would be longer than ${PAGE_LIMIT} characters. ${PROPOSED}`);
      await checkContent(s, file, prepared.content, PROPOSED);
      const { diff, truncated } = diffOf(file, original.text, prepared.content);
      const proposalRevision = await writeProposal(s, proposal, { action: "edit", target: page, revision, reason: args.reason, group: args.group, edits: args.edits as Edit[] });
      const data = { space: s, proposal: pageNameOf(proposal), action: "edit", target: page, targetRevision: revision, revision: proposalRevision, replacements: prepared.counts, diff, diffTruncated: truncated };
      return result(data, `Proposed: ${s}/${pageNameOf(proposal)} edits ${page}\n${diff}${truncated ? "\n[Diff truncated]" : ""}`);
    }),
  );

  server.registerTool(
    "propose-delete",
    {
      title: "Propose delete",
      description: `Propose deleting a page the user may not delete; answered with the page's text as a diff. ${PROPOSAL_RULES} A user who may delete the page uses delete-note.`,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: {
        ...proposalArgs,
        filename: z.string().min(1).describe("The page to delete"),
        expectedRevision: z.string().min(1).describe("The page's revision, as read-note returns it"),
      },
    },
    tool("propose-delete", async (args) => {
      const { s, file, page, proposal, original, revision } = await proposalStart(args);
      await notOwnRight(s, file, "d", "delete-note");
      const { diff, truncated } = diffOf(file, original.text, "");
      const proposalRevision = await writeProposal(s, proposal, { action: "delete", target: page, revision, reason: args.reason, group: args.group });
      const data = { space: s, proposal: pageNameOf(proposal), action: "delete", target: page, targetRevision: revision, revision: proposalRevision, diff, diffTruncated: truncated };
      return result(data, `Proposed: ${s}/${pageNameOf(proposal)} deletes ${page}\n${diff}${truncated ? "\n[Diff truncated]" : ""}`);
    }),
  );

  server.registerTool(
    "propose-move",
    {
      title: "Propose move",
      description: `Propose moving (renaming) a page, which also updates the links to it when applied; this is how a new page written where the user may write gets to its place. Nothing may exist under the new name, and the page must pass the write filter there. ${PROPOSAL_RULES}`,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: {
        ...proposalArgs,
        filename: z.string().min(1).describe("The page to move"),
        newName: z.string().min(1).describe("The page's new name"),
        expectedRevision: z.string().min(1).describe("The page's revision, as read-note returns it"),
      },
    },
    tool("propose-move", async (args) => {
      const { s, file, page, proposal, original, revision } = await proposalStart(args);
      const to = normalizeName(args.newName);
      proposable(to, "The new name");
      if (to === file) throw new Refusal("input", `The new name is the page's name. ${PROPOSED}`);
      // Whether a page exists is told only where the user may read.
      need(s, to, "r");
      const taken = await sb.read(token, s, to).then(
        () => true,
        (e) => {
          if (e instanceof SbError && e.status === 404) return false;
          throw e;
        },
      );
      if (taken) throw new Refusal("input", `${s}/${pageNameOf(to)} exists already; a move cannot replace a page. ${PROPOSED}`);
      await checkContent(s, to, original.text, PROPOSED);
      const proposalRevision = await writeProposal(s, proposal, { action: "move", target: page, to: pageNameOf(to), revision, reason: args.reason, group: args.group });
      const data = { space: s, proposal: pageNameOf(proposal), action: "move", target: page, to: pageNameOf(to), targetRevision: revision, revision: proposalRevision };
      return result(data, `Proposed: ${s}/${pageNameOf(proposal)} moves ${page} to ${pageNameOf(to)}`);
    }),
  );

  /** What both render tools check before the runtime is touched: served, a page, `x`, no scan findings in the space, and the page exists. */
  const renderable = async (sp: string | undefined, filename: string) => {
    const s = resolveSpace(sp);
    serving(s);
    const file = normalizeName(filename);
    if (!file.toLowerCase().endsWith(".md")) throw new Refusal("file-type", `Refused by the file-type rule: only pages (.md) are rendered; "${file}" is another file type. Use read-note.`);
    need(s, file, "x");
    const block = state.renderBlock(s);
    if (block) throw new Refusal("render-block", block);
    // The source read first: SilverBullet's own 403/404 for the page come back here, before a browser starts.
    await sb.read(token, s, file);
    return { s, file, page: pageNameOf(file) };
  };

  /**
   * The render check (docs/security.md, section 12): what the render loaded, judged against the
   * caller's `r` rights before anything is returned. Fails closed when the loads cannot be trusted.
   */
  const verifyLoads = (space: string, file: string) => (loads: Loads) => {
    const { blind, denied } = judgeLoads(loads, file, (f) => rightsOn(space, f).has("r"));
    if (blind) {
      throw new Refusal("render-check", `Refused by the render check: cannot verify what the render loaded (${blind}). Nothing was returned. SilverBullet's client may have changed how it reads pages; operator: see docs/security.md, section 12, and the release checks.`);
    }
    if (denied.length) {
      const list = denied.map((f) => `${space}/${pageNameOf(f)}: user "${user.user}" has no "r"`).join("; ");
      throw new Refusal("render-check", `Refused by the render check: the render loaded what its reader may not read (${list}). Nothing was returned. A render shows what SilverBullet lets this user see; this server returns it only when the access list lets the user read it (docs/security.md, section 12).`);
    }
  };

  const RENDER_RULES = "Needs the x right; pages (.md) only; refused while the scan has findings in the space. For reading only: it returns no revision; edits are always based on read-note's source and its revision. The first call starts a headless browser for this user and space inside SilverBullet (about 200 MiB, kept until SilverBullet restarts), later calls are fast. Runs with the user's full SilverBullet rights; the result is refused when the render loaded a page or file (a transclusion, an image) the user has no r on in the access list. Query results come from SilverBullet's index and are not checked.";

  server.registerTool(
    "render-note",
    {
      title: "Render note",
      description: `Render a page as the user sees it: \${…} expressions, query[[…]] results, templates and ![[transclusions]] evaluated by SilverBullet's Runtime API as this user. Query results come back as HTML tables. ${RENDER_RULES}`,
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        space,
        filename: z.string().min(1).describe("Page name; `.md` is added when the name has no extension"),
      },
    },
    tool("render-note", async ({ space: sp, filename }) => {
      const { s, file, page } = await renderable(sp, filename);
      const r = await renderer.render(user, s, page, verifyLoads(s, file));
      const data = { space: s, filename: file, content: r.markdown, totalCharacters: r.markdown.length, loaded: r.loaded, warnings: r.warnings, queuedMs: r.queuedMs, indexWaitMs: r.indexWaitMs, rebooted: r.rebooted };
      return result(data, r.markdown + (r.warnings.length ? `\n\n[Warning: ${r.warnings.join(" ")}]` : ""));
    }),
  );

  server.registerTool(
    "screenshot-note",
    {
      title: "Screenshot note",
      description: `A PNG of a page as SilverBullet shows it in its editor, taken by SilverBullet's Runtime API as this user. selector clips the image to the first matching element (for example #sb-editor); fullPage asks for the whole page where the instance supports it (SilverBullet 2.12.1 ignores it). ${RENDER_RULES}`,
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        space,
        filename: z.string().min(1).describe("Page name; `.md` is added when the name has no extension"),
        selector: z.string().min(1).max(300).optional().describe("CSS selector to clip to"),
        fullPage: z.boolean().default(false),
      },
    },
    tool("screenshot-note", async ({ space: sp, filename, selector, fullPage }) => {
      const { s, file, page } = await renderable(sp, filename);
      const r = await renderer.screenshot(user, s, page, { selector, fullPage }, verifyLoads(s, file));
      const data = { space: s, filename: file, mimeType: "image/png", bytes: r.png.length, width: r.width, height: r.height, selector: selector ?? null, fullPage, loaded: r.loaded, warnings: r.warnings, queuedMs: r.queuedMs, indexWaitMs: r.indexWaitMs, rebooted: r.rebooted };
      return {
        content: [
          { type: "text", text: `Screenshot of ${s}/${page}: ${r.width}x${r.height} PNG, ${r.png.length} bytes${selector ? `, clipped to ${selector}` : ""}${r.warnings.length ? `\n[Warning: ${r.warnings.join(" ")}]` : ""}` },
          { type: "image", data: r.png.toString("base64"), mimeType: "image/png" },
        ],
        structuredContent: data,
      };
    }),
  );
}
