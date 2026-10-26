import { authenticate } from "../shopify.server";
import db from "../db.server";
import logger from "../logger.server";
import { deleteShopData } from "../services/shops/shops.server";

// Mandatory compliance webhook: sent 48 hours after a shop uninstalls the app.
// Erase everything stored for the shop. authenticate.webhook() answers 401 on an invalid HMAC.
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  logger.info({ topic, shop }, "Compliance webhook received");

  await db.session.deleteMany({ where: { shop } });
  // Cascades to discount rules (and future loyalty tables).
  await deleteShopData(shop);

  return new Response();
};
