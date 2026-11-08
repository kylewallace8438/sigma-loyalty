import db from "../../db.server";
import logger from "../../logger.server";
import { ensureStorefrontCustomer } from "../customers/customers.server";
import { listCustomerCodes } from "../discounts/redeem.server";
import { formatDiscountValue } from "../discounts/types";
import { getSettings } from "../settings/settings.server";
import { getProgram, isProgramActive } from "../tiers/program.server";
import { TIER_ICONS } from "../tiers/icons";
import { syncTierSafely, tierStatus } from "../tiers/sync.server";
import { getShopAdmin } from "../shopify/admin.server";
import { adminQuery } from "../shopify/graphql.server";
import { earnPoints, hasEarned } from "./award.server";
import { parseBirthday, setBirthday } from "./birthday.server";
import { claimReferral, getReferralCode } from "./referral.server";
import { getActiveRule, listActiveRules } from "./rules.server";
import { EARNING_TYPE, socialLink } from "./types";

// The storefront rewards widget (extensions/loyalty-widget), through the app proxy (app/routes/proxy.*).
// Customers are identified only by the logged_in_customer_id Shopify adds to signed proxy requests.

// Rules a customer can get only once: their ledger key is the rule type.
const ONCE_TYPES = new Set(["CREATE_ACCOUNT", "NEWSLETTER", "COMPLETE_PROFILE", "REFERRED_FRIEND"]);
const isOnce = (type) => ONCE_TYPES.has(type) || EARNING_TYPE[type].kind === "social";

// Titles of the discount rules that referral rules give codes of, by id.
async function couponTitles(rules) {
  const ids = rules.filter((r) => r.config.rewardType === "COUPON" && r.config.discountRuleId).map((r) => r.config.discountRuleId);
  if (!ids.length) return {};
  const rows = await db.discountRule.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } });
  return Object.fromEntries(rows.map((r) => [r.id, r.title]));
}

// What the widget needs to show a rule.
function widgetRule(rule, doneTypes, titles = {}) {
  const meta = EARNING_TYPE[rule.type];
  const item = { type: rule.type, kind: meta.kind, name: rule.name, points: rule.points, done: doneTypes.has(rule.type) };
  if (meta.kind === "order") Object.assign(item, { method: rule.config.method, spent: rule.config.spent });
  if (meta.kind === "social") Object.assign(item, { action: meta.action, link: socialLink(rule.type, rule.config.url) });
  if (rule.type === "NEWSLETTER") item.action = meta.action;
  // Referral rules can give a discount code instead of points.
  if (rule.config.rewardType === "COUPON") item.couponTitle = titles[rule.config.discountRuleId] ?? null;
  return item;
}

// The shop's active rewards (discount rules), cheapest first, as the widget shows them.
async function listWidgetRewards(shopId) {
  const rules = await db.discountRule.findMany({ where: { shopId, active: true }, orderBy: [{ pointsCost: "asc" }, { id: "asc" }] });
  return rules.map((rule) => ({
    id: rule.id,
    title: rule.title,
    value: formatDiscountValue(rule),
    pointsCost: rule.pointsCost,
    spendMode: rule.spendMode,
    discountValue: rule.discountValue == null ? null : Number(rule.discountValue),
    minPoints: rule.minPoints,
    maxPoints: rule.maxPoints,
    minimumSubtotal: rule.minimumSubtotal == null ? null : Number(rule.minimumSubtotal),
  }));
}

// A customer's codes for the widget: used and expired codes are flagged so they can be shown apart.
function widgetCode(row, now) {
  return {
    code: row.code,
    title: row.title,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    used: Boolean(row.usedAt),
    expired: Boolean(row.expiresAt && row.expiresAt <= now),
  };
}

const widgetTier = (tier) => ({
  title: tier.title,
  icon: tier.icon ? (TIER_ICONS[tier.icon]?.symbol ?? null) : null,
  threshold: Number(tier.threshold),
  multiplier: tier.multiplier ? Number(tier.multiplier) : null,
  perks: tier.perks ?? [],
});

// The VIP program for the widget: the tiers, plus the customer's tier and progress when logged in.
// A logged-in customer the program hasn't placed yet is placed now.
async function widgetVip(shopId, customer) {
  const program = await getProgram(shopId);
  if (!isProgramActive(program)) return null;
  if (customer && !customer.tierId) {
    await syncTierSafely(shopId, customer.id);
    customer = await db.customer.findUnique({ where: { id: customer.id } });
  }
  if (!customer) {
    const tiers = await db.tier.findMany({ where: { shopId }, orderBy: { threshold: "asc" } });
    return { entryMethod: program.entryMethod, tiers: tiers.map(widgetTier) };
  }
  const status = await tierStatus(customer);
  if (!status) return null;
  return {
    entryMethod: program.entryMethod,
    tiers: status.tiers.map(widgetTier),
    current: status.current ? widgetTier(status.current) : null,
    next: status.next ? { title: status.next.title, needed: status.needed } : null,
  };
}

/**
 * Everything the widget shows: the active ways to earn and, for a logged-in customer, their balance,
 * which one-time rules they've done, their birthday, their referral code and their reward codes.
 * `rewards` are the active discount rules they can redeem points for.
 * `shopifyNumericId` is null for a visitor who isn't logged in.
 */
export async function getWidgetData(shopDomain, shopifyNumericId) {
  const shop = await db.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) return { loggedIn: Boolean(shopifyNumericId), enabled: false, rules: [] };
  const settings = await getSettings(shopDomain);
  // pointsName is null unless the shop named its points, so the widget keeps its translated "points".
  const base = { enabled: settings.programEnabled, pointsName: settings.pointsName };
  const [rules, rewards] = settings.programEnabled
    ? await Promise.all([listActiveRules(shop.id), listWidgetRewards(shop.id)])
    : [[], []];

  const titles = await couponTitles(rules);

  if (!shopifyNumericId) {
    return {
      ...base,
      loggedIn: false,
      rules: rules.map((r) => widgetRule(r, new Set(), titles)),
      rewards,
      vip: settings.programEnabled ? await widgetVip(shop.id, null) : null,
    };
  }

  const customer = await ensureStorefrontCustomer(shopDomain, shopifyNumericId);
  const onceKeys = rules.filter((r) => isOnce(r.type)).map((r) => r.type);
  const done = onceKeys.length
    ? await db.pointHistory.findMany({ where: { customerId: customer.id, dedupeKey: { in: onceKeys } }, select: { dedupeKey: true } })
    : [];
  const doneTypes = new Set(done.map((row) => row.dedupeKey));
  const referral = rules.some((r) => r.type === "REFERRER" || r.type === "REFERRED_FRIEND");

  return {
    ...base,
    loggedIn: true,
    points: customer.points,
    excluded: customer.excluded,
    birthday: customer.birthday ? customer.birthday.toISOString().slice(0, 10) : null,
    referralCode: referral && !customer.excluded ? await getReferralCode(customer) : null,
    rules: rules.map((r) => widgetRule(r, doneTypes, titles)),
    rewards,
    codes: (await listCustomerCodes(customer)).map((row) => widgetCode(row, new Date())),
    vip: settings.programEnabled && !customer.excluded ? await widgetVip(shop.id, customer) : null,
  };
}

class EarnError extends Error {}

const SUBSCRIBE_MUTATION = `#graphql
  mutation SubscribeNewsletter($customerId: ID!) {
    customerEmailMarketingConsentUpdate(
      input: {
        customerId: $customerId
        emailMarketingConsent: { marketingState: SUBSCRIBED, marketingOptInLevel: SINGLE_OPT_IN }
      }
    ) {
      customer {
        id
      }
      userErrors {
        field
        message
      }
    }
  }`;

const PROFILE_QUERY = `#graphql
  query CustomerProfile($id: ID!) {
    customer(id: $id) {
      firstName
      lastName
      defaultAddress {
        id
      }
    }
  }`;

// Gives a once-only rule's points, after `check` (which may call Shopify) passes.
async function earnOnce(shopDomain, customer, type, check) {
  const rule = await getActiveRule(customer.shopId, type);
  if (!rule) throw new EarnError("This reward isn't available.");
  if (await hasEarned(customer.id, type)) throw new EarnError("You've already earned this reward.");
  if (check) await check();
  const result = await earnPoints(await getSettings(shopDomain), customer, {
    type,
    points: rule.points,
    reason: rule.name,
    dedupeKey: type,
  });
  if (result === "duplicate") throw new EarnError("You've already earned this reward.");
  if (result !== "awarded") throw new EarnError("This reward isn't available.");
}

/**
 * Runs a widget action for a logged-in customer. `body` is { action, ... }:
 *   social { type }       - the customer clicked through to a social rule's link
 *   newsletter            - subscribe to email marketing, then give the points
 *   profile               - give the points if the Shopify profile is complete
 *   birthday { birthday } - save the birthday ("YYYY-MM-DD")
 *   referral { token }    - link the customer to the referrer whose link they opened
 * Returns { ok: true, points, result? } or { ok: false, error, result? }.
 */
export async function runEarnAction(shopDomain, shopifyNumericId, body) {
  const customer = await ensureStorefrontCustomer(shopDomain, shopifyNumericId);
  const customerGid = customer.shopifyCustomerId;
  const done = async (extra = {}) => {
    const { points } = await db.customer.findUnique({ where: { id: customer.id }, select: { points: true } });
    return { ok: true, points, ...extra };
  };

  try {
    if (customer.excluded) throw new EarnError("Your account isn't part of the rewards program.");
    switch (body?.action) {
      case "social": {
        if (EARNING_TYPE[body.type]?.kind !== "social") throw new EarnError("This reward isn't available.");
        await earnOnce(shopDomain, customer, body.type);
        return await done();
      }
      case "newsletter": {
        await earnOnce(shopDomain, customer, "NEWSLETTER", async () => {
          const data = await adminQuery(await getShopAdmin(shopDomain), SUBSCRIBE_MUTATION, { customerId: customerGid });
          const userErrors = data.customerEmailMarketingConsentUpdate.userErrors;
          if (userErrors.length) {
            logger.warn({ shop: shopDomain, customerId: customer.id, userErrors }, "Newsletter subscription failed");
            throw new EarnError("We couldn't subscribe you. Check that your account has an email address.");
          }
        });
        return await done();
      }
      case "profile": {
        await earnOnce(shopDomain, customer, "COMPLETE_PROFILE", async () => {
          const { customer: profile } = await adminQuery(await getShopAdmin(shopDomain), PROFILE_QUERY, { id: customerGid });
          if (!profile?.firstName || !profile?.lastName || !profile?.defaultAddress) {
            throw new EarnError("Add your first name, last name and an address to your account first.");
          }
        });
        return await done();
      }
      case "birthday": {
        const birthday = parseBirthday(body.birthday);
        if (!birthday) throw new EarnError("Enter a valid date of birth.");
        await setBirthday(customer, birthday);
        return await done();
      }
      case "referral": {
        const result = await claimReferral(shopDomain, customer, body.token);
        return result === "linked" ? await done({ result }) : { ok: false, result, error: "Referral not applied." };
      }
      default:
        throw new EarnError("Unknown action.");
    }
  } catch (err) {
    if (err instanceof EarnError) return { ok: false, error: err.message };
    throw err;
  }
}
