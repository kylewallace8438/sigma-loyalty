import logger from "../../logger.server";
import { adminQuery } from "./graphql.server";

// Admin API calls for customers (no database access).
// Requires the read_customers scope (and protected customer data access for names/emails).

const CUSTOMER_SEARCH = `#graphql
  query CustomerSearch($query: String!) {
    customers(first: 10, query: $query, sortKey: NAME) {
      nodes {
        id
        displayName
        defaultEmailAddress { emailAddress }
      }
    }
  }`;

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

/** Searches the shop's customers by name or email. Returns [{ id, displayName, email }]. */
export async function searchCustomers(admin, term) {
  const query = term.trim().slice(0, 100);
  if (query.length < 2) return [];

  try {
    const response = await admin.graphql(CUSTOMER_SEARCH, { variables: { query } });
    const json = await response.json();
    return (json.data?.customers?.nodes ?? []).map((c) => ({
      id: c.id,
      displayName: c.displayName,
      email: c.defaultEmailAddress?.emailAddress ?? null,
    }));
  } catch (error) {
    logger.error({ err: error }, "Customer search failed");
    const detail = error.body?.errors?.graphQLErrors?.[0]?.message || error.message;
    throw new Error(detail);
  }
}

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
