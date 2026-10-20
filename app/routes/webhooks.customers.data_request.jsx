import { authenticate } from "../shopify.server";
import logger from "../logger.server";

// Mandatory compliance webhook: a customer asked the merchant for their data.
// Respond 200 now, then send the merchant whatever we store for this customer within 30 days.
// authenticate.webhook() answers 401 on an invalid HMAC, as Shopify requires.
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  logger.info(
    {
      topic,
      shop,
      customerId: payload.customer?.id,
      ordersRequested: payload.orders_requested,
      dataRequestId: payload.data_request?.id,
    },
    "Compliance webhook received",
  );

  // TODO(WBS 6.1): collect loyalty data for payload.customer.id and deliver it to the merchant.

  return new Response();
};
