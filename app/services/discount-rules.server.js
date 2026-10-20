import db from "../db.server";
import logger from "../logger.server";
import { DISCOUNT_TYPES } from "./discount-types";
import { ensureShop } from "./shops.server";

// Discount rules are templates stored only in the app's database. Nothing is created in Shopify
// for a rule; Shopify discounts are created per discount code (see discount-codes.server.js).

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

/** Rule as plain form values (strings / booleans) for the edit page. */
export function toFormValues(rule) {
  return {
    title: rule?.title ?? "",
    pointsCost: rule?.pointsCost?.toString() ?? "",
    discountType: rule?.discountType ?? "FIXED_AMOUNT",
    discountValue: rule?.discountValue?.toString() ?? "",
    minimumSubtotal: rule?.minimumSubtotal?.toString() ?? "",
    usageLimit: rule?.usageLimit?.toString() ?? "",
    appliesOncePerCustomer: rule?.appliesOncePerCustomer ?? true,
    active: rule?.active ?? true,
  };
}

/**
 * Parses and validates the submitted form. Returns { data, values, errors }:
 * `values` echoes the raw input back to the form, `data` is ready for Prisma when errors is empty.
 */
export function parseRuleForm(formData) {
  const str = (k) => String(formData.get(k) ?? "").trim();
  const values = {
    title: str("title"),
    pointsCost: str("pointsCost"),
    discountType: str("discountType"),
    discountValue: str("discountValue"),
    minimumSubtotal: str("minimumSubtotal"),
    usageLimit: str("usageLimit"),
    appliesOncePerCustomer: formData.get("appliesOncePerCustomer") !== null,
    active: formData.get("active") !== null,
  };
  const errors = {};

  if (!values.title) errors.title = "Title is required.";
  else if (values.title.length > 191) errors.title = "Title must be 191 characters or fewer.";

  const pointsCost = Number(values.pointsCost);
  if (!Number.isInteger(pointsCost) || pointsCost < 1) {
    errors.pointsCost = "Points cost must be a whole number of at least 1.";
  }

  if (!DISCOUNT_TYPES[values.discountType]) errors.discountType = "Choose a discount type.";

  let discountValue = null;
  if (values.discountType !== "FREE_SHIPPING") {
    discountValue = Number(values.discountValue);
    if (!values.discountValue || !(discountValue > 0)) {
      errors.discountValue = "Enter a value greater than 0.";
    } else if (values.discountType === "PERCENTAGE" && discountValue > 100) {
      errors.discountValue = "Percentage can't be more than 100.";
    }
  }

  let minimumSubtotal = null;
  if (values.minimumSubtotal) {
    minimumSubtotal = Number(values.minimumSubtotal);
    if (!(minimumSubtotal > 0)) errors.minimumSubtotal = "Enter an amount greater than 0, or leave empty.";
  }

  let usageLimit = null;
  if (values.usageLimit) {
    usageLimit = Number(values.usageLimit);
    if (!Number.isInteger(usageLimit) || usageLimit < 1) {
      errors.usageLimit = "Enter a whole number of at least 1, or leave empty.";
    }
  }

  const data = {
    title: values.title,
    pointsCost,
    discountType: values.discountType,
    discountValue: discountValue === null ? null : discountValue.toFixed(2),
    minimumSubtotal: minimumSubtotal === null ? null : minimumSubtotal.toFixed(2),
    usageLimit,
    appliesOncePerCustomer: values.appliesOncePerCustomer,
    active: values.active,
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

/** Deletes a rule. Rules that still have discount codes can't be deleted. */
export async function deleteRule(shopDomain, id) {
  const rule = await getRule(shopDomain, id);
  if (!rule) return { ok: true };

  const codes = await db.discountCode.count({ where: { ruleId: rule.id } });
  if (codes > 0) {
    return {
      errors: {
        form: `This rule has ${codes} discount code${codes === 1 ? "" : "s"}. Delete them on the Discount codes page first.`,
      },
    };
  }

  await db.discountRule.delete({ where: { id: rule.id } });
  logger.info({ shop: shopDomain, ruleId: rule.id }, "Discount rule deleted");
  return { ok: true };
}
