import { describe, expect, it, vi } from "vitest";
import { getCustomersCount, getCustomersPage } from "../../../app/services/shopify/customers.server";

const adminReturning = (body) => ({ graphql: vi.fn(async () => ({ json: async () => body })) });

describe("getCustomersPage", () => {
  it("flattens customers and returns the next cursor", async () => {
    const admin = adminReturning({
      data: {
        customers: {
          nodes: [
            {
              id: "gid://shopify/Customer/1",
              firstName: "Ha",
              lastName: "Viet",
              createdAt: "2024-10-21T06:58:00Z",
              defaultEmailAddress: { emailAddress: "hqv@example.com" },
            },
          ],
          pageInfo: { hasNextPage: true, endCursor: "abc" },
        },
      },
    });

    const page = await getCustomersPage(admin, { first: 50 });

    expect(admin.graphql.mock.calls[0][1].variables).toEqual({ first: 50, after: null });
    expect(page).toEqual({
      customers: [
        {
          id: "gid://shopify/Customer/1",
          firstName: "Ha",
          lastName: "Viet",
          email: "hqv@example.com",
          createdAt: new Date("2024-10-21T06:58:00Z"),
        },
      ],
      nextCursor: "abc",
    });
  });

  it("returns a null cursor on the last page and a null email when there is none", async () => {
    const admin = adminReturning({
      data: {
        customers: {
          nodes: [{ id: "gid://shopify/Customer/2", firstName: null, lastName: null, createdAt: "2024-01-01T00:00:00Z", defaultEmailAddress: null }],
          pageInfo: { hasNextPage: false, endCursor: "zzz" },
        },
      },
    });

    const page = await getCustomersPage(admin, { first: 50, after: "abc" });

    expect(page.nextCursor).toBeNull();
    expect(page.customers[0].email).toBeNull();
  });

  it("throws on GraphQL errors", async () => {
    await expect(getCustomersPage(adminReturning({ errors: [{ message: "Throttled" }] }), { first: 50 })).rejects.toThrow(
      "Throttled",
    );
  });
});

describe("getCustomersCount", () => {
  it("returns the count, or null when missing", async () => {
    expect(await getCustomersCount(adminReturning({ data: { customersCount: { count: 42 } } }))).toBe(42);
    expect(await getCustomersCount(adminReturning({ data: { customersCount: null } }))).toBeNull();
  });
});
