// The worker of check.ts: parses and analyses one page per message, with the allowlist compiled
// from the entries it was sent. Terminated by the main thread when a check takes too long.

import { parentPort } from "node:worker_threads";
import { compileAllowlist } from "./allowlist.ts";
import { analysePage } from "./filter.ts";
import type { CheckReply, CheckRequest } from "./check.ts";

parentPort!.on("message", (req: CheckRequest) => {
  const reply: CheckReply = { id: req.id, analysis: analysePage(req.source, compileAllowlist(req.entries)) };
  parentPort!.postMessage(reply);
});
