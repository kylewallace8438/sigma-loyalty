/**
 * Admin API client for a shop outside an admin request (webhook worker, app proxy, scheduled jobs),
 * using the stored offline session. shopify.server is loaded on first use, so modules that only
 * might call the Admin API (and their tests) don't need the Shopify app configured to load.
 */
export async function getShopAdmin(shopDomain) {
  const { unauthenticated } = await import("../../shopify.server");
  const { admin } = await unauthenticated.admin(shopDomain);
  return admin;
}
