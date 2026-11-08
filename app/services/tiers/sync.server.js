import db from "../../db.server";
import logger from "../../logger.server";
import { issueRewardCode } from "../discounts/redeem.server";
import { getShopAdmin } from "../shopify/admin.server";
import { adminQuery } from "../shopify/graphql.server";
import { getProgram, isProgramActive, yearEnd, yearStart } from "./program.server";
import { canUse } from "../billing/plan.server";

// Placing customers in VIP tiers, as in the original app:
// - After any points or spend change, a customer moves up through every tier their value reaches,
//   getting each tier's entry rewards the first time they reach it (or the first time this year, in a
//   calendar-year program).
// - They only move down after a refund or cancellation, a deleted tier or the Dec 31 reset
//   (allowDowngrade), straight to the best tier they qualify for, without rewards.
// The value is computed from the ledger and TierCredit rows of the period, so nothing needs
// recalculating when a year ends.

export const TAG_PREFIX = "VIP: ";
const BATCH_SIZE = 200;
const sum = (result, field) => Number(result?._sum?.[field] ?? 0);

/**
 * What the customer has towards a tier in the program's period: points earned (earn rows and their
 * refunds, positive adjustments, not the VIP bonus) or amount spent, plus manual top-ups.
 */
export async function tierValue(program, customerId, now = new Date()) {
  const createdAt = program.milestone === "CALENDAR_YEAR" ? { gte: yearStart(now) } : undefined;
  const base = { customerId, ...(createdAt && { createdAt }) };
  if (program.entryMethod === "MONEY_SPENT") {
    return sum(await db.tierCredit.aggregate({ _sum: { amount: true }, where: base }), "amount");
  }
  const [earned, adjusted, manual] = await Promise.all([
    db.pointHistory.aggregate({
      _sum: { points: true },
      where: { ...base, type: { in: ["EARN", "REFUND"] }, OR: [{ earningType: null }, { earningType: { not: "VIP_BONUS" } }] },
    }),
    db.pointHistory.aggregate({ _sum: { points: true }, where: { ...base, type: "ADJUST", points: { gt: 0 } } }),
    db.tierCredit.aggregate({ _sum: { amount: true }, where: { ...base, kind: "MANUAL" } }),
  ]);
  return sum(earned, "points") + sum(adjusted, "points") + sum(manual, "amount");
}

const TAGS_QUERY = `#graphql
  query CustomerTags($id: ID!) {
    customer(id: $id) {
      tags
    }
  }`;
const TAGS_REMOVE = `#graphql
  mutation RemoveTierTags($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      userErrors {
        field
        message
      }
    }
  }`;
const TAGS_ADD = `#graphql
  mutation AddTierTag($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors {
        field
        message
      }
    }
  }`;

/** Replaces the customer's "VIP: ..." tags with the new tier's tag (when the tier has tagging on). */
export async function syncTierTag(shopDomain, customer, tier) {
  const admin = await getShopAdmin(shopDomain);
  const id = customer.shopifyCustomerId;
  const { customer: current } = await adminQuery(admin, TAGS_QUERY, { id });
  const wanted = tier?.tagEnabled ? `${TAG_PREFIX}${tier.title}` : null;
  const stale = (current?.tags ?? []).filter((tag) => tag.startsWith(TAG_PREFIX) && tag !== wanted);
  if (stale.length) await adminQuery(admin, TAGS_REMOVE, { id, tags: stale });
  if (wanted && !(current?.tags ?? []).includes(wanted)) await adminQuery(admin, TAGS_ADD, { id, tags: [wanted] });
}

// Whether the customer reached this tier before (ever, or this year in a calendar-year program).
async function reachedBefore(program, customerId, tierId, now) {
  const createdAt = program.milestone === "CALENDAR_YEAR" ? { gte: yearStart(now) } : undefined;
  return (await db.tierHistory.count({ where: { customerId, tierId, ...(createdAt && { createdAt }) } })) > 0;
}

/**
 * Re-evaluates a customer's tier. Returns { from, to } (tier ids) when it changed, or { skipped }.
 * `allowDowngrade` is for refunds, cancellations, deleted tiers and the year-end reset.
 */
export async function syncCustomerTier(shopId, customerId, { allowDowngrade = false, now = new Date() } = {}) {
  const program = await getProgram(shopId);
  if (!isProgramActive(program, now)) return { skipped: "inactive" };
  if (!(await canUse(shopId, "tier.vip_tiers"))) return { skipped: "plan" };
  const [tiers, customer] = await Promise.all([
    db.tier.findMany({ where: { shopId }, orderBy: { threshold: "asc" }, include: { rewards: { include: { discountRule: true } } } }),
    db.customer.findUnique({ where: { id: customerId }, include: { shop: true } }),
  ]);
  if (!tiers.length || !customer) return { skipped: "no-tiers" };
  if (customer.excluded) return { skipped: "excluded" };

  const value = await tierValue(program, customerId, now);
  const targetIndex = tiers.reduce((best, tier, i) => (Number(tier.threshold) <= value ? i : best), 0);
  const currentIndex = tiers.findIndex((t) => t.id === customer.tierId);
  const expiresAt = program.milestone === "CALENDAR_YEAR" ? yearEnd(now) : null;

  let path; // tiers entered, lowest first; rewards are given for these
  if (currentIndex === -1) {
    const placedBefore = (await db.tierHistory.count({ where: { customerId } })) > 0;
    // A new customer climbs from the entry tier; one whose tier was deleted goes straight to the best fit.
    path = placedBefore ? [tiers[targetIndex]] : tiers.slice(0, targetIndex + 1);
  } else if (targetIndex > currentIndex) {
    path = tiers.slice(currentIndex + 1, targetIndex + 1);
  } else if (targetIndex < currentIndex && allowDowngrade) {
    path = [tiers[targetIndex]];
  } else {
    // No change; keep the year-end date current (calendar-year programs).
    if (customer.tierExpiresAt?.getTime() !== expiresAt?.getTime()) {
      await db.customer.update({ where: { id: customerId }, data: { tierExpiresAt: expiresAt } });
    }
    return { skipped: "unchanged" };
  }
  const downgrade = currentIndex !== -1 && targetIndex < currentIndex;
  const target = tiers[targetIndex];

  // Only the run that actually moves the customer gives rewards (another sync may run at the same time).
  const { count } = await db.customer.updateMany({
    where: { id: customerId, tierId: customer.tierId },
    data: { tierId: target.id, tierAchievedAt: now, tierExpiresAt: expiresAt },
  });
  if (!count) return { skipped: "concurrent" };

  for (const tier of path) {
    const firstTime = !downgrade && !(await reachedBefore(program, customerId, tier.id, now));
    await db.tierHistory.create({ data: { shopId, customerId, tierId: tier.id, tierTitle: tier.title } });
    if (!firstTime) continue;
    for (const { discountRule } of tier.rewards) {
      try {
        await issueRewardCode(customer.shop.domain, customer, discountRule);
      } catch (err) {
        logger.error({ err, customerId, tierId: tier.id, ruleId: discountRule.id }, "Tier reward not issued");
      }
    }
  }

  try {
    await syncTierTag(customer.shop.domain, customer, target);
  } catch (err) {
    logger.error({ err, customerId, tierId: target.id }, "Tier tag not updated");
  }
  logger.info({ shopId, customerId, from: customer.tierId, to: target.id, value }, "Customer tier changed");
  return { from: customer.tierId, to: target.id };
}

/** syncCustomerTier that only logs failures: a tier problem mustn't fail the points change behind it. */
export async function syncTierSafely(shopId, customerId, options) {
  try {
    return await syncCustomerTier(shopId, customerId, options);
  } catch (err) {
    logger.error({ err, shopId, customerId }, "Tier sync failed");
    return { skipped: "error" };
  }
}

/** The amount an order counts for money-spent tiers: current subtotal, plus tax when included. */
export function orderSpend(payload, settings) {
  const subtotal = Number(payload.current_subtotal_price ?? payload.subtotal_price ?? 0) || 0;
  const tax = settings.includeTax ? Number(payload.current_total_tax ?? payload.total_tax ?? 0) || 0 : 0;
  return Math.round((subtotal + tax) * 100) / 100;
}

// Records a TierCredit once per sourceKey. Returns true when it was new.
async function addCredit(customer, kind, amount, sourceKey) {
  try {
    await db.tierCredit.create({
      data: { shopId: customer.shopId, customerId: customer.id, kind, amount: amount.toFixed(2), sourceKey },
    });
    return true;
  } catch (err) {
    if (err.code === "P2002") return false;
    throw err;
  }
}

/** Counts an order's amount toward money-spent tiers (once per order), then re-evaluates the tier. */
export async function recordOrderSpend(customer, payload, settings) {
  const added = await addCredit(customer, "SPEND", orderSpend(payload, settings), `order:${payload.id}`);
  if (added) await syncTierSafely(customer.shopId, customer.id);
  return added;
}

/**
 * Takes a refund or cancellation off an order's counted amount (never below 0), once per refund, then
 * re-evaluates the tier allowing a downgrade. `refund` is the refunds/create payload (cause "refund").
 */
export async function revokeOrderSpend(shopDomain, shopifyOrderId, cause, { refund, settings } = {}) {
  const original = await db.tierCredit.findFirst({
    where: { shop: { domain: shopDomain }, sourceKey: `order:${shopifyOrderId}` },
    include: { customer: true },
  });
  if (original) {
    const related = await db.tierCredit.aggregate({
      _sum: { amount: true },
      where: { customerId: original.customerId, OR: [{ sourceKey: `order:${shopifyOrderId}` }, { sourceKey: { startsWith: `refund:${shopifyOrderId}:` } }] },
    });
    const remaining = sum(related, "amount");
    let amount = remaining;
    let key = `cancel:${shopifyOrderId}`;
    if (cause === "refund") {
      const lines = (refund?.refund_line_items ?? []).reduce(
        (total, line) => total + (Number(line.subtotal) || 0) + (settings?.includeTax ? Number(line.total_tax) || 0 : 0),
        0,
      );
      amount = Math.min(remaining, Math.round(lines * 100) / 100);
      key = `refund:${shopifyOrderId}:${refund?.id}`;
    }
    if (amount > 0) await addCredit(original.customer, "SPEND", -amount, key);
  }
  return original?.customer ?? null;
}

/**
 * The merchant's "Change tier": tops the customer up (a MANUAL credit) so they reach `tierId`, which
 * must be above their current tier, then moves them there. Returns { ok } or { error }.
 */
export async function changeCustomerTier(customer, tierId, now = new Date()) {
  const program = await getProgram(customer.shopId);
  if (!isProgramActive(program, now)) return { error: "The VIP program isn't running." };
  if (!(await canUse(customer.shopId, "tier.manual_change"))) return { error: "Your plan doesn't include changing tiers." };
  const tiers = await db.tier.findMany({ where: { shopId: customer.shopId }, orderBy: { threshold: "asc" } });
  const target = tiers.find((t) => t.id === tierId);
  const current = tiers.find((t) => t.id === customer.tierId);
  if (!target) return { error: "Choose a tier." };
  if (current && Number(target.threshold) <= Number(current.threshold)) return { error: "Choose a tier above the customer's current one." };
  const missing = Number(target.threshold) - (await tierValue(program, customer.id, now));
  if (missing > 0) await addCredit(customer, "MANUAL", missing, `manual:${now.getTime()}`);
  await syncCustomerTier(customer.shopId, customer.id, { now });
  logger.info({ shopId: customer.shopId, customerId: customer.id, tierId }, "Customer tier changed by merchant");
  return { ok: true };
}

/** Re-places customers (after their tier was deleted), allowing a downgrade. */
export async function resyncCustomers(shopId, customerIds) {
  for (const id of customerIds) await syncTierSafely(shopId, id, { allowDowngrade: true });
}

/**
 * Calendar-year reset: customers whose tier period has ended (Dec 31) are re-evaluated for the new
 * year, which can move them down. Returns the number of customers processed.
 */
export async function resetExpiredTiers(now = new Date()) {
  let processed = 0;
  let afterId = 0; // walk by id, so a customer whose date didn't move isn't fetched again
  for (;;) {
    const due = await db.customer.findMany({
      where: { tierExpiresAt: { lte: now }, id: { gt: afterId } },
      select: { id: true, shopId: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
    if (due.length) afterId = due.at(-1).id;
    for (const customer of due) {
      const result = await syncTierSafely(customer.shopId, customer.id, { allowDowngrade: true, now });
      // Program off (or failed): stop re-checking until the customer's tier changes again.
      if (result.skipped && result.skipped !== "unchanged") {
        await db.customer.update({ where: { id: customer.id }, data: { tierExpiresAt: null } });
      }
      processed++;
    }
    if (due.length < BATCH_SIZE) break;
  }
  return processed;
}

/** The customer's tier and the next one up, for the widget and the customer page. */
export async function tierStatus(customer, now = new Date()) {
  const program = await getProgram(customer.shopId);
  if (!isProgramActive(program, now)) return null;
  const tiers = await db.tier.findMany({ where: { shopId: customer.shopId }, orderBy: { threshold: "asc" } });
  if (!tiers.length) return null;
  const value = await tierValue(program, customer.id, now);
  const index = tiers.findIndex((t) => t.id === customer.tierId);
  const next = tiers[index + 1] ?? null;
  return {
    program,
    tiers,
    value,
    current: index === -1 ? null : tiers[index],
    next,
    needed: next ? Math.max(0, Number(next.threshold) - value) : 0,
  };
}
