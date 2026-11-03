import { describe, expect, it } from "vitest";
import { db } from "../../mocks/db";
import {
  customerFromPayload,
  deleteCustomer,
  getCustomer,
  listCustomers,
  parseCustomerFilters,
  saveCustomer,
  setExcluded,
} from "../../../app/services/customers/customers.server";

describe("parseCustomerFilters", () => {
  it("trims the query and defaults to page 1", () => {
    expect(parseCustomerFilters(new URLSearchParams("q=  ha  "))).toEqual({ query: "ha", page: 1, tab: "all" });
  });

  it("ignores invalid pages", () => {
    expect(parseCustomerFilters(new URLSearchParams("page=0")).page).toBe(1);
    expect(parseCustomerFilters(new URLSearchParams("page=abc")).page).toBe(1);
    expect(parseCustomerFilters(new URLSearchParams("page=3")).page).toBe(3);
  });

  it("caps the query at 100 characters", () => {
    expect(parseCustomerFilters(new URLSearchParams({ q: "a".repeat(150) })).query).toHaveLength(100);
  });
});

describe("listCustomers", () => {
  it("requires every word to match a name or email field", async () => {
    db.customer.findMany.mockResolvedValue([]);
    db.customer.count.mockResolvedValue(0);

    await listCustomers("a.myshopify.com", { query: "ha  viet", page: 1 });

    const { where } = db.customer.findMany.mock.calls[0][0];
    expect(where.shop).toEqual({ domain: "a.myshopify.com" });
    expect(where.AND).toHaveLength(2);
    expect(where.AND[1].OR).toEqual([
      { firstName: { contains: "viet" } },
      { lastName: { contains: "viet" } },
      { email: { contains: "viet" } },
    ]);
  });

  it("pages 50 at a time and counts with the same filter", async () => {
    db.customer.findMany.mockResolvedValue([{ id: 1 }]);
    db.customer.count.mockResolvedValue(120);

    const result = await listCustomers("a.myshopify.com", { page: 3 });

    expect(db.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 100, take: 50 }));
    expect(db.customer.count.mock.calls[0][0].where).toEqual(db.customer.findMany.mock.calls[0][0].where);
    expect(result).toEqual({ customers: [{ id: 1 }], total: 120 });
  });
});

describe("getCustomer", () => {
  it("returns null when the customer isn't in this shop", async () => {
    db.customer.findFirst.mockResolvedValue(null);
    expect(await getCustomer("a.myshopify.com", 1)).toBeNull();
  });

  it("loads the customer in this shop with their redeem history, newest first", async () => {
    const customer = { id: 1, redeemHistories: [] };
    db.customer.findFirst.mockResolvedValue(customer);

    expect(await getCustomer("a.myshopify.com", 1)).toBe(customer);
    expect(db.customer.findFirst).toHaveBeenCalledWith({
      where: { id: 1, shop: { domain: "a.myshopify.com" } },
      include: { redeemHistories: { orderBy: { createdAt: "desc" } } },
    });
  });
});

describe("customer tabs", () => {
  it("reads a known tab and falls back to all", () => {
    expect(parseCustomerFilters(new URLSearchParams("tab=guests")).tab).toBe("guests");
    expect(parseCustomerFilters(new URLSearchParams("tab=nope")).tab).toBe("all");
  });

  it.each([
    ["members", { state: "ENABLED", excluded: false }],
    ["guests", { state: { not: "ENABLED" }, excluded: false }],
    ["excluded", { excluded: true }],
  ])("filters the %s tab", async (tab, where) => {
    db.customer.findMany.mockResolvedValue([]);
    db.customer.count.mockResolvedValue(0);

    await listCustomers("a.myshopify.com", { tab });

    expect(db.customer.findMany.mock.calls[0][0].where).toMatchObject(where);
  });
});

describe("setExcluded", () => {
  it("updates the flag", async () => {
    await setExcluded({ id: 3, shopId: 7 }, true);
    expect(db.customer.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { excluded: true } });
  });
});

const payload = {
  id: 42,
  first_name: "Ha",
  last_name: "Viet",
  email: "ha@example.com",
  state: "enabled",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

describe("customerFromPayload", () => {
  it("maps the REST payload to Customer fields", () => {
    expect(customerFromPayload(payload)).toEqual({
      shopifyCustomerId: "gid://shopify/Customer/42",
      firstName: "Ha",
      lastName: "Viet",
      email: "ha@example.com",
      state: "ENABLED",
      shopifyCreatedAt: new Date("2026-10-01T00:00:00Z"),
      shopifyUpdatedAt: new Date("2026-11-01T00:00:00Z"),
    });
  });

  it("treats a missing state as a guest", () => {
    expect(customerFromPayload({ id: 1 }).state).toBe("DISABLED");
  });
});

describe("saveCustomer", () => {
  it("updates an existing customer only when the payload isn't older", async () => {
    db.customer.updateMany.mockResolvedValue({ count: 1 });

    expect(await saveCustomer("a.myshopify.com", payload)).toBe("updated");
    const { where, data } = db.customer.updateMany.mock.calls[0][0];
    expect(where.OR).toEqual([{ shopifyUpdatedAt: null }, { shopifyUpdatedAt: { lte: data.shopifyUpdatedAt } }]);
    expect(data).not.toHaveProperty("points");
    expect(db.customer.create).not.toHaveBeenCalled();
  });

  it("creates the customer when there is no row", async () => {
    db.customer.updateMany.mockResolvedValue({ count: 0 });
    db.customer.create.mockResolvedValue({});

    expect(await saveCustomer("a.myshopify.com", payload)).toBe("created");
  });

  it("reports a stale payload when a newer row already exists", async () => {
    db.customer.updateMany.mockResolvedValue({ count: 0 });
    db.customer.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));

    expect(await saveCustomer("a.myshopify.com", payload)).toBe("stale");
  });
});

describe("deleteCustomer", () => {
  it("deletes the shop's customer by Shopify id", async () => {
    db.customer.deleteMany.mockResolvedValue({ count: 1 });

    expect(await deleteCustomer("a.myshopify.com", 42)).toBe(1);
    expect(db.customer.deleteMany).toHaveBeenCalledWith({
      where: { shop: { domain: "a.myshopify.com" }, shopifyCustomerId: "gid://shopify/Customer/42" },
    });
  });
});
