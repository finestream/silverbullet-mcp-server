// node test/run.ts [pattern ...]
//
// Runs the release checks against a SilverBullet instance and writes a report
// per version to test/report/<version>.md. Without SB_URL it is the instance of
// this working copy (test/instance.ts), started and bootstrapped if needed; with
// SB_URL it is that instance, bootstrapped with SB_ADMIN_PASSWORD (default
// admin-test-password) first, which is idempotent. Patterns select check files by
// substring, for example `node test/run.ts index parser`.
//
// Exit code: 1 if any assumption failed or changed, else 0.

import { run } from "node:test";
import { spec } from "node:test/reporters";
import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, basename } from "node:path";
import { up } from "./instance.ts";

const started = !process.env.SB_URL;
const url = process.env.SB_URL ?? (await up()).url;
// The check files and lib/env.ts read the state when they are loaded: only now.
const { bootstrap } = await import("./lib/bootstrap.ts");
const { REPORT_DIR, loadEnv } = await import("./lib/env.ts");
const reachable = await fetch(`${url}/.dashboard/api/admin/spaces`).then((r) => r.status === 401 || r.status === 200, () => false);
if (!reachable) {
  console.error(`No SilverBullet at ${url}. Start one with node test/instance.ts up, or set SB_URL.`);
  process.exit(2);
}

try {
  if (!started) await bootstrap({ url });
} catch (e) {
  const haveState = loadEnv().SB_TOKEN_ALICE;
  if (!haveState) throw e;
  console.log(`bootstrap skipped (${(e as Error).message.split("\n")[0]}); using the tokens in test/.state/env`);
}

// The tokens are read by the check files at import; make sure the state is loaded fresh there.
const { version, semver } = await import("./lib/env.ts");
const sbVersion = await version();
console.log(`SilverBullet ${sbVersion} at ${url}`);

const checksDir = fileURLToPath(new URL("./checks/", import.meta.url));
const patterns = process.argv.slice(2);
const files = readdirSync(checksDir)
  .filter((f) => f.endsWith(".test.ts"))
  .filter((f) => patterns.length === 0 || patterns.some((p) => f.includes(p)))
  .sort()
  .map((f) => join(checksDir, f));

type Row = { file: string; name: string; result: "pass" | "fail" | "skip" | "changed"; ms: number; note: string };
const rows: Row[] = [];
const measurements: string[] = [];

const stream = run({ files, concurrency: 1, timeout: 20 * 60 * 1000 });
stream.on("test:pass", (d) => {
  if (d.nesting === 0) rows.push({ file: basename(d.file ?? ""), name: d.name, result: d.skip ? "skip" : "pass", ms: d.details.duration_ms, note: typeof d.skip === "string" ? d.skip : "" });
});
stream.on("test:fail", (d) => {
  if (d.nesting !== 0) return;
  const err = d.details.error as Error & { cause?: Error };
  const message = (err?.cause?.message ?? err?.message ?? String(err)).split("\n")[0];
  rows.push({ file: basename(d.file ?? ""), name: d.name, result: d.name.startsWith("[watch]") ? "changed" : "fail", ms: d.details.duration_ms, note: message });
});
stream.on("test:diagnostic", (d) => {
  if (d.message.startsWith("measure:")) measurements.push(d.message.slice("measure:".length).trim());
});
stream.compose(spec()).pipe(process.stdout);
await new Promise<void>((resolve) => stream.once("end", resolve));

const counts = { pass: 0, fail: 0, skip: 0, changed: 0 };
for (const r of rows) counts[r.result]++;

const reportDir = fileURLToPath(REPORT_DIR);
mkdirSync(reportDir, { recursive: true });
const reportFile = join(reportDir, `${semver(sbVersion)}.md`);
const date = new Date().toISOString().slice(0, 10);
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const lines = [
  `# Release checks: SilverBullet ${sbVersion}`,
  "",
  `Run on ${date} against \`${url}\`. ${counts.pass} passed, ${counts.fail} failed, ${counts.changed} changed, ${counts.skip} skipped.`,
  "",
  "*changed* marks a `[watch]` assumption: a limitation the design works around that no longer holds in this release; the workaround may be unnecessary, and the documents that describe it need a look.",
  "",
  "| Group | Assumption | Result | Note |",
  "|---|---|---|---|",
  ...rows.map((r) => `| ${r.file.replace(/^\d+-|\.test\.ts$/g, "")} | ${esc(r.name)} | ${r.result} | ${esc(r.note)} |`),
  "",
];
if (measurements.length) {
  lines.push("## Measurements", "", "| Measurement | Value |", "|---|---|", ...measurements.map((m) => `| ${esc(m.split("=")[0].trim())} | ${esc(m.split("=").slice(1).join("=").trim())} |`), "");
}
writeFileSync(reportFile, lines.join("\n"));
console.log(`\nreport: ${reportFile}  (${counts.pass} passed, ${counts.fail} failed, ${counts.changed} changed, ${counts.skip} skipped)`);
process.exit(counts.fail + counts.changed > 0 ? 1 : 0);
