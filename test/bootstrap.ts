// node test/bootstrap.ts   — bootstrap the instance at SB_URL (default: the instance of this
// working copy, see test/instance.ts) with SB_ADMIN_PASSWORD (default admin-test-password).
// node test/instance.ts up starts the instance and does this too.
import { bootstrap } from "./lib/bootstrap.ts";
import { derive } from "./instance.ts";

await bootstrap({ url: process.env.SB_URL ?? derive().url });
