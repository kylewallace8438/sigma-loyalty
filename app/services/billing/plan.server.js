import db from "../../db.server";
import logger from "../../logger.server";
import { FEATURES, FREE_PLAN_NAME, POSITIVE_WORDS } from "./features";

// What a shop's plan allows, as in the original app's SubscriptionHelper: canUse / remaining / record.
// A feature's value comes from a shop override in its time window, else the current plan. Y / YES /
// TRUE / UNLIMITED mean on, N or 0 off, and a number is a limit counted in SubscriptionUsage.

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_MS = 60 * 1000;

/** The shop's current subscription (with its plan and features), subscribing it to Free when it has none. */
export async function ensureSubscription(shopId) {
  const current = await db.subscription.findFirst({
    where: { shopId, status: "ACTIVE" },
    orderBy: { id: "desc" },
    include: { plan: { include: { features: true } } },
  });
  if (current) return current;
  const free = await db.plan.findUnique({ where: { name: FREE_PLAN_NAME } });
  if (!free) throw new Error("The Free plan is missing (run the migrations)");
  logger.info({ shopId }, "Shop subscribed to the Free plan");
  invalidate(shopId);
  return db.subscription.create({
    data: { shopId, planId: free.id },
    include: { plan: { include: { features: true } } },
  });
}

// Feature values per shop, cached briefly: they're read on every points award.
const cache = new Map();
function invalidate(shopId) {
  cache.delete(shopId);
}
/** Forgets every cached plan (tests, or after changing plans). */
export function clearPlanCache() {
  cache.clear();
}

/** { subscription, values: { code: value } } for the shop, overrides applied. */
export async function getEntitlements(shopId, now = new Date()) {
  const hit = cache.get(shopId);
  if (hit && hit.expires > now.getTime()) return hit.value;
  const subscription = await ensureSubscription(shopId);
  const values = Object.fromEntries(subscription.plan.features.map((f) => [f.code, f.value]));
  const overrides = await db.shopFeature.findMany({ where: { shopId } });
  for (const o of overrides) {
    if ((!o.startsAt || o.startsAt <= now) && (!o.endsAt || o.endsAt > now)) values[o.code] = o.value;
  }
  const value = { subscription, values };
  cache.set(shopId, { value, expires: now.getTime() + CACHE_MS });
  return value;
}

const isPositive = (value) => POSITIVE_WORDS.includes(String(value ?? "").trim().toUpperCase());

/** Usage of a limited feature in its current window (0 once the window has passed). */
async function usedOf(subscriptionId, code, now) {
  const usage = await db.subscriptionUsage.findUnique({ where: { subscriptionId_code: { subscriptionId, code } } });
  if (!usage || (usage.validUntil && usage.validUntil <= now)) return 0;
  return usage.used;
}

/** How much of a feature is left: Infinity when on without a limit, 0 when off. */
export async function remaining(shopId, code, now = new Date()) {
  const { subscription, values } = await getEntitlements(shopId, now);
  const value = values[code];
  if (value == null) return 0;
  if (isPositive(value)) return Infinity;
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.max(0, limit - (await usedOf(subscription.id, code, now)));
}

/** Whether the shop's plan allows the feature now (for limits: some is left). */
export async function canUse(shopId, code, now = new Date()) {
  return (await remaining(shopId, code, now)) > 0;
}

/**
 * Counts one use of a limited feature. A feature with resetDays (FEATURES) starts a new window on
 * the first use after the previous one ended. Unlimited features aren't counted.
 */
export async function recordUse(shopId, code, now = new Date()) {
  const { subscription, values } = await getEntitlements(shopId, now);
  if (isPositive(values[code])) return;
  const resetDays = FEATURES[code]?.resetDays;
  const key = { subscriptionId_code: { subscriptionId: subscription.id, code } };
  const usage = await db.subscriptionUsage.findUnique({ where: key });
  const freshWindow = resetDays ? new Date(now.getTime() + resetDays * DAY_MS) : null;
  if (!usage) {
    await db.subscriptionUsage.create({ data: { subscriptionId: subscription.id, code, used: 1, validUntil: freshWindow } });
  } else if (usage.validUntil && usage.validUntil <= now) {
    await db.subscriptionUsage.update({ where: key, data: { used: 1, validUntil: freshWindow } });
  } else {
    await db.subscriptionUsage.update({ where: key, data: { used: { increment: 1 } } });
  }
}

/** The Plan page: plan name and price, and each feature with what's left of limited ones. */
export async function planSummary(shopId, now = new Date()) {
  const { subscription, values } = await getEntitlements(shopId, now);
  const features = await Promise.all(
    Object.entries(FEATURES).map(async ([code, { label }]) => {
      const value = values[code];
      const limited = value != null && !isPositive(value) && Number(value) > 0;
      return {
        code,
        label,
        on: isPositive(value) || limited,
        limit: limited ? Number(value) : null,
        remaining: limited ? await remaining(shopId, code, now) : null,
      };
    }),
  );
  return {
    name: subscription.plan.name,
    description: subscription.plan.description,
    price: Number(subscription.plan.price),
    since: subscription.startsAt,
    features,
  };
}
