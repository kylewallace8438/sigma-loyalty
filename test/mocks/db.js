import { beforeEach, vi } from "vitest";

const MODELS = ["session", "shop", "customer", "redeemHistory", "discountRule", "order", "gachaSettings", "pointHistory", "storeSettings", "earningRule", "tierProgram", "tier", "tierReward", "tierHistory", "tierCredit", "plan", "planFeature", "shopFeature", "subscription", "subscriptionUsage"];
const METHODS = ["aggregate", "groupBy", "findMany", "findFirst", "findUnique", "count", "create", "update", "upsert", "delete", "deleteMany", "updateMany"];

/** Prisma client stand-in: every model method is a vi.fn() (reset before each test). */
export const db = {};
for (const model of MODELS) {
  db[model] = Object.fromEntries(METHODS.map((m) => [m, vi.fn()]));
}
// Interactive transactions get the same fake client; array transactions resolve each promise.
db.$transaction = vi.fn((arg) => (typeof arg === "function" ? arg(db) : Promise.all(arg)));

// Every shop is on a plan with every feature on unless a test says otherwise (see billing tests).
export const FREE_SUBSCRIPTION = {
  id: 1,
  shopId: 7,
  startsAt: new Date("2026-01-01T00:00:00Z"),
  plan: {
    name: "Free",
    description: "Every feature, no limits.",
    price: 0,
    features: [
      "orders.monthly_limit",
      "earning.newsletter",
      "earning.birthday",
      "earning.referral",
      "earning.social",
      "earning.complete_profile",
      "redeem.free_product",
      "tier.vip_tiers",
      "tier.manual_change",
      "points.expiration",
    ].map((code) => ({ code, value: code === "orders.monthly_limit" ? "UNLIMITED" : "Y" })),
  },
};

beforeEach(() => {
  for (const model of MODELS) for (const m of METHODS) db[model][m].mockReset();
  db.subscription.findFirst.mockResolvedValue(FREE_SUBSCRIPTION);
  db.shopFeature.findMany.mockResolvedValue([]);
});
