import db from "../../db.server";
import logger from "../../logger.server";
import { ensureShop } from "../shops/shops.server";
import { EARNING_GROUPS, EARNING_TYPE, EARNING_TYPES, ITEM_SCOPES, ORDER_METHODS } from "./types";

export const DEFAULT_POINTS = 10;
export const MAX_POINTS = 1_000_000;
const MAX_SPENT = 1_000_000;
const MAX_SELECTIONS = 100;
const MAX_URL_LENGTH = 500;

// Settings a rule of each kind has when it was never saved.
function defaultConfig(kind) {
  if (kind === "order") {
    return { method: ORDER_METHODS.FIXED, spent: 1, itemScope: ITEM_SCOPES.ALL, products: [], collections: [] };
  }
  if (kind === "birthday") return { requireNotice: true };
  if (kind === "social") return { url: "" };
  if (kind === "referral") return { rewardType: "POINTS", discountRuleId: null };
  return {};
}

// A stored row (or none) as a complete rule: { type, name, active, points, config }.
function toRule(type, row) {
  const meta = EARNING_TYPE[type];
  return {
    type,
    name: row?.name ?? meta.defaultName,
    active: row?.active ?? false,
    points: row?.points ?? DEFAULT_POINTS,
    config: { ...defaultConfig(meta.kind), ...(row?.config ?? {}) },
  };
}

/** Every earning rule of the shop (stored or default), grouped as in EARNING_GROUPS. */
export async function listEarningRules(shopDomain) {
  const rows = await db.earningRule.findMany({ where: { shop: { domain: shopDomain } } });
  const byType = Object.fromEntries(rows.map((r) => [r.type, r]));
  return EARNING_GROUPS.map((group) => ({
    ...group,
    rules: EARNING_TYPES.filter((t) => t.group === group.key).map((t) => toRule(t.type, byType[t.type])),
  }));
}

/** One rule of the shop (stored or default). `type` must be a valid EarningType. */
export async function getEarningRule(shopDomain, type) {
  const row = await db.earningRule.findFirst({ where: { shop: { domain: shopDomain }, type } });
  return toRule(type, row);
}

/** The rule if it is active, else null. Used when awarding points. */
export async function getActiveRule(shopId, type) {
  const row = await db.earningRule.findFirst({ where: { shopId, type, active: true } });
  return row ? toRule(type, row) : null;
}

/** All active rules of the shop, in EARNING_TYPES order. Used by the storefront widget. */
export async function listActiveRules(shopId) {
  const rows = await db.earningRule.findMany({ where: { shopId, active: true } });
  const byType = Object.fromEntries(rows.map((r) => [r.type, r]));
  return EARNING_TYPES.filter((t) => byType[t.type]).map((t) => toRule(t.type, byType[t.type]));
}

/** A rule as form values (strings, booleans and selection lists). */
export function toEarningFormValues(rule) {
  const { config } = rule;
  return {
    name: rule.name,
    active: rule.active,
    points: String(rule.points),
    method: config.method ?? "",
    spent: config.spent != null ? String(config.spent) : "",
    itemScope: config.itemScope ?? "",
    products: config.products ?? [],
    collections: config.collections ?? [],
    requireNotice: config.requireNotice ?? false,
    url: config.url ?? "",
    rewardType: config.rewardType ?? "POINTS",
    discountRuleId: config.discountRuleId != null ? String(config.discountRuleId) : "",
  };
}

// A JSON list of { id, title } picked with the resource picker; ids must be gids of `resource`.
function parseSelection(raw, resource) {
  let list;
  try {
    list = JSON.parse(raw || "[]");
  } catch {
    return null;
  }
  if (!Array.isArray(list) || list.length > MAX_SELECTIONS) return null;
  const prefix = `gid://shopify/${resource}/`;
  if (!list.every((item) => typeof item?.id === "string" && item.id.startsWith(prefix))) return null;
  return list.map((item) => ({ id: item.id, title: String(item.title ?? "").slice(0, 255) }));
}

function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** Parses the rule form for `type`. Returns { data: { name, active, points, config }, values, errors }. */
export function parseEarningRuleForm(type, formData) {
  const { kind } = EARNING_TYPE[type];
  const text = (key) => String(formData.get(key) ?? "").trim();
  const values = {
    name: text("name"),
    active: formData.get("active") !== null,
    points: text("points"),
    method: text("method"),
    spent: text("spent"),
    itemScope: text("itemScope"),
    products: parseSelection(formData.get("products"), "Product") ?? [],
    collections: parseSelection(formData.get("collections"), "Collection") ?? [],
    requireNotice: formData.get("requireNotice") !== null,
    url: text("url"),
    rewardType: text("rewardType") || "POINTS",
    discountRuleId: text("discountRuleId"),
  };
  const errors = {};
  // A referral rule can give a discount code instead of points; its points are then unused.
  const coupon = kind === "referral" && values.rewardType === "COUPON";

  if (!values.name) errors.name = "Enter a name. Customers see it in the widget and their history.";
  else if (values.name.length > 100) errors.name = "Use 100 characters or fewer.";

  let points = Number(values.points);
  if (coupon && !(Number.isInteger(points) && points >= 1 && points <= MAX_POINTS)) points = DEFAULT_POINTS;
  else if (!Number.isInteger(points) || points < 1 || points > MAX_POINTS) {
    errors.points = `Enter a whole number from 1 to ${MAX_POINTS.toLocaleString("en-US")}.`;
  }

  // Prisma can't write a plain null to a Json column, so rules without settings store {}.
  let config = {};
  if (kind === "order") {
    if (!Object.values(ORDER_METHODS).includes(values.method)) errors.method = "Choose how points are counted.";
    // Item filters only apply to points per amount spent (a fixed reward is per order, as in the original app).
    const perAmount = values.method === ORDER_METHODS.PER_AMOUNT;
    if (perAmount && !Object.values(ITEM_SCOPES).includes(values.itemScope)) {
      errors.itemScope = "Choose which items count.";
    }
    let spent = 1;
    if (perAmount) {
      spent = Number(values.spent);
      if (!(spent > 0) || spent > MAX_SPENT || Math.round(spent * 100) !== spent * 100) {
        errors.spent = "Enter an amount greater than 0, with at most 2 decimals.";
      }
    }
    const scoped = perAmount && (values.itemScope === ITEM_SCOPES.INCLUDE || values.itemScope === ITEM_SCOPES.EXCLUDE);
    if (
      parseSelection(formData.get("products"), "Product") === null ||
      parseSelection(formData.get("collections"), "Collection") === null
    ) {
      errors.items = `Select up to ${MAX_SELECTIONS} products and ${MAX_SELECTIONS} collections.`;
    } else if (scoped && !values.products.length && !values.collections.length) {
      errors.items = "Select at least one product or collection.";
    }
    config = {
      method: values.method,
      spent,
      itemScope: perAmount ? values.itemScope : ITEM_SCOPES.ALL,
      products: scoped ? values.products : [],
      collections: scoped ? values.collections : [],
    };
  } else if (kind === "birthday") {
    config = { requireNotice: values.requireNotice };
  } else if (kind === "referral") {
    if (!["POINTS", "COUPON"].includes(values.rewardType)) errors.rewardType = "Choose the reward.";
    const discountRuleId = Number(values.discountRuleId);
    if (coupon && !(Number.isInteger(discountRuleId) && discountRuleId > 0)) {
      errors.discountRuleId = "Choose the discount rule whose code is given.";
    }
    config = { rewardType: values.rewardType, discountRuleId: coupon ? discountRuleId : null };
  } else if (kind === "social") {
    if (!isHttpUrl(values.url)) errors.url = "Enter a full link starting with https://.";
    else if (values.url.length > MAX_URL_LENGTH) errors.url = `Use ${MAX_URL_LENGTH} characters or fewer.`;
    config = { url: values.url };
  }

  return { data: { name: values.name, active: values.active, points, config }, values, errors };
}

export async function saveEarningRule(shopDomain, type, data) {
  const shop = await ensureShop(shopDomain);
  await db.earningRule.upsert({
    where: { shopId_type: { shopId: shop.id, type } },
    create: { shopId: shop.id, type, ...data },
    update: data,
  });
  logger.info({ shop: shopDomain, type, active: data.active, points: data.points }, "Earning rule saved");
}
