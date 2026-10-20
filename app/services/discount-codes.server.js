import db from "../db.server";
import logger from "../logger.server";
import { ensureShop } from "./shops.server";
import {
  ShopifyDiscountError,
  createShopifyDiscount,
  deleteShopifyDiscount,
  updateShopifyDiscount,
} from "./shopify-discounts.server";

const CODE_PATTERN = /^[A-Za-z0-9_-]{3,40}$/;
const MAX_TARGETS = 100;

export function listCodes(shopDomain) {
  return db.discountCode.findMany({
    where: { shop: { domain: shopDomain } },
    include: { rule: { select: { id: true, title: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export function getCode(shopDomain, id) {
  return db.discountCode.findFirst({
    where: { id, shop: { domain: shopDomain } },
    include: { rule: { select: { id: true, title: true } } },
  });
}

export function countCodesForRule(ruleId) {
  return db.discountCode.count({ where: { ruleId } });
}

/** Active rules offered when creating a code. */
export function listRuleOptions(shopDomain) {
  return db.discountRule.findMany({
    where: { shop: { domain: shopDomain }, active: true },
    select: { id: true, title: true, discountType: true },
    orderBy: { title: "asc" },
  });
}

/** Scheduled | Active | Expired, from the code's dates. */
export function codeStatus(code, now = new Date()) {
  if (code.startsAt > now) return "Scheduled";
  if (code.endsAt && code.endsAt < now) return "Expired";
  return "Active";
}

const day = (d) => (d ? d.toISOString().slice(0, 10) : "");

export function toFormValues(code) {
  return {
    ruleId: code?.ruleId?.toString() ?? "",
    code: code?.code ?? "",
    startsAt: day(code?.startsAt ?? new Date()),
    endsAt: day(code?.endsAt),
    customers: code?.customers ?? [],
    products: code?.products ?? [],
  };
}

function parseTargets(raw, gidPrefix, pick) {
  let list;
  try {
    list = JSON.parse(raw || "[]");
  } catch {
    return null;
  }
  if (!Array.isArray(list) || list.length > MAX_TARGETS) return null;
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (typeof item?.id !== "string" || !item.id.startsWith(gidPrefix) || seen.has(item.id)) return null;
    seen.add(item.id);
    out.push(pick(item));
  }
  return out;
}

/** Validates the submitted form. `isNew` controls whether rule and code may be set. */
export function parseCodeForm(formData, { isNew }) {
  const str = (k) => String(formData.get(k) ?? "").trim();
  const errors = {};

  const customers = parseTargets(str("customers"), "gid://shopify/Customer/", (c) => ({
    id: c.id,
    displayName: String(c.displayName ?? "").slice(0, 191),
    email: c.email ? String(c.email).slice(0, 191) : null,
  }));
  if (!customers) errors.customers = `Select up to ${MAX_TARGETS} customers.`;

  const products = parseTargets(str("products"), "gid://shopify/Product/", (p) => ({
    id: p.id,
    title: String(p.title ?? "").slice(0, 191),
  }));
  if (!products) errors.products = `Select up to ${MAX_TARGETS} products.`;

  const values = {
    ruleId: str("ruleId"),
    code: str("code").toUpperCase(),
    startsAt: str("startsAt"),
    endsAt: str("endsAt"),
    customers: customers ?? [],
    products: products ?? [],
  };

  const ruleId = Number(values.ruleId);
  if (isNew && (!Number.isInteger(ruleId) || ruleId < 1)) errors.ruleId = "Choose a discount rule.";
  if (isNew && !CODE_PATTERN.test(values.code)) {
    errors.code = "Use 3–40 letters, numbers, dashes or underscores.";
  }

  // Whole days in UTC: valid from 00:00 on the start date to 23:59:59 on the end date.
  const startsAt = values.startsAt ? new Date(`${values.startsAt}T00:00:00Z`) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) errors.startsAt = "Choose a start date.";
  const endsAt = values.endsAt ? new Date(`${values.endsAt}T23:59:59Z`) : null;
  if (endsAt && (Number.isNaN(endsAt.getTime()) || (startsAt && endsAt <= startsAt))) {
    errors.endsAt = "End date must be after the start date.";
  }

  return {
    values,
    errors,
    data: { ruleId, code: values.code, startsAt, endsAt, customers: values.customers, products: values.products },
  };
}

/**
 * Shopify targeting for a list change. Empty list = everyone/everything. When the previous
 * selection was specific too, only the difference is sent (add/remove).
 */
function targetDiff(previous, next) {
  if (next.length === 0) return { all: true };
  const prevIds = new Set((previous ?? []).map((t) => t.id));
  const nextIds = new Set(next.map((t) => t.id));
  if (prevIds.size === 0) return { add: [...nextIds] };
  return {
    add: [...nextIds].filter((id) => !prevIds.has(id)),
    remove: [...prevIds].filter((id) => !nextIds.has(id)),
  };
}

function shopifyErrors(error) {
  if (!(error instanceof ShopifyDiscountError)) throw error;
  return { errors: { ...error.fieldErrors, form: error.message } };
}

/**
 * Creates a code from a rule (Shopify first, then the DB with the Shopify discount ID).
 * Returns { code } or { errors }.
 */
export async function createCode(admin, shopDomain, data) {
  const shop = await ensureShop(shopDomain);
  const rule = await db.discountRule.findFirst({ where: { id: data.ruleId, shopId: shop.id } });
  if (!rule) return { errors: { ruleId: "Choose a discount rule." } };

  if (await db.discountCode.findFirst({ where: { shopId: shop.id, code: data.code } })) {
    return { errors: { code: "Another discount code already uses this code." } };
  }

  const products = rule.discountType === "FREE_SHIPPING" ? [] : data.products;
  const snapshot = {
    title: `${rule.title} (${data.code})`,
    discountType: rule.discountType,
    discountValue: rule.discountValue,
    minimumSubtotal: rule.minimumSubtotal,
    usageLimit: rule.usageLimit,
    appliesOncePerCustomer: rule.appliesOncePerCustomer,
  };
  const discount = { ...snapshot, code: data.code, startsAt: data.startsAt, endsAt: data.endsAt };

  let shopifyDiscountId;
  try {
    shopifyDiscountId = await createShopifyDiscount(admin, discount, {
      customers: targetDiff([], data.customers),
      products: targetDiff([], products),
    });
  } catch (error) {
    return shopifyErrors(error);
  }

  try {
    const code = await db.discountCode.create({
      data: {
        ...discount,
        shopId: shop.id,
        ruleId: rule.id,
        customers: data.customers,
        products,
        shopifyDiscountId,
        syncedAt: new Date(),
      },
    });
    logger.info({ shop: shopDomain, codeId: code.id, ruleId: rule.id, shopifyDiscountId }, "Discount code created");
    return { code };
  } catch (error) {
    logger.error({ err: error, shop: shopDomain, shopifyDiscountId }, "Saving discount code failed");
    await deleteShopifyDiscount(admin, shopifyDiscountId).catch((err) =>
      logger.error({ err, shopifyDiscountId }, "Rollback of Shopify discount failed"),
    );
    return { errors: { form: "The discount was sent to Shopify but couldn't be saved. Please try again." } };
  }
}

/** Updates a code's customers, products and dates (rule and code are fixed after creation). */
export async function updateCode(admin, shopDomain, id, data) {
  const previous = await getCode(shopDomain, id);
  if (!previous) return { errors: { form: "This discount code no longer exists." } };

  const products = previous.discountType === "FREE_SHIPPING" ? [] : data.products;
  const discount = { ...previous, startsAt: data.startsAt, endsAt: data.endsAt };
  try {
    await updateShopifyDiscount(admin, previous, discount, {
      customers: targetDiff(previous.customers, data.customers),
      products: targetDiff(previous.products, products),
    });
  } catch (error) {
    return shopifyErrors(error);
  }

  const code = await db.discountCode.update({
    where: { id: previous.id },
    data: { startsAt: data.startsAt, endsAt: data.endsAt, customers: data.customers, products, syncedAt: new Date() },
  });
  logger.info({ shop: shopDomain, codeId: code.id }, "Discount code updated");
  return { code };
}

/** Deletes the Shopify discount, then the code. A discount already gone from Shopify is ignored. */
export async function deleteCode(admin, shopDomain, id) {
  const code = await getCode(shopDomain, id);
  if (!code) return { ok: true };

  try {
    await deleteShopifyDiscount(admin, code.shopifyDiscountId);
  } catch (error) {
    const notFound = /does not exist|not found/i.test(error.message);
    if (!(error instanceof ShopifyDiscountError) || !notFound) return { errors: { form: error.message } };
  }

  await db.discountCode.delete({ where: { id: code.id } });
  logger.info({ shop: shopDomain, codeId: code.id }, "Discount code deleted");
  return { ok: true };
}
