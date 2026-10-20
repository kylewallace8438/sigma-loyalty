import { authenticate } from "../shopify.server";
import logger from "../logger.server";

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

  // TODO(WBS 3.1): award points for this order (idempotent on orderId).

  return new Response();
};
