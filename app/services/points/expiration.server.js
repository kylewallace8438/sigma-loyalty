import db from "../../db.server";
import logger from "../../logger.server";
import { getSettings } from "../settings/settings.server";
import { applyPoints } from "./points.server";
import { canUse } from "../billing/plan.server";

const BATCH_SIZE = 500;

/**
 * Expires the balance of every customer whose pointsExpireAt has passed: the whole balance goes, as
 * in the original app, with an EXPIRED ledger row, and the date is cleared until they earn or redeem
 * again. Shops that have since turned expiration off only get the date cleared.
 * Returns the number of customers whose balance expired.
 */
export async function expireDuePoints(now = new Date()) {
  let expired = 0;
  const settingsByShop = new Map();
  for (;;) {
    const due = await db.customer.findMany({
      where: { pointsExpireAt: { lte: now } },
      include: { shop: { select: { domain: true } } },
      orderBy: { pointsExpireAt: "asc" },
      take: BATCH_SIZE,
    });
    let handled = 0;
    for (const customer of due) {
      if (!settingsByShop.has(customer.shopId)) {
        const settings = await getSettings(customer.shop.domain);
        // Expiration only runs when the shop's plan includes it.
        const allowed = settings.pointExpirationEnabled && (await canUse(customer.shopId, "points.expiration"));
        settingsByShop.set(customer.shopId, { ...settings, pointExpirationEnabled: allowed });
      }
      const settings = settingsByShop.get(customer.shopId);
      try {
        if (await expireCustomer(customer.id, now, settings.pointExpirationEnabled)) expired++;
        handled++;
      } catch (err) {
        logger.error({ err, customerId: customer.id }, "Point expiration failed");
      }
    }
    // A full batch that failed entirely would be fetched again forever; leave it for the next run.
    if (due.length < BATCH_SIZE || !handled) break;
  }
  return expired;
}

// Re-reads the customer inside the transaction: they may have earned (moving the date) or spent
// since the batch was read. Returns true when points expired.
async function expireCustomer(customerId, now, enabled) {
  return db.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: customerId, pointsExpireAt: { lte: now } } });
    if (!customer) return false;
    if (!enabled || customer.points <= 0) {
      await tx.customer.update({ where: { id: customerId }, data: { pointsExpireAt: null } });
      return false;
    }
    await applyPoints(tx, {
      shopId: customer.shopId,
      customerId,
      type: "EXPIRED",
      points: -customer.points,
      earned: 0,
      reason: "Points expired",
      expiresAt: null,
    });
    logger.info({ shopId: customer.shopId, customerId, points: customer.points }, "Points expired");
    return true;
  });
}
