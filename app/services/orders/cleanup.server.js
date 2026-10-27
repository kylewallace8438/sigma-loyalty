import db from "../../db.server";
import logger from "../../logger.server";

const DAY_MS = 24 * 60 * 60 * 1000;
// Small batches keep each DELETE short, so it never holds locks on the table for long.
const BATCH_SIZE = 5000;

/** Deletes orders created in Shopify more than `retentionDays` ago, across all shops. Returns the count. */
export async function deleteOldOrders(retentionDays, now = new Date()) {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  let deleted = 0;
  for (;;) {
    const batch = await db.order.findMany({
      where: { shopifyCreatedAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { shopifyCreatedAt: "asc" },
      take: BATCH_SIZE,
    });
    if (!batch.length) break;
    const { count } = await db.order.deleteMany({ where: { id: { in: batch.map((o) => o.id) } } });
    deleted += count;
    if (batch.length < BATCH_SIZE) break;
  }
  return deleted;
}

// Runs deleteOldOrders once at startup, then daily. ORDER_RETENTION_DAYS defaults to 30.
// Guarded on `global` so dev hot reloads don't start a second timer.
export function scheduleOrderCleanup() {
  if (global.orderCleanupTimer) return;
  const retentionDays = Number(process.env.ORDER_RETENTION_DAYS) || 30;
  const run = () =>
    deleteOldOrders(retentionDays)
      .then((count) => logger.info({ count, retentionDays }, "Deleted old orders"))
      .catch((err) => logger.error({ err }, "Order cleanup failed"));
  run();
  global.orderCleanupTimer = setInterval(run, DAY_MS).unref();
}
