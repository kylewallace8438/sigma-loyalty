import { describe, expect, it, vi } from "vitest";
import { db } from "../../mocks/db";
import { getCustomerSyncProgress, startCustomerSync, syncCustomers } from "../../../app/services/customers/sync.server";

const shop = { id: 7, domain: "a.myshopify.com" };

const customer = (n) => ({
  id: `gid://shopify/Customer/${n}`,
  firstName: `First${n}`,
  lastName: null,
  createdAt: "2026-10-20T10:00:00Z",
  defaultEmailAddress: n % 2 ? { emailAddress: `c${n}@example.com` } : null,
});

// Fake Admin API client: the count query, then one response per page.
function fakeAdmin({ count, pages }) {
  const queue = [{ customersCount: { count } }, ...pages.map((p, i) => ({
    customers: {
      nodes: p,
      pageInfo: { hasNextPage: i < pages.length - 1, endCursor: `cursor-${i + 1}` },
    },
  }))];
  return {
    graphql: vi.fn(async () => ({ json: async () => ({ data: queue.shift() }) })),
  };
}

describe("syncCustomers", () => {
  it("fetches 50 per call and follows the cursor until the last page", async () => {
    const admin = fakeAdmin({ count: 3, pages: [[customer(1), customer(2)], [customer(3)]] });
    db.customer.upsert.mockResolvedValue({});

    const synced = await syncCustomers(admin, shop);

    expect(synced).toBe(3);
    const pageCalls = admin.graphql.mock.calls.slice(1).map(([, opts]) => opts.variables);
    expect(pageCalls).toEqual([
      { first: 50, after: null },
      { first: 50, after: "cursor-1" },
    ]);
  });

  it("upserts customer fields but never overwrites points", async () => {
    const admin = fakeAdmin({ count: 1, pages: [[customer(1)]] });
    db.customer.upsert.mockResolvedValue({});

    await syncCustomers(admin, shop);

    const args = db.customer.upsert.mock.calls[0][0];
    expect(args.where).toEqual({
      shopId_shopifyCustomerId: { shopId: 7, shopifyCustomerId: "gid://shopify/Customer/1" },
    });
    expect(args.update).toEqual({
      firstName: "First1",
      lastName: null,
      email: "c1@example.com",
      shopifyCreatedAt: new Date("2026-10-20T10:00:00Z"),
    });
    expect(args.update).not.toHaveProperty("points");
    expect(args.create).toMatchObject({ shopId: 7, shopifyCustomerId: "gid://shopify/Customer/1" });
  });

  it("reports progress after the count and after each page", async () => {
    const admin = fakeAdmin({ count: 3, pages: [[customer(1), customer(2)], [customer(3)]] });
    db.customer.upsert.mockResolvedValue({});
    const onProgress = vi.fn();

    await syncCustomers(admin, shop, onProgress);

    expect(onProgress.mock.calls.map(([p]) => p)).toEqual([
      { synced: 0, total: 3 },
      { synced: 2, total: 3 },
      { synced: 3, total: 3 },
    ]);
  });

  it("throws on GraphQL errors", async () => {
    const admin = {
      graphql: vi.fn(async () => ({ json: async () => ({ errors: [{ message: "Access denied" }] }) })),
    };
    await expect(syncCustomers(admin, shop)).rejects.toThrow("Access denied");
  });
});

describe("startCustomerSync", () => {
  it("tracks progress to completion and refuses a second run while one is running", async () => {
    const admin = fakeAdmin({ count: 1, pages: [[customer(1)]] });
    db.customer.upsert.mockResolvedValue({});
    const s = { id: 8, domain: "b.myshopify.com" };

    expect(startCustomerSync(admin, s)).toBe(true);
    expect(getCustomerSyncProgress(s.domain).status).toBe("running");
    expect(startCustomerSync(admin, s)).toBe(false);

    await vi.waitFor(() => expect(getCustomerSyncProgress(s.domain).status).toBe("done"));
    expect(getCustomerSyncProgress(s.domain)).toMatchObject({ synced: 1, total: 1, error: null });
  });

  it("records the error when the sync fails", async () => {
    const admin = { graphql: vi.fn().mockRejectedValue(new Error("Network down")) };
    const s = { id: 9, domain: "c.myshopify.com" };

    startCustomerSync(admin, s);

    await vi.waitFor(() => expect(getCustomerSyncProgress(s.domain).status).toBe("failed"));
    expect(getCustomerSyncProgress(s.domain).error).toBe("Network down");
  });

  it("returns null for a shop that has never synced", () => {
    expect(getCustomerSyncProgress("never.myshopify.com")).toBeNull();
  });
});
