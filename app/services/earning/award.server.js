import db from "../../db.server";
import logger from "../../logger.server";
import { issueRewardCode, revokeIssuedCode } from "../discounts/redeem.server";
import { applyPoints, expiryFrom } from "../points/points.server";
import { syncTierSafely } from "../tiers/sync.server";
import { canUse } from "../billing/plan.server";
import { earningFeature } from "../billing/features";
import { EARNING_TYPE } from "./types";

/**
 * Gives `customer` points for an earning rule, at most once per `dedupeKey`. `settings` are the shop's
 * store settings. Like the original app, nothing is awarded while the program is off or to an
 * excluded customer, and each award restarts the customer's point expiration period.
 * Returns "awarded", "duplicate" (already given for this key), "disabled", "excluded", "zero" or
 * "plan" (the shop's plan doesn't include this rule).
 */
export async function earnPoints(settings, customer, { type, points, reason, dedupeKey, shopifyOrderId = null }) {
  if (!settings.programEnabled) return "disabled";
  if (customer.excluded) return "excluded";
  if (!(points > 0)) return "zero";
  const feature = earningFeature(type, EARNING_TYPE[type]?.kind);
  if (feature && !(await canUse(customer.shopId, feature))) return "plan";
  try {
    await db.$transaction((tx) =>
      applyPoints(tx, {
        shopId: customer.shopId,
        customerId: customer.id,
        type: "EARN",
        points,
        reason,
        earningType: type,
        shopifyOrderId,
        dedupeKey,
        expiresAt: expiryFrom(settings),
      }),
    );
  } catch (err) {
    if (err.code === "P2002") return "duplicate";
    throw err;
  }
  logger.info({ shopId: customer.shopId, customerId: customer.id, type, points, dedupeKey }, "Points earned");
  // Points earned can move the customer up a VIP tier (the tier bonus itself doesn't count).
  if (type !== "VIP_BONUS") await syncTierSafely(customer.shopId, customer.id);
  return "awarded";
}

/**
 * Gives a rule's reward: its points, or, for a rule set to give a discount code (config.rewardType
 * "COUPON", referral rules), a free code of the discount rule config.discountRuleId. A code reward is
 * logged as a 0-point ledger row with the same once-only key, so it is also given at most once.
 * Returns an earnPoints result, or "no-reward" when the discount rule is gone.
 */
export async function earnReward(settings, shopDomain, customer, rule, { type, reason, dedupeKey, shopifyOrderId = null }) {
  if (rule.config?.rewardType !== "COUPON") {
    return earnPoints(settings, customer, { type, points: rule.points, reason, dedupeKey, shopifyOrderId });
  }
  if (!settings.programEnabled) return "disabled";
  if (customer.excluded) return "excluded";
  if (await hasEarned(customer.id, dedupeKey)) return "duplicate";
  const feature = earningFeature(type, EARNING_TYPE[type]?.kind);
  if (feature && !(await canUse(customer.shopId, feature))) return "plan";
  const discountRule = await db.discountRule.findFirst({ where: { id: rule.config.discountRuleId ?? 0, shopId: customer.shopId } });
  if (!discountRule) {
    logger.warn({ shopId: customer.shopId, type, discountRuleId: rule.config.discountRuleId }, "Reward's discount rule not found");
    return "no-reward";
  }

  const issued = await issueRewardCode(shopDomain, customer, discountRule);
  try {
    await db.$transaction((tx) =>
      applyPoints(tx, {
        shopId: customer.shopId,
        customerId: customer.id,
        type: "EARN",
        points: 0,
        reason: `${reason}: ${discountRule.title} (${issued.code})`,
        earningType: type,
        shopifyOrderId,
        dedupeKey,
      }),
    );
  } catch (err) {
    // Given at the same moment by another delivery: take this second code back.
    await revokeIssuedCode(shopDomain, issued);
    if (err.code === "P2002") return "duplicate";
    throw err;
  }
  return "awarded";
}

/** Whether the customer already has a ledger row with this key (to skip work before awarding). */
export async function hasEarned(customerId, dedupeKey) {
  return (await db.pointHistory.count({ where: { customerId, dedupeKey } })) > 0;
}
