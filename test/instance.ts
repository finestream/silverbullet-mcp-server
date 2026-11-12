// node test/instance.ts up|down|env
//
// The SilverBullet test instance of this working copy. The compose project
// name and the port come from the working copy, so two working copies (several
// agents, or a person and an agent) never share an instance:
//
//   branch claude/task-<id>-…   project sbmcp-test-<id>, port 10000+<id> (ids up to 55535)
//   another linked worktree     project sbmcp-test-<hash of the path>, port 20000-39999
//   a plain clone, and CI       project sbmcp-test, port 3300
//
// COMPOSE_PROJECT_NAME and SB_PORT in the environment win over all of these.
//
//   up    starts the instance, bootstraps it and writes test/.state/env
//   down  removes the instance with its volume (down -v) and test/.state/env
//   env   prints the project, port, URL and container name as KEY=value lines

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const COMPOSE_FILE = fileURLToPath(new URL("./compose.yaml", import.meta.url));
// Not imported from lib/env.ts: that module reads the state when it is loaded, which must happen after `up`.
const STATE_FILE = new URL("./.state/env", import.meta.url);

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

/** The instance of this working copy. */
export function derive(): Instance {
  let project = DEFAULT_PROJECT;
  let port = DEFAULT_PORT;
  if (process.env.GITHUB_ACTIONS !== "true") {
    const task = git("branch", "--show-current").match(/^claude\/task-(\d+)(?:-|$)/)?.[1];
    const linked = git("rev-parse", "--git-dir") !== git("rev-parse", "--git-common-dir");
    if (task && 10000 + Number(task) <= 65535) {
      project = `${DEFAULT_PROJECT}-${task}`;
      port = 10000 + Number(task);
    } else if (linked) {
      const n = createHash("sha256").update(ROOT).digest().readUInt32BE(0);
      project = `${DEFAULT_PROJECT}-${n.toString(16).slice(0, 6)}`;
      port = 20000 + (n % 20000);
    }
  }
  project = process.env.COMPOSE_PROJECT_NAME || project;
  port = Number(process.env.SB_PORT) || port;
  return { project, port, url: `http://127.0.0.1:${port}`, container: `${project}-silverbullet-1` };
}

function compose(inst: Instance, ...args: string[]) {
  const r = spawnSync("docker", ["compose", "-p", inst.project, "-f", COMPOSE_FILE, ...args], {
    stdio: "inherit",
    env: { ...process.env, SB_PORT: String(inst.port) },
  });
  if (r.status !== 0) throw new Error(`docker compose ${args.join(" ")} failed (${r.status ?? r.signal})`);
}

/** Starts the instance (a no-op if it runs), bootstraps it and writes this working copy's test/.state/env. */
export async function up(inst: Instance = derive()): Promise<Instance> {
  // Tokens of another instance (a copied test/.state) are of no use here: start from nothing.
  if (existsSync(STATE_FILE) && !readFileSync(STATE_FILE, "utf8").split("\n").includes(`SB_URL=${inst.url}`)) rmSync(STATE_FILE);
  compose(inst, "up", "-d", "--wait");
  const { bootstrap } = await import("./lib/bootstrap.ts");
  await bootstrap({ url: inst.url });
  writeFileSync(STATE_FILE, readFileSync(STATE_FILE, "utf8") + `SB_CONTAINER=${inst.container}\n`);
  return inst;
}

/** Removes the instance with its volume, and the tokens that belonged to it. */
export function down(inst: Instance = derive()) {
  compose(inst, "down", "-v");
  rmSync(STATE_FILE, { force: true });
}

if (import.meta.main) {
  const cmd = process.argv[2];
  const inst = derive();
  if (cmd === "up") {
    await up(inst);
    console.log(`instance ${inst.project} at ${inst.url}`);
  } else if (cmd === "down") {
    down(inst);
  } else if (cmd === "env") {
    console.log([`COMPOSE_PROJECT_NAME=${inst.project}`, `SB_PORT=${inst.port}`, `SB_URL=${inst.url}`, `SB_CONTAINER=${inst.container}`].join("\n"));
  } else {
    console.error("usage: node test/instance.ts up|down|env");
    process.exit(2);
  }
}
