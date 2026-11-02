import { authenticate } from "../shopify.server";
import { enqueueWebhook } from "../services/webhooks/queue.server";

// app/uninstalled (see shopify.app.toml).
// authenticate.webhook() answers 401 on an invalid HMAC. The work runs in the queue worker
// (app/services/webhooks/handlers.server.js); if queueing fails Shopify gets a 500 and retries.
export const action = async ({ request }) => {
  await enqueueWebhook(await authenticate.webhook(request));
  return new Response();
};
