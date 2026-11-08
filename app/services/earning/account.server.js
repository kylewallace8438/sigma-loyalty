import logger from "../../logger.server";
import { findCustomer } from "../customers/customers.server";
import { getSettings } from "../settings/settings.server";
import { earnPoints } from "./award.server";
import { getActiveRule } from "./rules.server";

/**
 * Create account rule, from the customers/create webhook (run after the customer is saved). Given
 * once; customers without an account (guests) only get it when the shop rewards guests, as in the
 * original app. Customers brought in by the bulk sync never get it.
 * Returns an earnPoints result, or "inactive", "guest" or "missing".
 */
export async function awardSignupPoints(shopDomain, payload) {
  const customer = await findCustomer(shopDomain, payload.id);
  if (!customer) return "missing";
  const rule = await getActiveRule(customer.shopId, "CREATE_ACCOUNT");
  if (!rule) return "inactive";
  const settings = await getSettings(shopDomain);
  if (!settings.rewardGuests && customer.state !== "ENABLED") return "guest";
  const result = await earnPoints(settings, customer, {
    type: "CREATE_ACCOUNT",
    points: rule.points,
    reason: rule.name,
    dedupeKey: "CREATE_ACCOUNT",
  });
  logger.info({ shop: shopDomain, customerId: customer.id, result }, "Sign-up points processed");
  return result;
}
