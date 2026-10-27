import { adminQuery } from "./graphql.server";

// Admin API calls for customers (no database access).
// Requires the read_customers scope (and protected customer data access for names/emails).

const CUSTOMERS_COUNT = `#graphql
  query CustomersCount {
    customersCount { count }
  }`;

const CUSTOMERS_PAGE = `#graphql
  query CustomersPage($first: Int!, $after: String) {
    customers(first: $first, after: $after, sortKey: ID) {
      nodes {
        id
        firstName
        lastName
        createdAt
        defaultEmailAddress { emailAddress }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

/** Number of customers in the shop, or null if Shopify doesn't return one. */
export async function getCustomersCount(admin) {
  const { customersCount } = await adminQuery(admin, CUSTOMERS_COUNT);
  return customersCount?.count ?? null;
}

/**
 * One page of customers, oldest first. Returns { customers, nextCursor } where each customer is
 * { id, firstName, lastName, email, createdAt: Date } and nextCursor is null on the last page.
 */
export async function getCustomersPage(admin, { first, after = null }) {
  const { customers } = await adminQuery(admin, CUSTOMERS_PAGE, { first, after });
  return {
    customers: customers.nodes.map((c) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.defaultEmailAddress?.emailAddress ?? null,
      createdAt: new Date(c.createdAt),
    })),
    nextCursor: customers.pageInfo.hasNextPage ? customers.pageInfo.endCursor : null,
  };
}
