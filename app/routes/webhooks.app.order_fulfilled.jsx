import { authenticate } from "../shopify.server";
import logger from "../logger.server";

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

  // TODO(WBS 3.2): confirm pending points for this order (pending -> available).

  return new Response();
};
