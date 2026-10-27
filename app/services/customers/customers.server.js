import db from "../../db.server";

export const CUSTOMERS_PER_PAGE = 50;

export function parseCustomerFilters(searchParams) {
  return {
    query: (searchParams.get("q") ?? "").trim().slice(0, 100),
    page: Math.max(1, Number(searchParams.get("page")) || 1),
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

/** One page (1-based) of the shop's synced customers matching `query`, newest first, plus the match count. */
export async function listCustomers(shopDomain, { query = "", page = 1 } = {}) {
  const where = { shop: { domain: shopDomain }, AND: searchWhere(query) };
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
