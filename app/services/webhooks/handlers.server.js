import db from "../../db.server";
import logger from "../../logger.server";
import { deleteCustomer, saveCustomer } from "../customers/customers.server";
import { saveOrder } from "../orders/orders.server";
import { deleteShopData, markUninstalled } from "../shops/shops.server";

// One handler per webhook topic, keyed by the topic as authenticate.webhook() returns it
// (Shopify's "orders/create" becomes "ORDERS_CREATE"). Handlers run in the queue worker, can run
// more than once for the same delivery (retries, Shopify re-sends) and must be idempotent.
export const handlers = {
  async ORDERS_CREATE({ shop, payload }) {
    const result = await saveOrder(shop, payload);
    logger.info(
      {
        shop,
        orderId: payload.id,
        orderName: payload.name,
        customerId: payload.customer?.id,
        totalPrice: payload.total_price,
        currency: payload.currency,
        financialStatus: payload.financial_status,
        result,
      },
      "Order saved",
    );
    // TODO(WBS 3.1): award points for this order (idempotent on orderId).
  },

  async ORDERS_FULFILLED({ shop, payload }) {
    const result = await saveOrder(shop, payload);
    logger.info(
      {
        shop,
        orderId: payload.id,
        orderName: payload.name,
        customerId: payload.customer?.id,
        fulfillmentStatus: payload.fulfillment_status,
        result,
      },
      "Order saved",
    );
    // TODO(WBS 3.2): confirm pending points for this order (pending -> available).
  },

  async CUSTOMERS_CREATE({ shop, payload }) {
    const result = await saveCustomer(shop, payload);
    logger.info({ shop, customerId: payload.id, state: payload.state, result }, "Customer saved");
    // TODO(earning rules): award the "Create account" points.
  },

  async CUSTOMERS_UPDATE({ shop, payload }) {
    const result = await saveCustomer(shop, payload);
    logger.info({ shop, customerId: payload.id, state: payload.state, result }, "Customer saved");
  },

  // The customer was deleted in Shopify: drop them and their loyalty history, as the original app does.
  async CUSTOMERS_DELETE({ shop, payload }) {
    const deleted = await deleteCustomer(shop, payload.id);
    logger.info({ shop, customerId: payload.id, deleted }, "Customer deleted");
  },

  async APP_SCOPES_UPDATE({ shop, payload }) {
    await db.session.updateMany({
      where: { shop, isOnline: false },
      data: { scope: payload.current.toString() },
    });
  },

  async APP_UNINSTALLED({ shop }) {
    // Can arrive more than once, and after the sessions are already gone.
    await db.session.deleteMany({ where: { shop } });
    // Keep loyalty data until shop/redact (48h later) in case the merchant reinstalls.
    await markUninstalled(shop);
  },

  // Mandatory compliance webhook: a customer asked the merchant for their data.
  // Send the merchant whatever we store for this customer within 30 days.
  async CUSTOMERS_DATA_REQUEST({ shop, payload }) {
    logger.info(
      {
        shop,
        customerId: payload.customer?.id,
        ordersRequested: payload.orders_requested,
        dataRequestId: payload.data_request?.id,
      },
      "Customer data requested",
    );
    // TODO(WBS 6.1): collect loyalty data for payload.customer.id and deliver it to the merchant.
  },

  // Mandatory compliance webhook: erase a customer's personal data (sent 10 days after the
  // merchant's request, or 6 months after the customer's last order if the shop uninstalled the app).
  async CUSTOMERS_REDACT({ shop, payload }) {
    logger.info(
      { shop, customerId: payload.customer?.id, ordersToRedact: payload.orders_to_redact },
      "Customer redaction requested",
    );
    // The customer row holds their personal data; the cascade removes their points ledger and redeem
    // history. Stored orders are left to the retention cleanup (ORDER_RETENTION_DAYS).
    const deleted = await deleteCustomer(shop, payload.customer.id);
    logger.info({ shop, customerId: payload.customer.id, deleted }, "Customer redacted");
  },

  // Mandatory compliance webhook: sent 48 hours after a shop uninstalls the app.
  // Erase everything stored for the shop.
  async SHOP_REDACT({ shop }) {
    await db.session.deleteMany({ where: { shop } });
    // Cascades to discount rules (and future loyalty tables).
    await deleteShopData(shop);
  },
};

/** BullMQ processor: runs the handler for the job's topic. A throw makes BullMQ retry the job. */
export async function processWebhookJob(job) {
  const { topic, shop, webhookId } = job.data;
  const handler = handlers[topic];
  if (!handler) {
    // Retrying won't help; log and drop it.
    logger.warn({ topic, shop, webhookId }, "No handler for webhook topic");
    return;
  }
  await handler(job.data);
  logger.info({ topic, shop, webhookId, attempt: job.attemptsMade + 1 }, "Webhook processed");
}
