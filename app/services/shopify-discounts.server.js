import logger from "../logger.server";

// Creates the Shopify code discount behind a DiscountCode (Admin GraphQL 2026-07).
// Requires the write_discounts + read_discounts scopes.
// FIXED_AMOUNT / PERCENTAGE -> DiscountCodeBasic, FREE_SHIPPING -> DiscountCodeFreeShipping.

const USER_ERRORS = "userErrors { field message code }";

const CREATE_BASIC = `#graphql
  mutation DiscountRuleCreateBasic($input: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $input) {
      codeDiscountNode { id }
      ${USER_ERRORS}
    }
  }`;

const UPDATE_BASIC = `#graphql
  mutation DiscountRuleUpdateBasic($id: ID!, $input: DiscountCodeBasicInput!) {
    discountCodeBasicUpdate(id: $id, basicCodeDiscount: $input) {
      codeDiscountNode { id }
      ${USER_ERRORS}
    }
  }`;

const CREATE_FREE_SHIPPING = `#graphql
  mutation DiscountRuleCreateFreeShipping($input: DiscountCodeFreeShippingInput!) {
    discountCodeFreeShippingCreate(freeShippingCodeDiscount: $input) {
      codeDiscountNode { id }
      ${USER_ERRORS}
    }
  }`;

const UPDATE_FREE_SHIPPING = `#graphql
  mutation DiscountRuleUpdateFreeShipping($id: ID!, $input: DiscountCodeFreeShippingInput!) {
    discountCodeFreeShippingUpdate(id: $id, freeShippingCodeDiscount: $input) {
      codeDiscountNode { id }
      ${USER_ERRORS}
    }
  }`;

const DELETE = `#graphql
  mutation DiscountRuleDelete($id: ID!) {
    discountCodeDelete(id: $id) {
      deletedCodeDiscountId
      ${USER_ERRORS}
    }
  }`;



// Shopify input field -> form field name, so userErrors can be shown next to the right input.
const FIELD_MAP = {
  title: "title",
  code: "code",
  customerGets: "discountValue",
  minimumRequirement: "minimumSubtotal",
  usageLimit: "usageLimit",
  customers: "customers",
  items: "products",
  startsAt: "startsAt",
  endsAt: "endsAt",
};

export class ShopifyDiscountError extends Error {
  constructor(message, fieldErrors = {}) {
    super(message);
    this.name = "ShopifyDiscountError";
    this.fieldErrors = fieldErrors;
  }
}

const isFreeShipping = (rule) => rule.discountType === "FREE_SHIPPING";

function minimumRequirement(rule, isUpdate) {
  if (rule.minimumSubtotal) {
    return { subtotal: { greaterThanOrEqualToSubtotal: String(rule.minimumSubtotal) } };
  }
  // Removing a minimum on update requires nulling both kinds; on create just omit it.
  return isUpdate
    ? {
        quantity: { greaterThanOrEqualToQuantity: null },
        subtotal: { greaterThanOrEqualToSubtotal: null },
      }
    : undefined;
}

// Targeting: { customers, products }, each either { all: true } or { add: [gid], remove: [gid] }.
// Omitted means all customers / all items.
function contextInput(customers) {
  if (!customers || customers.all) return { all: "ALL" };
  return { customers: { add: customers.add ?? [], remove: customers.remove ?? [] } };
}

function itemsInput(products) {
  if (!products || products.all) return { all: true };
  return {
    products: { productsToAdd: products.add ?? [], productsToRemove: products.remove ?? [] },
  };
}

function toInput(rule, { isUpdate = false, targeting } = {}) {
  const input = {
    title: rule.title,
    code: rule.code,
    startsAt: rule.startsAt.toISOString(),
    endsAt: rule.endsAt ? rule.endsAt.toISOString() : null,
    context: contextInput(targeting?.customers),
    minimumRequirement: minimumRequirement(rule, isUpdate),
    usageLimit: rule.usageLimit ?? null,
    appliesOncePerCustomer: rule.appliesOncePerCustomer,
  };

  if (isFreeShipping(rule)) {
    return { ...input, destination: { all: true } };
  }

  const value =
    rule.discountType === "PERCENTAGE"
      ? { percentage: Number(rule.discountValue) / 100 }
      : { discountAmount: { amount: String(rule.discountValue), appliesOnEachItem: false } };

  return { ...input, customerGets: { value, items: itemsInput(targeting?.products) } };
}

async function run(admin, query, variables, root) {
  let json;
  try {
    const response = await admin.graphql(query, { variables });
    json = await response.json();
  } catch (error) {
    // Network errors, GraphQL errors (e.g. missing scope -> ACCESS_DENIED), throttling
    logger.error({ err: error, op: root }, "Shopify discount request failed");
    const detail = error.body?.errors?.graphQLErrors?.[0]?.message || error.message;
    throw new ShopifyDiscountError(`Shopify request failed: ${detail}`);
  }

  const result = json.data?.[root];
  const userErrors = result?.userErrors ?? [];
  if (userErrors.length) {
    logger.warn({ op: root, userErrors }, "Shopify rejected discount");
    const fieldErrors = {};
    const general = [];
    for (const { field, message } of userErrors) {
      // Most specific segment wins, e.g. [..., "customerGets", "items"] -> products.
      const key = FIELD_MAP[[...(field ?? [])].reverse().find((f) => FIELD_MAP[f])];
      if (key && !fieldErrors[key]) fieldErrors[key] = message;
      else general.push(message);
    }
    throw new ShopifyDiscountError(general.join(" ") || "Shopify rejected the discount.", fieldErrors);
  }
  return result;
}


/** Creates the Shopify discount and returns its DiscountCodeNode GID. */
export async function createShopifyDiscount(admin, rule, targeting) {
  const [query, root] = isFreeShipping(rule)
    ? [CREATE_FREE_SHIPPING, "discountCodeFreeShippingCreate"]
    : [CREATE_BASIC, "discountCodeBasicCreate"];
  const result = await run(admin, query, { input: toInput(rule, { targeting }) }, root);
  return result.codeDiscountNode.id;
}

/** Updates the Shopify discount behind a code. The discount type can't change after creation. */
export async function updateShopifyDiscount(admin, previous, rule, targeting) {
  const [query, root] = isFreeShipping(rule)
    ? [UPDATE_FREE_SHIPPING, "discountCodeFreeShippingUpdate"]
    : [UPDATE_BASIC, "discountCodeBasicUpdate"];
  await run(admin, query, { id: previous.shopifyDiscountId, input: toInput(rule, { isUpdate: true, targeting }) }, root);
  return previous.shopifyDiscountId;
}

export async function deleteShopifyDiscount(admin, id) {
  await run(admin, DELETE, { id }, "discountCodeDelete");
}
