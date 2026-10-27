import { describe, expect, it } from "vitest";
import { db } from "../../mocks/db";
import { getCustomer, listCustomers, parseCustomerFilters } from "../../../app/services/customers/customers.server";

describe("parseCustomerFilters", () => {
  it("trims the query and defaults to page 1", () => {
    expect(parseCustomerFilters(new URLSearchParams("q=  ha  "))).toEqual({ query: "ha", page: 1 });
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
