import { authenticate } from "../shopify.server";
import logger from "../logger.server";
import { saveOrder } from "../services/orders/orders.server";

// orders/fulfilled (see shopify.app.toml)
export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);

  logger.info(
    {
      topic,
      shop,
      orderId: payload.id,
      orderName: payload.name,
      customerId: payload.customer?.id,
      fulfillmentStatus: payload.fulfillment_status,
    },
    "Received webhook",
  );

  try {
    const result = await saveOrder(shop, payload);
    logger.info({ shop, orderId: payload.id, result }, "Order saved");
  } catch (err) {
    // Rethrown so Shopify gets a 500 and retries the webhook.
    logger.error({ err, topic, shop, orderId: payload.id }, "Order save failed");
    throw err;
  }

  // TODO(WBS 3.2): confirm pending points for this order (pending -> available).

  return new Response();
};
