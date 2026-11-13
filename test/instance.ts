// node test/instance.ts up|down|env
//
// The SilverBullet test instance of this working copy. The compose project
// name and the port come from the working copy, so two working copies (several
// agents, or a person and an agent) never share an instance:
//
//   branch claude/task-<id>-…   project sbmcp-test-<id>, port 10000+<id> (ids up to 29999)
//   any other linked worktree   project sbmcp-test-<hash of the path>, port 40000-59999
//   a plain clone, and CI       project sbmcp-test, port 3300
//
// `up` records the instance in test/.state/env; `down` and `env` read it from
// there, so they act on the instance `up` started even after a branch switch.
// COMPOSE_PROJECT_NAME and SB_PORT in the environment win over all of this.
//
//   up    starts the instance, bootstraps it unless test/.state/env is current,
//         and writes test/.state/env; with SB_URL set it does nothing: that
//         instance is yours
//   down  removes the instance with its volume (down -v) and test/.state
//   env   prints the project, port, URL and container name as KEY=value lines

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const COMPOSE_FILE = fileURLToPath(new URL("./compose.yaml", import.meta.url));
// Not imported from lib/env.ts: that module reads the state when it is loaded, which must happen after `up`.
const STATE_DIR = fileURLToPath(new URL("./.state/", import.meta.url));
const STATE_FILE = `${STATE_DIR}env`;

export const DEFAULT_PROJECT = "sbmcp-test";
export const DEFAULT_PORT = 3300;

export type Instance = { project: string; port: number; url: string; container: string };

function git(...args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

const instanceOf = (project: string, port: number): Instance => ({ project, port, url: `http://127.0.0.1:${port}`, container: `${project}-silverbullet-1` });

/** The instance this working copy gets by its branch or path. */
export function derive(): Instance {
  let project = DEFAULT_PROJECT;
  let port = DEFAULT_PORT;
  if (process.env.GITHUB_ACTIONS !== "true") {
    const task = git("branch", "--show-current").match(/^claude\/task-(\d+)(?:-|$)/)?.[1];
    const linked = git("rev-parse", "--git-dir") !== git("rev-parse", "--git-common-dir");
    if (task && Number(task) <= 29999) {
      project = `${DEFAULT_PROJECT}-${task}`;
      port = 10000 + Number(task);
    } else if (task || linked) {
      const n = createHash("sha256").update(ROOT).digest().readUInt32BE(0);
      project = `${DEFAULT_PROJECT}-${n.toString(16).slice(0, 6)}`;
      port = 40000 + (n % 20000);
    }
  }
  return instanceOf(process.env.COMPOSE_PROJECT_NAME || project, Number(process.env.SB_PORT) || port);
}

function readState(): Record<string, string> | undefined {
  if (!existsSync(STATE_FILE)) return undefined;
  const state: Record<string, string> = {};
  for (const line of readFileSync(STATE_FILE, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) state[m[1]] = m[2];
  }
  return state;
}

/** The state of an instance that `up` of this working copy wrote: the tokens, and whose they are. */
function ownState() {
  const state = readState();
  return state?.SB_ROOT === ROOT && state.SB_PROJECT && state.SB_PORT ? state : undefined;
}

/** The instance of this working copy: the one `up` started (test/.state/env) if there is one, else the derived one. */
export function current(): Instance {
  const state = ownState();
  if (!state) return derive();
  return instanceOf(process.env.COMPOSE_PROJECT_NAME || state.SB_PROJECT, Number(process.env.SB_PORT) || Number(state.SB_PORT));
}

function compose(inst: Instance, ...args: string[]) {
  const r = spawnSync("docker", ["compose", "-p", inst.project, "-f", COMPOSE_FILE, ...args], {
    stdio: "inherit",
    env: { ...process.env, SB_PORT: String(inst.port) },
  });
  if (r.status !== 0) throw new Error(`docker compose ${args.join(" ")} failed (${r.error?.message ?? r.status ?? r.signal})`);
}

/** Do the tokens in the state answer on this instance? */
async function stateIsCurrent(inst: Instance): Promise<boolean> {
  const state = ownState();
  if (!state || state.SB_URL !== inst.url || state.SB_PROJECT !== inst.project) return false;
  const { client } = await import("./lib/sb.ts");
  const sb = client(inst.url);
  const probes = { ADMIN: "alpha", ALICE: "alpha", BOB: "beta", DORA: "delta", SCAN: "alpha" };
  try {
    for (const [user, space] of Object.entries(probes)) {
      const token = state[`SB_TOKEN_${user}`];
      if (!token || (await sb.config(token, space)).status !== 200) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Bootstraps the instance at inst.url and records in test/.state/env which instance it is. */
export async function bootstrapInstance(inst: Instance) {
  // The modules below read the state when they are loaded.
  process.env.SB_URL ??= inst.url;
  const { bootstrap } = await import("./lib/bootstrap.ts");
  await bootstrap({ url: inst.url, extraEnv: { SB_PROJECT: inst.project, SB_PORT: String(inst.port), SB_CONTAINER: inst.container, SB_ROOT: ROOT } });
}

/** Starts the instance (a no-op if it runs), bootstraps it unless the state is current, and returns it. */
export async function up(): Promise<Instance> {
  const inst = current();
  // A test/.state copied from another working copy holds that instance's tokens: start from nothing.
  if (existsSync(STATE_FILE) && !ownState()) rmSync(STATE_DIR, { recursive: true, force: true });
  compose(inst, "up", "-d", "--wait");
  if (!(await stateIsCurrent(inst))) await bootstrapInstance(inst);
  return inst;
}

/** Removes the instance with its volume, and the tokens that belonged to it (test/.state). */
export function down() {
  compose(current(), "down", "-v");
  rmSync(STATE_DIR, { recursive: true, force: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === "up" && process.env.SB_URL) {
    console.log(`SB_URL is set: using the instance at ${process.env.SB_URL}, nothing started`);
  } else if (cmd === "up") {
    const inst = await up();
    console.log(`instance ${inst.project} at ${inst.url}`);
  } else if (cmd === "down") {
    down();
  } else if (cmd === "env") {
    const inst = current();
    console.log([`COMPOSE_PROJECT_NAME=${inst.project}`, `SB_PORT=${inst.port}`, `SB_URL=${inst.url}`, `SB_CONTAINER=${inst.container}`].join("\n"));
  } else {
    console.error("usage: node test/instance.ts up|down|env");
    process.exit(2);
  }
}
