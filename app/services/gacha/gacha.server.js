import db from "../../db.server";
import logger from "../../logger.server";
import { formatDiscountValue } from "../discounts/types";
import { ensureShop } from "../shops/shops.server";
import { GACHA_TIERS } from "./tiers";

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

/** Saves the tier of each rule in `tiers` ({ ruleId: tier | null }). Rules of other shops are left alone. */
export async function saveTiers(shopDomain, tiers) {
  const shop = await ensureShop(shopDomain);
  const byTier = new Map();
  for (const [id, tier] of Object.entries(tiers)) {
    byTier.set(tier, [...(byTier.get(tier) ?? []), Number(id)]);
  }
  await db.$transaction(
    [...byTier].map(([tier, ids]) =>
      db.discountRule.updateMany({ where: { shopId: shop.id, id: { in: ids } }, data: { gachaTier: tier } }),
    ),
  );
  logger.info({ shop: shopDomain, rules: Object.keys(tiers).length }, "Gacha tiers saved");
}
