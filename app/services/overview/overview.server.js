import db from "../../db.server";

const DAY_MS = 24 * 60 * 60 * 1000;

// Start of the current week (Monday 00:00 UTC).
function startOfWeek(now) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return new Date(start.getTime() - ((start.getUTCDay() + 6) % 7) * DAY_MS);
}

// Percent change from `previous` to `current`; null when there's nothing to compare against.
function percentChange(current, previous) {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function weekOverWeek(thisWeek, lastWeek) {
  return { thisWeek, lastWeek, change: percentChange(thisWeek, lastWeek) };
}

/** Home screen numbers. Weeks run Monday–Sunday (UTC); this week is counted up to now. */
export async function getOverview(shopDomain, now = new Date()) {
  const thisWeek = startOfWeek(now);
  const lastWeek = new Date(thisWeek.getTime() - 7 * DAY_MS);
  const shop = { shop: { domain: shopDomain } };
  const customersCreated = (gte, lt) =>
    db.customer.count({ where: { ...shop, shopifyCreatedAt: { gte, lt } } });
  const codesUsed = (gte, lt) => db.redeemHistory.count({ where: { ...shop, createdAt: { gte, lt } } });

  const [customers, codesThisWeek, codesLastWeek, newThisWeek, newLastWeek] = await Promise.all([
    db.customer.count({ where: shop }),
    codesUsed(thisWeek, now),
    codesUsed(lastWeek, thisWeek),
    customersCreated(thisWeek, now),
    customersCreated(lastWeek, thisWeek),
  ]);

  return {
    customers,
    codesUsed: weekOverWeek(codesThisWeek, codesLastWeek),
    newCustomers: weekOverWeek(newThisWeek, newLastWeek),
  };
}
