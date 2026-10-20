import { authenticate } from "../shopify.server";
import logger from "../logger.server";

// Mandatory compliance webhook: erase a customer's personal data (sent 10 days after the
// merchant's request, or 6 months after the customer's last order if the shop uninstalled the app).
// authenticate.webhook() answers 401 on an invalid HMAC, as Shopify requires.
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  logger.info(
    {
      topic,
      shop,
      customerId: payload.customer?.id,
      ordersToRedact: payload.orders_to_redact,
    },
    "Compliance webhook received",
  );

  // TODO(WBS 6.2): delete or anonymise loyalty data stored for payload.customer.id in this shop.

  return new Response();
};
