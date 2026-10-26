import db from "../db.server";
import logger from "../logger.server";

// Shopify returns at most this many customers per call; larger shops are paged through.
const PAGE_SIZE = 50;

// Requires the read_customers scope (and protected customer data access for names/emails).
const CUSTOMERS_COUNT = `#graphql
  query CustomerSyncCount {
    customersCount { count }
  }`;

const CUSTOMERS_PAGE = `#graphql
  query CustomerSyncPage($first: Int!, $after: String) {
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

// Latest sync progress per shop domain: { status, synced, total, startedAt, finishedAt, error }.
// Held in memory, so it is per process and lost on restart; a running status also blocks a second sync.
const progress = new Map();

async function query(admin, document, variables) {
  const response = await admin.graphql(document, { variables });
  const json = await response.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

// Points are left untouched on update so a re-sync never resets a balance.
function saveCustomers(shopId, nodes) {
  return db.$transaction(
    nodes.map((c) => {
      const data = {
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.defaultEmailAddress?.emailAddress ?? null,
        shopifyCreatedAt: new Date(c.createdAt),
      };
      return db.customer.upsert({
        where: { shopId_shopifyCustomerId: { shopId, shopifyCustomerId: c.id } },
        create: { shopId, shopifyCustomerId: c.id, ...data },
        update: data,
      });
    }),
  );
}

/**
 * Pulls every customer of the shop from Shopify, 50 per call, into the Customer table.
 * `onProgress({ synced, total })` is called after each page. Returns the number synced.
 */
export async function syncCustomers(admin, shop, onProgress = () => {}) {
  const { customersCount } = await query(admin, CUSTOMERS_COUNT);
  const total = customersCount?.count ?? null;
  let after = null;
  let synced = 0;
  onProgress({ synced, total });
  do {
    const { customers: page } = await query(admin, CUSTOMERS_PAGE, { first: PAGE_SIZE, after });
    if (page.nodes.length) await saveCustomers(shop.id, page.nodes);
    synced += page.nodes.length;
    onProgress({ synced, total });
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return synced;
}

/** Latest sync progress for the shop, or null if none has run since the server started. */
export function getCustomerSyncProgress(domain) {
  return progress.get(domain) ?? null;
}

/** Runs syncCustomers in the background; does nothing if one is already running for this shop. */
export function startCustomerSync(admin, shop) {
  if (progress.get(shop.domain)?.status === "running") return false;

  const state = { status: "running", synced: 0, total: null, startedAt: new Date(), finishedAt: null, error: null };
  progress.set(shop.domain, state);

  const log = logger.child({ shop: shop.domain });
  log.info("Customer sync started");
  syncCustomers(admin, shop, ({ synced, total }) => Object.assign(state, { synced, total }))
    .then((count) => {
      Object.assign(state, { status: "done", finishedAt: new Date() });
      log.info({ count }, "Customer sync finished");
    })
    .catch((err) => {
      Object.assign(state, { status: "failed", finishedAt: new Date(), error: err.message });
      log.error({ err }, "Customer sync failed");
    });
  return true;
}
