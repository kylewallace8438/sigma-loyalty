import db from "../../db.server";
import logger from "../../logger.server";
import { ensureOrderCustomer } from "../customers/customers.server";
import { applyPoints } from "../points/points.server";
import { getSettings } from "../settings/settings.server";
import { getShopAdmin } from "../shopify/admin.server";
import { adminQuery } from "../shopify/graphql.server";
import { earnPoints, earnReward } from "./award.server";
import { getActiveRule } from "./rules.server";
import { canUse, recordUse } from "../billing/plan.server";
import { recordOrderSpend, revokeOrderSpend, syncTierSafely } from "../tiers/sync.server";
import { ITEM_SCOPES, ORDER_METHODS } from "./types";

const money = (value) => Number(value ?? 0) || 0;

const PRODUCT_COLLECTIONS_QUERY = `#graphql
  query ProductCollections($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        collections(first: 250) {
          nodes {
            id
          }
        }
      }
    }
  }`;

/** Map of product gid -> Set of its collection gids, read from the Admin API. */
export async function fetchProductCollections(shopDomain, productIds) {
  if (!productIds.length) return new Map();
  const admin = await getShopAdmin(shopDomain);
  const map = new Map();
  // nodes() takes at most 250 ids per call.
  for (let i = 0; i < productIds.length; i += 250) {
    const data = await adminQuery(admin, PRODUCT_COLLECTIONS_QUERY, { ids: productIds.slice(i, i + 250) });
    for (const node of data.nodes) {
      if (node?.id) map.set(node.id, new Set(node.collections.nodes.map((c) => c.id)));
    }
  }
  return map;
}

// What a line item adds to the order amount: price × quantity, less its discounts (plus its tax when
// tax is included). Refunded quantities are left out via current_quantity.
function lineAmount(lineItem, includeTax) {
  const quantity = lineItem.current_quantity ?? lineItem.quantity ?? 0;
  if (!quantity) return 0;
  const discount = (lineItem.discount_allocations ?? []).reduce((sum, a) => sum + money(a.amount), 0);
  const tax = includeTax ? (lineItem.tax_lines ?? []).reduce((sum, t) => sum + money(t.price), 0) : 0;
  return money(lineItem.price) * quantity - discount + tax;
}

/**
 * The order amount the rule counts. All items: the current subtotal (after discounts and edits, plus
 * tax when the shop includes tax), as in the original app. Selected items: the sum of the lines that
 * match (INCLUDE) or don't match (EXCLUDE) the rule's products and collections; gift cards never count.
 * `productCollections` maps product gid -> Set of collection gids (needed when the rule has collections).
 */
export function countedAmount(rule, payload, settings, productCollections = new Map()) {
  const { itemScope, products, collections } = rule.config;
  if (itemScope === ITEM_SCOPES.ALL) {
    const subtotal = money(payload.current_subtotal_price ?? payload.subtotal_price);
    const tax = settings.includeTax ? money(payload.current_total_tax ?? payload.total_tax) : 0;
    return subtotal + tax;
  }
  const productIds = new Set(products.map((p) => p.id));
  const collectionIds = collections.map((c) => c.id);
  const matches = (lineItem) => {
    if (!lineItem.product_id) return false;
    const gid = `gid://shopify/Product/${lineItem.product_id}`;
    if (productIds.has(gid)) return true;
    const inCollections = productCollections.get(gid);
    return Boolean(inCollections && collectionIds.some((id) => inCollections.has(id)));
  };
  return (payload.line_items ?? [])
    .filter((li) => !li.gift_card)
    .filter((li) => (itemScope === ITEM_SCOPES.INCLUDE ? matches(li) : !matches(li)))
    .reduce((sum, li) => sum + lineAmount(li, settings.includeTax), 0);
}

/**
 * Points the Place order rule gives for an order. FIXED: the rule's points. PER_AMOUNT: points for
 * every `spent` of the counted amount, rounded, and nothing below `spent` (as in the original app).
 */
export function orderPoints(rule, payload, settings, productCollections) {
  if (rule.config.method === ORDER_METHODS.FIXED) return rule.points;
  const amount = countedAmount(rule, payload, settings, productCollections);
  const spent = Number(rule.config.spent);
  if (!(spent > 0) || amount < spent) return 0;
  return Math.round((rule.points * amount) / spent);
}

// Product gids of the order's lines, to look up their collections.
function lineProductIds(payload) {
  const ids = (payload.line_items ?? []).filter((li) => li.product_id).map((li) => `gid://shopify/Product/${li.product_id}`);
  return [...new Set(ids)];
}

/**
 * Awards the order's points (Place order rule) and the referrer's reward for a referred friend's
 * first order. `event` is "create" (orders/create) or "fulfilled" (orders/fulfilled); points are given
 * on fulfilment or on creation, per the shop's "Only reward on fulfilment" setting.
 * Returns { order, referrer } results (see earnPoints), or a skip reason for both.
 */
export async function awardOrderPoints(shopDomain, payload, event, { loadCollections = fetchProductCollections } = {}) {
  if (!payload.customer) return { skipped: "guest" };
  if (payload.cancelled_at) return { skipped: "cancelled" };
  const settings = await getSettings(shopDomain);
  if (settings.rewardFulfilled !== (event === "fulfilled")) return { skipped: "not-trigger" };
  if (!settings.programEnabled) return { skipped: "disabled" };

  const customer = await ensureOrderCustomer(shopDomain, payload.customer);
  // As in the original app, orders over the plan's limit are skipped (nothing is queued for later).
  if (!(await canUse(customer.shopId, "orders.monthly_limit"))) return { skipped: "plan-limit" };
  const result = {};

  const rule = await getActiveRule(customer.shopId, "PLACE_ORDER");
  if (rule) {
    const needsCollections = rule.config.itemScope !== ITEM_SCOPES.ALL && rule.config.collections.length > 0;
    const productCollections = needsCollections ? await loadCollections(shopDomain, lineProductIds(payload)) : undefined;
    const points = orderPoints(rule, payload, settings, productCollections);
    result.order = await earnPoints(settings, customer, {
      type: "PLACE_ORDER",
      points,
      reason: `${rule.name} ${payload.name}`,
      dedupeKey: `order:${payload.id}`,
      shopifyOrderId: BigInt(payload.id),
    });
    if (result.order === "awarded") {
      await recordUse(customer.shopId, "orders.monthly_limit");
      result.vipBonus = await awardTierBonus(settings, customer, payload, points);
    }
  }

  // Counts toward money-spent VIP tiers (whether or not the order earned points), as in the original app.
  await recordOrderSpend(customer, payload, settings);

  if (customer.referredById) result.referrer = await rewardReferrer(shopDomain, settings, customer, payload);

  logger.info({ shop: shopDomain, orderId: payload.id, customerId: customer.id, event, ...result }, "Order points processed");
  return result;
}

// A VIP tier with a multiplier adds points × (multiplier − 1) to the order's points, as a separate row
// that doesn't count toward tiers (as in the original app). Uses the tier the customer is in now.
async function awardTierBonus(settings, customer, payload, points) {
  const { tierId } = (await db.customer.findUnique({ where: { id: customer.id }, select: { tierId: true } })) ?? {};
  const tier = tierId ? await db.tier.findUnique({ where: { id: tierId } }) : null;
  const multiplier = Number(tier?.multiplier ?? 0);
  if (!(multiplier > 1)) return "none";
  return earnPoints(settings, customer, {
    type: "VIP_BONUS",
    points: Math.round(points * (multiplier - 1)),
    reason: `${tier.title} bonus ${payload.name}`,
    dedupeKey: `vipbonus:${payload.id}`,
    shopifyOrderId: BigInt(payload.id),
  });
}

// The referrer gets their reward once per referred friend, on the friend's first rewarded order.
async function rewardReferrer(shopDomain, settings, friend, payload) {
  const rule = await getActiveRule(friend.shopId, "REFERRER");
  if (!rule) return "inactive";
  const referrer = await db.customer.findUnique({ where: { id: friend.referredById } });
  if (!referrer) return "missing";
  return earnReward(settings, shopDomain, referrer, rule, {
    type: "REFERRER",
    reason: rule.name,
    dedupeKey: `REFERRER:${friend.id}`,
    shopifyOrderId: BigInt(payload.id),
  });
}

/**
 * Takes back what an order earned, after a refund or cancellation (`cause`: "refund" | "cancel"). As in
 * the original app the whole order reward (and its VIP bonus) is taken back, once, when the shop's
 * refund setting is on; if the customer has already spent some of the points, only what's left is
 * taken. The order's amount for money-spent tiers is reduced too, and the tier re-evaluated (it can go
 * down). `refund` is the refunds/create payload.
 * Returns the order reward's result: "revoked", "none" (it earned nothing), "duplicate", "empty" or "disabled".
 */
export async function revokeOrderPoints(shopDomain, shopifyOrderId, cause, { refund } = {}) {
  const settings = await getSettings(shopDomain);
  if (!settings.programEnabled) return "disabled";

  let customer = await revokeOrderSpend(shopDomain, shopifyOrderId, cause, { refund, settings });
  let result = "disabled";
  if (settings.refundEnabled) {
    result = await revokeLedgerRow(shopDomain, shopifyOrderId, cause, `order:${shopifyOrderId}`, `refund:${shopifyOrderId}`);
    await revokeLedgerRow(shopDomain, shopifyOrderId, cause, `vipbonus:${shopifyOrderId}`, `vipbonus-refund:${shopifyOrderId}`, "VIP_BONUS");
    if (result.customer) customer = result.customer;
  }
  if (customer) await syncTierSafely(customer.shopId, customer.id, { allowDowngrade: true });
  return typeof result === "string" ? result : result.status;
}

// Takes back one earned row (by its key) with a REFUND row keyed `refundKey`.
async function revokeLedgerRow(shopDomain, shopifyOrderId, cause, earnedKey, refundKey, earningType = null) {
  const earned = await db.pointHistory.findFirst({
    where: { shop: { domain: shopDomain }, shopifyOrderId: BigInt(shopifyOrderId), dedupeKey: earnedKey },
    include: { customer: true },
  });
  if (!earned) return { status: "none" };
  const points = Math.min(earned.points, earned.customer.points);
  if (points <= 0) return { status: "empty", customer: earned.customer };

  try {
    await db.$transaction((tx) =>
      applyPoints(tx, {
        shopId: earned.shopId,
        customerId: earned.customerId,
        type: "REFUND",
        points: -points,
        earned: -points,
        reason: `${cause === "cancel" ? "Order cancelled" : "Order refunded"}: ${earned.reason}`,
        earningType,
        shopifyOrderId: BigInt(shopifyOrderId),
        dedupeKey: refundKey,
      }),
    );
  } catch (err) {
    if (err.code === "P2002") return { status: "duplicate", customer: earned.customer };
    // The balance dropped between reading and writing; the next retry takes what's left.
    throw err;
  }
  logger.info({ shop: shopDomain, orderId: shopifyOrderId, customerId: earned.customerId, points, cause, earnedKey }, "Order points taken back");
  return { status: "revoked", customer: earned.customer };
}
