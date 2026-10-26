import { describe, expect, it } from "vitest";
import { db } from "../../mocks/db";
import { getOverview } from "../../../app/services/overview/overview.server";

// Wednesday 2026-10-28 15:00 UTC: this week starts Mon 10-26, last week Mon 10-19.
const NOW = new Date("2026-10-28T15:00:00Z");
const THIS_WEEK = new Date("2026-10-26T00:00:00Z");
const LAST_WEEK = new Date("2026-10-19T00:00:00Z");

// Count stubs keyed by the date range in the query; anything else is the all-customers count.
function stubCounts({ customers, codes, created }) {
  const range = (where) => where.createdAt ?? where.shopifyCreatedAt;
  const pick = (where, [thisWeek, lastWeek]) => (range(where).gte.getTime() === THIS_WEEK.getTime() ? thisWeek : lastWeek);
  db.customer.count.mockImplementation(async ({ where }) => (where.shopifyCreatedAt ? pick(where, created) : customers));
  db.redeemHistory.count.mockImplementation(async ({ where }) => pick(where, codes));
}

describe("getOverview", () => {
  it("compares Monday-to-now against the full previous week", async () => {
    stubCounts({ customers: 40, codes: [6, 4], created: [3, 3] });

    const overview = await getOverview("a.myshopify.com", NOW);

    expect(overview).toEqual({
      customers: 40,
      codesUsed: { thisWeek: 6, lastWeek: 4, change: 50 },
      newCustomers: { thisWeek: 3, lastWeek: 3, change: 0 },
    });
    const ranges = db.redeemHistory.count.mock.calls.map(([{ where }]) => where.createdAt);
    expect(ranges).toEqual([
      { gte: THIS_WEEK, lt: NOW },
      { gte: LAST_WEEK, lt: THIS_WEEK },
    ]);
  });

  it("rounds decreases and returns null change when last week was 0", async () => {
    stubCounts({ customers: 0, codes: [1, 3], created: [5, 0] });

    const overview = await getOverview("a.myshopify.com", NOW);

    expect(overview.codesUsed.change).toBe(-67);
    expect(overview.newCustomers.change).toBeNull();
  });

  it("treats Sunday as the end of the week, not the start", async () => {
    stubCounts({ customers: 0, codes: [0, 0], created: [0, 0] });
    const sunday = new Date("2026-11-01T23:00:00Z");

    await getOverview("a.myshopify.com", sunday);

    expect(db.redeemHistory.count.mock.calls[0][0].where.createdAt.gte).toEqual(THIS_WEEK);
  });

  it("only counts the requested shop", async () => {
    stubCounts({ customers: 0, codes: [0, 0], created: [0, 0] });

    await getOverview("a.myshopify.com", NOW);

    for (const [{ where }] of [...db.customer.count.mock.calls, ...db.redeemHistory.count.mock.calls]) {
      expect(where.shop).toEqual({ domain: "a.myshopify.com" });
    }
  });
});
