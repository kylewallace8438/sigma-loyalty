import db from "../../db.server";
import logger from "../../logger.server";
import { formatDiscountValue } from "../discounts/types";
import { ensureShop } from "../shops/shops.server";
import { GACHA_TIERS, validatePity } from "./tiers";

/** All of a shop's rules with their gacha tier, as plain objects for the gacha page. */
export async function listGachaRules(shopDomain) {
  const rules = await db.discountRule.findMany({
    where: { shop: { domain: shopDomain } },
    orderBy: [{ active: "desc" }, { pointsCost: "asc" }],
  });
  return rules.map((rule) => ({
    id: rule.id,
    title: rule.title,
    pointsCost: rule.pointsCost,
    value: formatDiscountValue(rule),
    active: rule.active,
    tier: rule.gachaTier ?? "",
  }));
}

/** Reads the `tier-<ruleId>` fields of the gacha form into { ruleId: tier | null }, ignoring bad values. */
export function parseTierForm(formData) {
  const tiers = {};
  for (const [key, value] of formData.entries()) {
    const id = Number(key.match(/^tier-(\d+)$/)?.[1]);
    if (!id) continue;
    if (value === "") tiers[id] = null;
    else if (GACHA_TIERS[value]) tiers[id] = value;
  }
  return tiers;
}

// One updateMany per tier. Rules of other shops are left alone.
function tierUpdates(shopId, tiers) {
  const byTier = new Map();
  for (const [id, tier] of Object.entries(tiers)) {
    byTier.set(tier, [...(byTier.get(tier) ?? []), Number(id)]);
  }
  return [...byTier].map(([tier, ids]) =>
    db.discountRule.updateMany({ where: { shopId, id: { in: ids } }, data: { gachaTier: tier } }),
  );
}

/** The shop's guarantee settings as form values ({ goldPity, purplePity } strings, empty = none). */
export async function getPityValues(shopDomain) {
  const settings = await db.gachaSettings.findFirst({ where: { shop: { domain: shopDomain } } });
  return {
    goldPity: settings?.goldPity ? String(settings.goldPity) : "",
    purplePity: settings?.purplePity ? String(settings.purplePity) : "",
  };
}

/** Reads the guarantee fields of the gacha setup form. Returns { pity, values, errors } (see validatePity). */
export function parsePityForm(formData) {
  const values = {
    goldPity: String(formData.get("goldPity") ?? "").trim(),
    purplePity: String(formData.get("purplePity") ?? "").trim(),
  };
  return { values, ...validatePity(values) };
}

/** Saves the gacha items' tiers ({ ruleId: tier | null }) and the guarantees ({ gold, purple }) together. */
export async function saveGachaSetup(shopDomain, tiers, pity) {
  const shop = await ensureShop(shopDomain);
  const data = { goldPity: pity.gold, purplePity: pity.purple };
  await db.$transaction([
    ...tierUpdates(shop.id, tiers),
    db.gachaSettings.upsert({ where: { shopId: shop.id }, create: { shopId: shop.id, ...data }, update: data }),
  ]);
  logger.info({ shop: shopDomain, rules: Object.keys(tiers).length, pity }, "Gacha setup saved");
}
