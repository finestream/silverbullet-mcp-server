// The write filter in a worker thread with a time limit (docs/security.md, section 5). The
// Markdown parser is quadratic on some inputs: a page of 20 000 `![a](` (100 KB) takes seconds to
// parse, 1 MB minutes, and the server's single thread would answer nobody meanwhile. So the parse
// and the code rules (`analysePage`) run in a worker, as match.ts does for regular expressions, and
// a check that exceeds the limit ends the worker and is refused: the page is undecidable. The
// transclusion rule needs the access list, so it is applied here, on what the worker found.
//
// One worker, started on first use and kept, so that the scan does not load the parsers once per
// page; the checks go through it one at a time, so a check waits for the one before it, at most the
// limit. After a timeout or a crash the next check starts a fresh worker.

import { Worker } from "node:worker_threads";
import type { Allowlist } from "./allowlist.ts";
import { verdictOf, type Analysis, type TransclusionCheck, type Verdict } from "./filter.ts";

/** The time limit of one check, in ms. The 50 KB benchmark page takes about 7 ms; 1 MB of the same text about 200 ms. */
export const CHECK_TIMEOUT = 2000;

export class CheckTimeout extends Error {
  constructor(ms: number) {
    super(`the check took more than ${ms} ms: the page's Markdown is too costly to parse, so whether it holds code is undecidable`);
    this.name = "CheckTimeout";
  }
}

export type CheckRequest = { id: number; source: string; entries: readonly string[] };
export type CheckReply = { id: number; analysis: Analysis };

type Pending = { req: CheckRequest; timeoutMs: number; resolve(a: Analysis): void; reject(e: Error): void };

export class Checker {
  private worker: Worker | null = null;
  private readonly queue: Pending[] = [];
  private busy: Pending | null = null;
  private timer: NodeJS.Timeout | null = null;
  private nextId = 1;

  /** The analysis of a page by the worker; rejects with CheckTimeout when it takes more than `timeoutMs`. */
  analyse(source: string, allow: Allowlist, timeoutMs = CHECK_TIMEOUT): Promise<Analysis> {
    return new Promise((resolve, reject) => {
      this.queue.push({ req: { id: this.nextId++, source, entries: allow.entries }, timeoutMs, resolve, reject });
      this.next();
    });
  }

  /** The filter's verdict on a page, the transclusion rule included; rejects with CheckTimeout. */
  async check(source: string, allow: Allowlist, transclusion?: TransclusionCheck, timeoutMs = CHECK_TIMEOUT): Promise<Verdict> {
    return verdictOf(source, await this.analyse(source, allow, timeoutMs), transclusion);
  }

  private next() {
    if (this.busy || this.queue.length === 0) return;
    this.busy = this.queue.shift()!;
    // The timer keeps the process alive while a check runs; the worker itself is unref'd, so an
    // idle one does not keep `--scan` or a test from exiting. A fresh worker spends its first
    // 100 ms or so loading the parsers; that counts against the first check's limit.
    this.timer = setTimeout(() => this.fail(new CheckTimeout(this.busy!.timeoutMs)), this.busy.timeoutMs);
    this.ensureWorker().postMessage(this.busy.req);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./check-worker.ts", import.meta.url));
    worker.on("message", (reply: CheckReply) => {
      if (this.busy && reply.id === this.busy.req.id) this.done(reply.analysis);
    });
    worker.on("error", (e) => this.fail(e));
    worker.on("exit", () => {
      // Ended on its own (fail() has already forgotten a worker it terminated).
      if (this.worker === worker) {
        this.worker = null;
        this.fail(new Error("the filter worker exited"));
      }
    });
    worker.unref();
    this.worker = worker;
    return worker;
  }

  private settle(): Pending {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const pending = this.busy!;
    this.busy = null;
    return pending;
  }

  private done(analysis: Analysis) {
    const pending = this.settle();
    pending.resolve(analysis);
    this.next();
  }

  /** The current check failed; the worker is in an unknown state and is replaced for the next one. */
  private fail(e: Error) {
    if (!this.busy) return;
    const pending = this.settle();
    const worker = this.worker;
    this.worker = null;
    if (worker) void worker.terminate();
    pending.reject(e);
    this.next();
  }
}

const shared = new Checker();

/** `checkPage` with the time limit, through the server's one worker; rejects with CheckTimeout. */
export function checkPageLimited(source: string, allow: Allowlist, transclusion?: TransclusionCheck): Promise<Verdict> {
  return shared.check(source, allow, transclusion);
}
