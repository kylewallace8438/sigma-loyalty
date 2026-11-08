import { randomInt } from "node:crypto";
import db from "../../db.server";
import logger from "../../logger.server";
import { InsufficientPointsError, applyPoints, expiryFrom } from "../points/points.server";
import { getSettings } from "../settings/settings.server";
import { canUse } from "../billing/plan.server";
import { getShopAdmin } from "../shopify/admin.server";
import { adminQuery } from "../shopify/graphql.server";
import { SPEND_MODES, formatDiscountValue } from "./types";

// Redeeming points for a reward, as in the original app: check, create a one-customer Shopify code,
// then deduct the points and record the code in one transaction (deleting the code if that fails).

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
const CODE_LENGTH = 8;
const CODE_ATTEMPTS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export class RedeemError extends Error {}

export const generateCode = () =>
  Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

const BASIC_CREATE = `#graphql
  mutation CreateRewardCode($input: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $input) {
      codeDiscountNode {
        id
      }
      userErrors {
        field
        code
        message
      }
    }
  }`;

const FREE_SHIPPING_CREATE = `#graphql
  mutation CreateFreeShippingRewardCode($input: DiscountCodeFreeShippingInput!) {
    discountCodeFreeShippingCreate(freeShippingCodeDiscount: $input) {
      codeDiscountNode {
        id
      }
      userErrors {
        field
        code
        message
      }
    }
  }`;

const DELETE = `#graphql
  mutation DeleteRewardCode($id: ID!) {
    discountCodeDelete(id: $id) {
      deletedCodeDiscountId
      userErrors {
        field
        message
      }
    }
  }`;

/**
 * What a redemption costs and gives. FIXED: the rule's cost and value. INCREMENT: `points` chosen by
 * the customer, a multiple of the cost within the rule's bounds, giving discountValue per cost spent.
 * Returns { points, value } (value: amount or percent as a number; null for free shipping).
 */
export function redemptionCost(rule, requestedPoints) {
  const value = rule.discountValue == null ? null : Number(rule.discountValue);
  if (rule.spendMode !== SPEND_MODES.INCREMENT) return { points: rule.pointsCost, value };
  const points = Number(requestedPoints);
  const min = Math.max(rule.minPoints ?? rule.pointsCost, rule.pointsCost);
  if (!Number.isInteger(points) || points < min || points % rule.pointsCost) {
    throw new RedeemError(`Choose a multiple of ${rule.pointsCost} points, at least ${min}.`);
  }
  if (rule.maxPoints && points > rule.maxPoints) throw new RedeemError(`You can spend at most ${rule.maxPoints} points.`);
  return { points, value: Math.round(value * (points / rule.pointsCost) * 100) / 100 };
}

/** The Shopify mutation and input for a reward code. Exported for tests. */
export function discountInput(rule, { code, customerGid, value, now = new Date() }) {
  const common = {
    title: `Loyalty reward: ${rule.title}`,
    code,
    startsAt: now.toISOString(),
    ...(rule.expiresInDays && { endsAt: new Date(now.getTime() + rule.expiresInDays * DAY_MS).toISOString() }),
    context: { customers: { add: [customerGid] } },
    ...(rule.minimumSubtotal && {
      minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: String(rule.minimumSubtotal) } },
    }),
    usageLimit: 1,
    appliesOncePerCustomer: rule.appliesOncePerCustomer,
  };

  if (rule.discountType === "FREE_SHIPPING") {
    return {
      mutation: FREE_SHIPPING_CREATE,
      field: "discountCodeFreeShippingCreate",
      input: {
        ...common,
        destination: { all: true },
        ...(rule.maxShippingFee && { maximumShippingPrice: String(rule.maxShippingFee) }),
        combinesWith: { orderDiscounts: rule.combinesWithOrder, productDiscounts: rule.combinesWithProduct },
      },
    };
  }

  let items = { all: true };
  if (rule.discountType === "FREE_PRODUCT") items = { products: { productsToAdd: [rule.product.id] } };
  else if (rule.collections?.length) items = { collections: { add: rule.collections.map((c) => c.id) } };

  const discountValue =
    rule.discountType === "PERCENTAGE"
      ? { percentage: value / 100 }
      : // Fixed amount off the order (or the product), applied once rather than to every item.
        { discountAmount: { amount: value.toFixed(2), appliesOnEachItem: false } };

  return {
    mutation: BASIC_CREATE,
    field: "discountCodeBasicCreate",
    input: {
      ...common,
      customerGets: { value: discountValue, items },
      combinesWith: {
        orderDiscounts: rule.combinesWithOrder,
        productDiscounts: rule.combinesWithProduct,
        shippingDiscounts: rule.combinesWithShipping,
      },
    },
  };
}

// Creates the code in Shopify, trying a new code when the generated one is already taken.
async function createShopifyCode(admin, rule, { customerGid, value, now }) {
  for (let attempt = 1; attempt <= CODE_ATTEMPTS; attempt++) {
    const code = generateCode();
    const { mutation, field, input } = discountInput(rule, { code, customerGid, value, now });
    const result = (await adminQuery(admin, mutation, { input }))[field];
    if (result.codeDiscountNode) return { code, discountId: result.codeDiscountNode.id, endsAt: input.endsAt ?? null };
    const taken = result.userErrors.some((e) => e.code === "TAKEN" || /taken|already/i.test(e.message));
    logger.warn({ ruleId: rule.id, userErrors: result.userErrors, attempt }, "Reward code not created");
    if (!taken) break;
  }
  throw new RedeemError("We couldn't create your discount code. Try again in a moment.");
}

async function deleteShopifyCode(admin, discountId) {
  try {
    await adminQuery(admin, DELETE, { id: discountId });
  } catch (err) {
    logger.error({ err, discountId }, "Couldn't delete an unused reward code");
  }
}

/**
 * Redeems a reward for a customer (a Customer row). `ruleId` is the discount rule; `points` is only
 * read for INCREMENT rules. Returns { code, title, value, expiresAt, points (new balance) }.
 * Throws RedeemError with a message for the customer when the redemption isn't allowed.
 */
export async function redeemReward(shopDomain, customer, ruleId, { points: requestedPoints } = {}) {
  const settings = await getSettings(shopDomain);
  if (!settings.programEnabled) throw new RedeemError("The rewards program is paused.");
  if (customer.excluded) throw new RedeemError("Your account isn't part of the rewards program.");

  const rule = await db.discountRule.findFirst({ where: { id: Number(ruleId) || 0, shopId: customer.shopId, active: true } });
  if (!rule) throw new RedeemError("This reward isn't available.");
  if (rule.discountType === "FREE_PRODUCT" && !(await canUse(customer.shopId, "redeem.free_product"))) {
    throw new RedeemError("This reward isn't available.");
  }
  const { points, value } = redemptionCost(rule, requestedPoints);
  if (customer.points < points) throw new RedeemError("You don't have enough points for this reward.");

  if (rule.usageLimit || rule.perCustomerLimit) {
    const [total, mine] = await Promise.all([
      rule.usageLimit ? db.redeemHistory.count({ where: { discountRuleId: rule.id } }) : 0,
      rule.perCustomerLimit
        ? db.redeemHistory.count({ where: { discountRuleId: rule.id, shopifyCustomerId: customer.shopifyCustomerId } })
        : 0,
    ]);
    if (rule.usageLimit && total >= rule.usageLimit) throw new RedeemError("This reward is no longer available.");
    if (rule.perCustomerLimit && mine >= rule.perCustomerLimit) throw new RedeemError("You've already redeemed this reward the maximum number of times.");
  }

  const admin = await getShopAdmin(shopDomain);
  const now = new Date();
  const created = await createShopifyCode(admin, rule, { customerGid: customer.shopifyCustomerId, value, now });

  try {
    await db.$transaction(async (tx) => {
      await applyPoints(tx, {
        shopId: customer.shopId,
        customerId: customer.id,
        type: "REDEEM",
        points: -points,
        reason: `Redeemed: ${rule.title} (${created.code})`,
        expiresAt: expiryFrom(settings, now),
      });
      await tx.redeemHistory.create({
        data: {
          shopId: customer.shopId,
          shopifyCustomerId: customer.shopifyCustomerId,
          points,
          shopifyDiscountId: created.discountId,
          discountRuleId: rule.id,
          code: created.code,
          title: rule.title,
          discountValue: value == null ? null : value.toFixed(2),
          expiresAt: created.endsAt ? new Date(created.endsAt) : null,
        },
      });
    });
  } catch (err) {
    // The points weren't taken, so the code mustn't stay usable.
    await deleteShopifyCode(admin, created.discountId);
    if (err instanceof InsufficientPointsError) throw new RedeemError("You don't have enough points for this reward.");
    throw err;
  }

  logger.info({ shopId: customer.shopId, customerId: customer.id, ruleId: rule.id, points, code: created.code }, "Reward redeemed");
  const balance = await db.customer.findUnique({ where: { id: customer.id }, select: { points: true } });
  return {
    code: created.code,
    title: rule.title,
    value: formatDiscountValue({ ...rule, discountValue: value }),
    expiresAt: created.endsAt,
    points: balance.points,
  };
}

/**
 * Gives a customer a reward's code for free (no points spent), e.g. a referral or VIP tier reward.
 * The rule may be inactive (rewards only given this way are often kept off the redeem list); an
 * INCREMENT rule gives its base value. Returns { code, redemptionId }.
 */
export async function issueRewardCode(shopDomain, customer, rule) {
  const admin = await getShopAdmin(shopDomain);
  const value = rule.discountValue == null ? null : Number(rule.discountValue);
  const created = await createShopifyCode(admin, rule, { customerGid: customer.shopifyCustomerId, value, now: new Date() });
  try {
    const row = await db.redeemHistory.create({
      data: {
        shopId: customer.shopId,
        shopifyCustomerId: customer.shopifyCustomerId,
        points: 0,
        shopifyDiscountId: created.discountId,
        discountRuleId: rule.id,
        code: created.code,
        title: rule.title,
        discountValue: value == null ? null : value.toFixed(2),
        expiresAt: created.endsAt ? new Date(created.endsAt) : null,
      },
    });
    logger.info({ shopId: customer.shopId, customerId: customer.id, ruleId: rule.id, code: created.code }, "Reward code issued");
    return { code: created.code, redemptionId: row.id, discountId: created.discountId };
  } catch (err) {
    await deleteShopifyCode(admin, created.discountId);
    throw err;
  }
}

/** Deletes a code issued by issueRewardCode that ended up not being given (and its record). */
export async function revokeIssuedCode(shopDomain, issued) {
  await deleteShopifyCode(await getShopAdmin(shopDomain), issued.discountId);
  await db.redeemHistory.deleteMany({ where: { id: issued.redemptionId } });
}

/**
 * Marks the app's codes used by an order (orders/create). Codes are matched case-insensitively and
 * only the first order that uses a code is recorded. Returns how many codes were marked.
 */
export async function markCodesUsed(shopDomain, payload) {
  const codes = (payload.discount_codes ?? []).map((d) => String(d.code).toUpperCase()).filter(Boolean);
  if (!codes.length) return 0;
  const { count } = await db.redeemHistory.updateMany({
    where: { shop: { domain: shopDomain }, code: { in: codes }, usedAt: null },
    data: { usedAt: new Date(payload.created_at ?? Date.now()), usedOrderId: BigInt(payload.id) },
  });
  return count;
}

/**
 * Gives back the points spent on the app's codes used in a refunded or cancelled order, once per
 * code, when the shop's "return points" setting is on (as in the original app).
 * Returns the number of codes whose points were returned.
 */
export async function returnCodePoints(shopDomain, shopifyOrderId) {
  const settings = await getSettings(shopDomain);
  if (!settings.programEnabled || !settings.returnPointsOnRefund) return 0;
  const redemptions = await db.redeemHistory.findMany({
    where: { shop: { domain: shopDomain }, usedOrderId: BigInt(shopifyOrderId) },
    include: { customer: true },
  });
  let returned = 0;
  for (const redemption of redemptions) {
    try {
      await db.$transaction((tx) =>
        applyPoints(tx, {
          shopId: redemption.shopId,
          customerId: redemption.customer.id,
          type: "RETURN_CODE",
          points: redemption.points,
          earned: 0, // spent points coming back aren't newly earned
          reason: `Points returned: ${redemption.title ?? "reward"} (${redemption.code})`,
          shopifyOrderId: BigInt(shopifyOrderId),
          dedupeKey: `return:${redemption.id}`,
        }),
      );
      returned++;
    } catch (err) {
      if (err.code !== "P2002") throw err; // already returned
    }
  }
  if (returned) logger.info({ shop: shopDomain, orderId: shopifyOrderId, returned }, "Code points returned");
  return returned;
}

/** The customer's most recent codes, newest first. */
export function listCustomerCodes(customer, take = 20) {
  return db.redeemHistory.findMany({
    where: { shopId: customer.shopId, shopifyCustomerId: customer.shopifyCustomerId, code: { not: null } },
    orderBy: { id: "desc" },
    take,
  });
}
