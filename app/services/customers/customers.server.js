import db from "../../db.server";
import logger from "../../logger.server";
import { CUSTOMER_TABS } from "./tabs";

export const CUSTOMERS_PER_PAGE = 50;

export function parseCustomerFilters(searchParams) {
  const tab = searchParams.get("tab");
  return {
    query: (searchParams.get("q") ?? "").trim().slice(0, 100),
    page: Math.max(1, Number(searchParams.get("page")) || 1),
    tab: CUSTOMER_TABS[tab] ? tab : "all",
  };
}

// Every word must match the first name, last name or email, so "ha viet" finds Ha Viet.
// Matching is case-insensitive via the table's utf8mb4_unicode_ci collation.
function searchWhere(query) {
  const words = query.split(/\s+/).filter(Boolean);
  return words.map((word) => ({
    OR: [{ firstName: { contains: word } }, { lastName: { contains: word } }, { email: { contains: word } }],
  }));
}

/** One page (1-based) of the shop's customers in `tab` matching `query`, newest first, plus the match count. */
export async function listCustomers(shopDomain, { query = "", page = 1, tab = "all" } = {}) {
  const where = { shop: { domain: shopDomain }, ...CUSTOMER_TABS[tab].where, AND: searchWhere(query) };
  const [customers, total] = await Promise.all([
    db.customer.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (page - 1) * CUSTOMERS_PER_PAGE,
      take: CUSTOMERS_PER_PAGE,
    }),
    db.customer.count({ where }),
  ]);
  return { customers, total };
}

export function countCustomers(shopDomain) {
  return db.customer.count({ where: { shop: { domain: shopDomain } } });
}

/** A customer with their redeem history (newest first), or null if they aren't in this shop. */
export function getCustomer(shopDomain, id) {
  return db.customer.findFirst({
    where: { id, shop: { domain: shopDomain } },
    include: { redeemHistories: { orderBy: { createdAt: "desc" } } },
  });
}

/** Excludes the customer from the program, or includes them again. */
export async function setExcluded(customer, excluded) {
  await db.customer.update({ where: { id: customer.id }, data: { excluded } });
  logger.info({ shopId: customer.shopId, customerId: customer.id, excluded }, "Customer exclusion changed");
}

/** Customer fields from a customers/* webhook payload (REST shape: numeric id, snake_case). */
export function customerFromPayload(payload) {
  return {
    shopifyCustomerId: `gid://shopify/Customer/${payload.id}`,
    firstName: payload.first_name ?? null,
    lastName: payload.last_name ?? null,
    email: payload.email ?? null,
    state: String(payload.state ?? "disabled").toUpperCase(),
    shopifyCreatedAt: payload.created_at ? new Date(payload.created_at) : null,
    shopifyUpdatedAt: new Date(payload.updated_at ?? payload.created_at ?? Date.now()),
  };
}

// Only a payload at least as new as the stored row (or a row never updated by a webhook) is applied.
function updateIfNewer(shopDomain, data) {
  return db.customer.updateMany({
    where: {
      shop: { domain: shopDomain },
      shopifyCustomerId: data.shopifyCustomerId,
      OR: [{ shopifyUpdatedAt: null }, { shopifyUpdatedAt: { lte: data.shopifyUpdatedAt } }],
    },
    data,
  });
}

/**
 * Creates or updates the customer from a customers/create or customers/update payload. Webhooks can
 * be retried or arrive out of order, so a payload older than the stored row is ignored. Points and
 * exclusion are never touched. Returns "created", "updated" or "stale".
 */
export async function saveCustomer(shopDomain, payload) {
  const data = customerFromPayload(payload);
  if ((await updateIfNewer(shopDomain, data)).count) return "updated";
  try {
    await db.customer.create({
      data: {
        ...data,
        shop: { connectOrCreate: { where: { domain: shopDomain }, create: { domain: shopDomain } } },
      },
    });
    return "created";
  } catch (err) {
    if (err.code !== "P2002") throw err;
    // The row exists: either it is newer than this payload, or a concurrent webhook created it first.
    return (await updateIfNewer(shopDomain, data)).count ? "updated" : "stale";
  }
}

/**
 * Deletes the customer and, by cascade, their points ledger and redeem history. Used for
 * customers/delete and the customers/redact compliance webhook. Returns the number of rows deleted.
 */
export async function deleteCustomer(shopDomain, shopifyNumericId) {
  const { count } = await db.customer.deleteMany({
    where: { shop: { domain: shopDomain }, shopifyCustomerId: `gid://shopify/Customer/${shopifyNumericId}` },
  });
  return count;
}
