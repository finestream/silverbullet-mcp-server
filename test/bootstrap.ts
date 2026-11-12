// node test/bootstrap.ts   — bootstrap the instance at SB_URL, or this working copy's instance
// (see test/instance.ts) with SB_ADMIN_PASSWORD (default admin-test-password).
// node test/instance.ts up starts the instance and does this unless it is current.
import { bootstrapInstance, current } from "./instance.ts";

if (process.env.SB_URL) {
  const { bootstrap } = await import("./lib/bootstrap.ts");
  await bootstrap();
} else {
  await bootstrapInstance(current());
}
