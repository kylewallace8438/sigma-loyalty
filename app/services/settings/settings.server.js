import db from "../../db.server";
import logger from "../../logger.server";
import { ensureShop } from "../shops/shops.server";

// A shop without a StoreSettings row uses these (they match the column defaults).
export const DEFAULT_SETTINGS = {
  programEnabled: false,
  pointsName: null,
  includeTax: false,
  rewardFulfilled: true,
  rewardGuests: true,
  refundEnabled: true,
  returnPointsOnRefund: true,
  pointExpirationEnabled: false,
  pointExpirationMonths: null,
};

const MAX_EXPIRATION_MONTHS = 120;

/** The shop's program settings (defaults if never saved). */
export async function getSettings(shopDomain) {
  const row = await db.storeSettings.findFirst({ where: { shop: { domain: shopDomain } } });
  if (!row) return { ...DEFAULT_SETTINGS };
  return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((key) => [key, row[key]]));
}

/** "Points", or the shop's own name for them. */
export const pointsLabel = (settings) => settings.pointsName || "Points";

/** Settings as form values (strings and booleans). */
export function toSettingsValues(settings) {
  return {
    programEnabled: settings.programEnabled,
    pointsName: settings.pointsName ?? "",
    includeTax: settings.includeTax,
    rewardFulfilled: settings.rewardFulfilled,
    pointExpirationEnabled: settings.pointExpirationEnabled,
    pointExpirationMonths: settings.pointExpirationMonths ? String(settings.pointExpirationMonths) : "",
  };
}

/**
 * Parses the settings form. Returns { data, values, errors }. Only the settings the merchant sees are
 * read; the refund and guest settings keep their stored values (they aren't in the UI, as in the
 * original app).
 */
export function parseSettingsForm(formData) {
  const values = {
    programEnabled: formData.get("programEnabled") !== null,
    pointsName: String(formData.get("pointsName") ?? "").trim(),
    includeTax: formData.get("includeTax") !== null,
    rewardFulfilled: formData.get("rewardFulfilled") !== null,
    pointExpirationEnabled: formData.get("pointExpirationEnabled") !== null,
    pointExpirationMonths: String(formData.get("pointExpirationMonths") ?? "").trim(),
  };
  const errors = {};

  if (values.pointsName.length > 50) errors.pointsName = "Use 50 characters or fewer.";

  let months = null;
  if (values.pointExpirationEnabled) {
    months = Number(values.pointExpirationMonths);
    if (!Number.isInteger(months) || months < 1 || months > MAX_EXPIRATION_MONTHS) {
      errors.pointExpirationMonths = `Enter a whole number of months from 1 to ${MAX_EXPIRATION_MONTHS}.`;
    }
  }

  const data = {
    programEnabled: values.programEnabled,
    pointsName: values.pointsName || null,
    includeTax: values.includeTax,
    rewardFulfilled: values.rewardFulfilled,
    pointExpirationEnabled: values.pointExpirationEnabled,
    pointExpirationMonths: months,
  };
  return { data, values, errors };
}

export async function saveSettings(shopDomain, data) {
  const shop = await ensureShop(shopDomain);
  await db.storeSettings.upsert({ where: { shopId: shop.id }, create: { shopId: shop.id, ...data }, update: data });
  // As in the original app, turning expiration off cancels every pending expiry. Turning it back on
  // starts a customer's period at their next earn or redeem.
  if (!data.pointExpirationEnabled) {
    await db.customer.updateMany({ where: { shopId: shop.id, pointsExpireAt: { not: null } }, data: { pointsExpireAt: null } });
  }
  logger.info({ shop: shopDomain, programEnabled: data.programEnabled }, "Store settings saved");
}
