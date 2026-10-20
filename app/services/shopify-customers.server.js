import logger from "../logger.server";

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
