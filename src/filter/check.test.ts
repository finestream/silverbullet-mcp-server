import test from "node:test";
import assert from "node:assert/strict";
import { Checker, CheckTimeout, CHECK_TIMEOUT, checkPageLimited } from "./check.ts";
import { checkPage } from "./filter.ts";
import { cases, matrixReader } from "./cases.ts";
import { shippedAllowlist } from "./allowlist.ts";

/** A page the Markdown parser is quadratic on: `n` image openers that never close (5 characters each). */
const slow = (n: number) => "![a](".repeat(n);

/**
 * Runs `work` beside a 20 ms timer on the main thread and reports how late the timer fired: on
 * time means the thread was free to answer other requests while the check ran.
 */
async function withMainThread<T>(work: Promise<T>): Promise<{ result: PromiseSettledResult<T>; late: number }> {
  const t0 = performance.now();
  const tick = new Promise<number>((r) => setTimeout(() => r(performance.now() - t0 - 20), 20));
  const [[result], late] = await Promise.all([Promise.allSettled([work]), tick]);
  return { result, late };
}

test("check: through the worker, every case of the matrix gets the verdict checkPage gives, transclusions included", async () => {
  const allow = shippedAllowlist();
  const checker = new Checker();
  const wrong: string[] = [];
  for (const c of cases) {
    const direct = checkPage(c.page, allow, matrixReader);
    const limited = await checker.check(c.page, allow, matrixReader);
    if (JSON.stringify(limited) !== JSON.stringify(direct)) wrong.push(`${c.id} ${c.name}`);
  }
  assert.deepEqual(wrong, []);
});

test("check: a 100 KB page the Markdown parser is quadratic on ends within the limit, with the main thread free meanwhile", async () => {
  // About 3 s to parse on a 2024 laptop, so refused there; a faster machine may decide it in time,
  // and then the page is what it is, data. Either way the check ends within the limit.
  const allow = shippedAllowlist();
  const t0 = performance.now();
  const { result, late } = await withMainThread(checkPageLimited(slow(20_000), allow));
  const ms = performance.now() - t0;
  if (result.status === "rejected") assert.ok(result.reason instanceof CheckTimeout, String(result.reason));
  else assert.ok(result.value.ok, "the page holds no code");
  assert.ok(ms < CHECK_TIMEOUT + 1000, `${Math.round(ms)} ms`);
  assert.ok(late < 500, `a 20 ms timer on the main thread fired ${Math.round(late)} ms late`);
});

test("check: a 1 MB page of the same shape (minutes to parse) is refused after the limit; the main thread is free meanwhile, and the next check is answered", async () => {
  const allow = shippedAllowlist();
  const checker = new Checker();
  const t0 = performance.now();
  const { result, late } = await withMainThread(checker.check(slow(199_999), allow)); // 999 995 characters: under the page limit
  const ms = performance.now() - t0;
  assert.equal(result.status, "rejected");
  assert.ok((result as PromiseRejectedResult).reason instanceof CheckTimeout);
  assert.match((result as PromiseRejectedResult).reason.message, /^the check took more than 2000 ms/);
  assert.ok(ms >= CHECK_TIMEOUT && ms < CHECK_TIMEOUT + 1000, `${Math.round(ms)} ms`);
  assert.ok(late < 500, `a 20 ms timer on the main thread fired ${Math.round(late)} ms late`);
  // The worker was ended; a fresh one answers the next check, with the same verdict as checkPage.
  const page = "# Fine\n\nText ${1 + 1} and ${space.readPage(\"CONFIG\")}\n";
  assert.deepEqual(await checker.check(page, allow), checkPage(page, allow));
});

test("check: a short limit refuses a page the default limit accepts; checks queued behind a refused one are still answered", async () => {
  const allow = shippedAllowlist();
  const checker = new Checker();
  const page = slow(5_000); // about 200 ms to parse
  const [short, after] = await Promise.allSettled([checker.check(page, allow, undefined, 20), checker.check("Plain text\n", allow)]);
  assert.equal(short.status, "rejected");
  assert.ok((short as PromiseRejectedResult).reason instanceof CheckTimeout);
  assert.equal(after.status, "fulfilled");
  assert.ok((after as PromiseFulfilledResult<{ ok: boolean }>).value.ok);
});
