import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import db from "../../db.server";
import logger from "../../logger.server";
import { getSettings } from "../settings/settings.server";
import { earnReward } from "./award.server";
import { getActiveRule } from "./rules.server";

// How referrals work (as in the original app):
// 1. A customer shares their link: the storefront with ?sigma_ref=<their referral code>.
// 2. A visitor opening it gets a signed token holding the code and the time (createReferralToken).
// 3. Once the visitor has created an account and is logged in, the widget sends the token back
//    (claimReferral): if the account was created after the click, the visitor is linked to the
//    referrer and gets the Referred by a friend points.
// 4. When the friend's first order is rewarded, the referrer gets the Refer a friend points
//    (awardOrderPoints in orders.server.js).

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
const CODE_LENGTH = 10;
export const TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const generateCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

/** The customer's referral code, created the first time it's needed. */
export async function getReferralCode(customer) {
  if (customer.referralCode) return customer.referralCode;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      // Only set when still empty, so two requests at once end up with the same code.
      await db.customer.updateMany({ where: { id: customer.id, referralCode: null }, data: { referralCode: code } });
    } catch (err) {
      if (err.code === "P2002") continue; // code taken by another customer of the shop; try another
      throw err;
    }
    const row = await db.customer.findUnique({ where: { id: customer.id }, select: { referralCode: true } });
    return row.referralCode;
  }
  throw new Error("Couldn't generate a unique referral code");
}

function sign(shopDomain, code, ts) {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("SHOPIFY_API_SECRET is not set");
  return createHmac("sha256", secret).update(`${shopDomain}:${code}:${ts}`).digest("base64url");
}

/**
 * A signed token for a visitor who opened a referral link, or null when the code isn't a customer of
 * this shop or the referral rules are off.
 */
export async function createReferralToken(shopDomain, code, now = Date.now()) {
  if (!/^[A-Z0-9]{4,20}$/.test(code ?? "")) return null;
  const referrer = await db.customer.findFirst({ where: { shop: { domain: shopDomain }, referralCode: code } });
  if (!referrer || referrer.excluded) return null;
  if (!(await referralEnabled(referrer.shopId))) return null;
  return `${code}.${now}.${sign(shopDomain, code, now)}`;
}

// Referrals are tracked while either side's rule is on.
async function referralEnabled(shopId) {
  const [referrer, friend] = await Promise.all([getActiveRule(shopId, "REFERRER"), getActiveRule(shopId, "REFERRED_FRIEND")]);
  return Boolean(referrer || friend);
}

// Returns { code, ts } for a valid, unexpired token of this shop, else null.
export function verifyReferralToken(shopDomain, token, now = Date.now()) {
  const [code, tsText, signature] = String(token ?? "").split(".");
  const ts = Number(tsText);
  if (!code || !Number.isSafeInteger(ts) || !signature) return null;
  const expected = Buffer.from(sign(shopDomain, code, ts));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (ts > now || now - ts > TOKEN_MAX_AGE_MS) return null;
  return { code, ts };
}

/**
 * Links a logged-in customer to the referrer whose link they opened, and gives them the Referred by a
 * friend points. Only for an account created after the click, by someone other than the referrer,
 * who wasn't referred before. Returns "linked", "invalid", "already-referred", "not-new", "self" or
 * "retry" (try again later).
 */
export async function claimReferral(shopDomain, customer, token, now = Date.now()) {
  const verified = verifyReferralToken(shopDomain, token, now);
  if (!verified) return "invalid";
  if (customer.referredById) return "already-referred";
  const referrer = await db.customer.findFirst({ where: { shopId: customer.shopId, referralCode: verified.code } });
  if (!referrer || referrer.excluded) return "invalid";
  if (referrer.id === customer.id) return "self";
  // Created by the widget before the customers/create webhook arrived: the real account creation
  // time isn't known yet, so the widget keeps the token and tries again later.
  if (!customer.shopifyCreatedAt) return "retry";
  const createdAt = customer.shopifyCreatedAt.getTime();
  const referrerCreatedAt = (referrer.shopifyCreatedAt ?? referrer.createdAt).getTime();
  if (createdAt < verified.ts || referrerCreatedAt > createdAt) return "not-new";
  if (!(await referralEnabled(customer.shopId))) return "invalid";

  const { count } = await db.customer.updateMany({
    where: { id: customer.id, referredById: null },
    data: { referredById: referrer.id },
  });
  if (!count) return "already-referred";
  logger.info({ shopId: customer.shopId, customerId: customer.id, referrerId: referrer.id }, "Referral linked");

  const rule = await getActiveRule(customer.shopId, "REFERRED_FRIEND");
  if (rule) {
    await earnReward(await getSettings(shopDomain), shopDomain, customer, rule, {
      type: "REFERRED_FRIEND",
      reason: rule.name,
      dedupeKey: "REFERRED_FRIEND",
    });
  }
  return "linked";
}
