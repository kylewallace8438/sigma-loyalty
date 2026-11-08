import { Prisma } from "@prisma/client";
import db from "../../db.server";
import logger from "../../logger.server";
import { DISCOUNT_TYPES, SPEND_MODES } from "./types";
import { ensureShop } from "../shops/shops.server";

// Discount rules are the rewards customers redeem points for. A rule itself creates nothing in
// Shopify: each redemption creates a one-customer discount code (see redeem.server.js).

const MAX_EXPIRES_IN_DAYS = 3650;
const MAX_COLLECTIONS = 100;

/** Reads list filters from URL search params, ignoring unknown values. */
export function parseRuleFilters(searchParams) {
  const status = searchParams.get("status");
  const type = searchParams.get("type");
  return {
    query: (searchParams.get("q") ?? "").trim().slice(0, 100),
    status: status === "active" || status === "inactive" ? status : "",
    type: DISCOUNT_TYPES[type] ? type : "",
  };
}

/**
 * Lists a shop's rules. `query` matches the title (case-insensitive with the table's
 * utf8mb4_unicode_ci collation); `status` is "active" | "inactive"; `type` is a DiscountType.
 */
export function listRules(shopDomain, { query = "", status = "", type = "" } = {}) {
  return db.discountRule.findMany({
    where: {
      shop: { domain: shopDomain },
      ...(query && { title: { contains: query } }),
      ...(status && { active: status === "active" }),
      ...(type && { discountType: type }),
    },
    orderBy: [{ active: "desc" }, { pointsCost: "asc" }],
  });
}

export function countRules(shopDomain) {
  return db.discountRule.count({ where: { shop: { domain: shopDomain } } });
}

export function getRule(shopDomain, id) {
  return db.discountRule.findFirst({ where: { id, shop: { domain: shopDomain } } });
}

const str = (value) => (value == null ? "" : String(value));

/** Rule as plain form values (strings / booleans / selections) for the edit page. */
export function toFormValues(rule) {
  return {
    title: rule?.title ?? "",
    pointsCost: str(rule?.pointsCost),
    discountType: rule?.discountType ?? "FIXED_AMOUNT",
    discountValue: str(rule?.discountValue),
    minimumSubtotal: str(rule?.minimumSubtotal),
    usageLimit: str(rule?.usageLimit),
    perCustomerLimit: str(rule?.perCustomerLimit),
    appliesOncePerCustomer: rule?.appliesOncePerCustomer ?? true,
    active: rule?.active ?? true,
    spendMode: rule?.spendMode ?? SPEND_MODES.FIXED,
    minPoints: str(rule?.minPoints),
    maxPoints: str(rule?.maxPoints),
    expiresInDays: str(rule?.expiresInDays),
    collections: rule?.collections ?? [],
    product: rule?.product ?? null,
    maxShippingFee: str(rule?.maxShippingFee),
    combinesWithOrder: rule?.combinesWithOrder ?? false,
    combinesWithProduct: rule?.combinesWithProduct ?? false,
    combinesWithShipping: rule?.combinesWithShipping ?? false,
  };
}

// A JSON list of { id, title } from the resource picker; ids must be gids of `resource`. null if invalid.
function parsePicked(raw, resource, max) {
  let list;
  try {
    list = JSON.parse(raw || "[]");
  } catch {
    return null;
  }
  if (!Array.isArray(list) || list.length > max) return null;
  const prefix = `gid://shopify/${resource}/`;
  if (!list.every((item) => typeof item?.id === "string" && item.id.startsWith(prefix))) return null;
  return list.map((item) => ({ id: item.id, title: String(item.title ?? "").slice(0, 255) }));
}

/**
 * Parses and validates the submitted form. Returns { data, values, errors }:
 * `values` echoes the raw input back to the form, `data` is ready for Prisma when errors is empty.
 */
export function parseRuleForm(formData) {
  const text = (k) => String(formData.get(k) ?? "").trim();
  const checked = (k) => formData.get(k) !== null;
  const collections = parsePicked(formData.get("collections"), "Collection", MAX_COLLECTIONS);
  const products = parsePicked(formData.get("product"), "Product", 1);
  const values = {
    title: text("title"),
    pointsCost: text("pointsCost"),
    discountType: text("discountType"),
    discountValue: text("discountValue"),
    minimumSubtotal: text("minimumSubtotal"),
    usageLimit: text("usageLimit"),
    perCustomerLimit: text("perCustomerLimit"),
    appliesOncePerCustomer: checked("appliesOncePerCustomer"),
    active: checked("active"),
    spendMode: text("spendMode") || SPEND_MODES.FIXED,
    minPoints: text("minPoints"),
    maxPoints: text("maxPoints"),
    expiresInDays: text("expiresInDays"),
    collections: collections ?? [],
    product: products?.[0] ?? null,
    maxShippingFee: text("maxShippingFee"),
    combinesWithOrder: checked("combinesWithOrder"),
    combinesWithProduct: checked("combinesWithProduct"),
    combinesWithShipping: checked("combinesWithShipping"),
  };
  const errors = {};
  const type = values.discountType;

  // Optional whole number in [min, max]; null when empty. Records an error on `key` when invalid.
  const optionalInt = (key, min, max = Number.MAX_SAFE_INTEGER) => {
    if (!values[key]) return null;
    const n = Number(values[key]);
    if (!Number.isInteger(n) || n < min || n > max) {
      const range = max < Number.MAX_SAFE_INTEGER ? ` to ${max.toLocaleString("en-US")}` : " or more";
      errors[key] = `Enter a whole number of ${min.toLocaleString("en-US")}${range}, or leave empty.`;
      return null;
    }
    return n;
  };
  // Optional amount > 0 as a 2-decimal string; null when empty.
  const optionalMoney = (key) => {
    if (!values[key]) return null;
    const n = Number(values[key]);
    if (!(n > 0)) {
      errors[key] = "Enter an amount greater than 0, or leave empty.";
      return null;
    }
    return n.toFixed(2);
  };

  if (!values.title) errors.title = "Title is required.";
  else if (values.title.length > 191) errors.title = "Title must be 191 characters or fewer.";

  const pointsCost = Number(values.pointsCost);
  if (!Number.isInteger(pointsCost) || pointsCost < 1) {
    errors.pointsCost = "Points cost must be a whole number of at least 1.";
  }

  if (!DISCOUNT_TYPES[type]) errors.discountType = "Choose a discount type.";

  let discountValue = null;
  if (type !== "FREE_SHIPPING") {
    discountValue = Number(values.discountValue);
    if (!values.discountValue || !(discountValue > 0)) {
      errors.discountValue = "Enter a value greater than 0.";
    } else if (type === "PERCENTAGE" && discountValue > 100) {
      errors.discountValue = "Percentage can't be more than 100.";
    }
  }

  // Customers choose how many points to spend: fixed amount off only (as in the original app).
  if (!Object.values(SPEND_MODES).includes(values.spendMode)) errors.spendMode = "Choose how customers spend points.";
  const increment = type === "FIXED_AMOUNT" && values.spendMode === SPEND_MODES.INCREMENT;
  let minPoints = null;
  let maxPoints = null;
  if (increment && !errors.pointsCost) {
    minPoints = optionalInt("minPoints", pointsCost);
    maxPoints = optionalInt("maxPoints", pointsCost);
    if (minPoints && minPoints % pointsCost) errors.minPoints = `Use a multiple of the points cost (${pointsCost}).`;
    if (maxPoints && maxPoints % pointsCost) errors.maxPoints = `Use a multiple of the points cost (${pointsCost}).`;
    if (minPoints && maxPoints && maxPoints < minPoints) errors.maxPoints = "Must be at least the minimum.";
  }

  const scopedType = type === "FIXED_AMOUNT" || type === "PERCENTAGE";
  if (collections === null) errors.collections = `Select up to ${MAX_COLLECTIONS} collections.`;
  if (products === null) errors.product = "Select one product.";
  else if (type === "FREE_PRODUCT" && !values.product) errors.product = "Select the product this reward gives.";

  const data = {
    title: values.title,
    pointsCost,
    discountType: type,
    discountValue: discountValue === null ? null : discountValue.toFixed(2),
    minimumSubtotal: optionalMoney("minimumSubtotal"),
    usageLimit: optionalInt("usageLimit", 1),
    perCustomerLimit: optionalInt("perCustomerLimit", 1),
    appliesOncePerCustomer: values.appliesOncePerCustomer,
    active: values.active,
    spendMode: increment ? SPEND_MODES.INCREMENT : SPEND_MODES.FIXED,
    minPoints,
    maxPoints,
    expiresInDays: optionalInt("expiresInDays", 1, MAX_EXPIRES_IN_DAYS),
    // Prisma can't write a plain null to a Json column; DbNull clears it.
    collections: scopedType && values.collections.length ? values.collections : Prisma.DbNull,
    product: type === "FREE_PRODUCT" && values.product ? values.product : Prisma.DbNull,
    maxShippingFee: type === "FREE_SHIPPING" ? optionalMoney("maxShippingFee") : null,
    combinesWithOrder: values.combinesWithOrder,
    combinesWithProduct: values.combinesWithProduct,
    combinesWithShipping: values.combinesWithShipping,
  };

  return { data, values, errors };
}

/** Creates (id = null) or updates a rule. Returns { rule } or { errors }. */
export async function saveRule(shopDomain, id, data) {
  const shop = await ensureShop(shopDomain);

  if (id && !(await getRule(shopDomain, id))) return { errors: { form: "This rule no longer exists." } };

  const rule = id
    ? await db.discountRule.update({ where: { id }, data })
    : await db.discountRule.create({ data: { ...data, shopId: shop.id } });
  logger.info({ shop: shopDomain, ruleId: rule.id, created: !id }, "Discount rule saved");
  return { rule };
}

/** Deletes a rule. Codes already issued stay valid in Shopify and keep their history (rule unlinked). */
export async function deleteRule(shopDomain, id) {
  const rule = await getRule(shopDomain, id);
  if (!rule) return { ok: true };

  await db.discountRule.delete({ where: { id: rule.id } });
  logger.info({ shop: shopDomain, ruleId: rule.id }, "Discount rule deleted");
  return { ok: true };
}
