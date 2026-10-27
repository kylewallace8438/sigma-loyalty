import { authenticate } from "../shopify.server";
import logger from "../logger.server";
import { saveOrder } from "../services/orders/orders.server";

// orders/create (see shopify.app.toml)
export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);

  logger.info(
    {
      topic,
      shop,
      orderId: payload.id,
      orderName: payload.name,
      customerId: payload.customer?.id,
      totalPrice: payload.total_price,
      currency: payload.currency,
      financialStatus: payload.financial_status,
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

  // TODO(WBS 3.1): award points for this order (idempotent on orderId).

  return new Response();
};
