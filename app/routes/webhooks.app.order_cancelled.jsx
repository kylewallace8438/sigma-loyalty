import { authenticate } from "../shopify.server";
import { enqueueWebhook } from "../services/webhooks/queue.server";

// orders/cancelled (see shopify.app.toml). Processed by ORDERS_CANCELLED in
// app/services/webhooks/handlers.server.js.
export const action = async ({ request }) => {
  await enqueueWebhook(await authenticate.webhook(request));
  return new Response();
};
