import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../mocks/db";
import { saveOrder } from "../../../app/services/orders/orders.server";
import { awardOrderPoints, revokeOrderPoints } from "../../../app/services/earning/orders.server";
import { awardSignupPoints } from "../../../app/services/earning/account.server";
import { processWebhookJob } from "../../../app/services/webhooks/handlers.server";

vi.mock("../../../app/services/orders/orders.server", () => ({ saveOrder: vi.fn() }));
vi.mock("../../../app/services/earning/orders.server", () => ({ awardOrderPoints: vi.fn(), revokeOrderPoints: vi.fn() }));
vi.mock("../../../app/services/earning/account.server", () => ({ awardSignupPoints: vi.fn() }));

const DOMAIN = "a.myshopify.com";
const job = (topic, payload = {}) => ({
  data: { topic, shop: DOMAIN, webhookId: "wh-1", payload },
  attemptsMade: 0,
});

beforeEach(() => {
  saveOrder.mockReset();
});

describe("processWebhookJob", () => {
  it.each([
    ["ORDERS_CREATE", "create"],
    ["ORDERS_FULFILLED", "fulfilled"],
  ])("awards order points for %s", async (topic, event) => {
    const payload = { id: 1001, name: "#1001" };
    await processWebhookJob(job(topic, payload));
    expect(awardOrderPoints).toHaveBeenCalledWith(DOMAIN, payload, event);
  });

  it("takes back order points on ORDERS_CANCELLED and REFUNDS_CREATE", async () => {
    await processWebhookJob(job("ORDERS_CANCELLED", { id: 1001, name: "#1001" }));
    expect(saveOrder).toHaveBeenCalled();
    expect(revokeOrderPoints).toHaveBeenCalledWith(DOMAIN, 1001, "cancel");

    await processWebhookJob(job("REFUNDS_CREATE", { id: 77, order_id: 1002 }));
    expect(revokeOrderPoints).toHaveBeenCalledWith(DOMAIN, 1002, "refund", { refund: { id: 77, order_id: 1002 } });
  });

  it("gives sign-up points on CUSTOMERS_CREATE only", async () => {
    db.customer.updateMany.mockResolvedValue({ count: 1 });
    await processWebhookJob(job("CUSTOMERS_UPDATE", { id: 9, updated_at: "2026-11-01T00:00:00Z" }));
    expect(awardSignupPoints).not.toHaveBeenCalled();
    await processWebhookJob(job("CUSTOMERS_CREATE", { id: 9, updated_at: "2026-11-01T00:00:00Z" }));
    expect(awardSignupPoints).toHaveBeenCalledWith(DOMAIN, expect.objectContaining({ id: 9 }));
  });

  it.each(["ORDERS_CREATE", "ORDERS_FULFILLED"])("saves the order for %s", async (topic) => {
    saveOrder.mockResolvedValue("created");
    const payload = { id: 1001, name: "#1001" };

    await processWebhookJob(job(topic, payload));

    expect(saveOrder).toHaveBeenCalledWith(DOMAIN, payload);
  });

  it("rethrows handler errors so BullMQ retries the job", async () => {
    saveOrder.mockRejectedValue(new Error("db down"));

    await expect(processWebhookJob(job("ORDERS_CREATE", { id: 1 }))).rejects.toThrow("db down");
  });

  it("updates the offline session scope on APP_SCOPES_UPDATE", async () => {
    await processWebhookJob(job("APP_SCOPES_UPDATE", { current: ["read_orders", "read_customers"] }));

    expect(db.session.updateMany).toHaveBeenCalledWith({
      where: { shop: DOMAIN, isOnline: false },
      data: { scope: "read_orders,read_customers" },
    });
  });

  it("deletes sessions and marks the shop uninstalled on APP_UNINSTALLED", async () => {
    await processWebhookJob(job("APP_UNINSTALLED"));

    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { shop: DOMAIN } });
    expect(db.shop.updateMany).toHaveBeenCalledWith({
      where: { domain: DOMAIN },
      data: { uninstalledAt: expect.any(Date) },
    });
    expect(db.shop.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes sessions and all shop data on SHOP_REDACT", async () => {
    await processWebhookJob(job("SHOP_REDACT"));

    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { shop: DOMAIN } });
    expect(db.shop.deleteMany).toHaveBeenCalledWith({ where: { domain: DOMAIN } });
  });

  it.each(["CUSTOMERS_CREATE", "CUSTOMERS_UPDATE"])("saves the customer for %s", async (topic) => {
    db.customer.updateMany.mockResolvedValue({ count: 1 });

    await processWebhookJob(job(topic, { id: 42, state: "enabled", updated_at: "2026-11-01T00:00:00Z" }));

    expect(db.customer.updateMany.mock.calls[0][0].where.shopifyCustomerId).toBe("gid://shopify/Customer/42");
  });

  it.each([
    ["CUSTOMERS_DELETE", { id: 42 }],
    ["CUSTOMERS_REDACT", { customer: { id: 42 }, orders_to_redact: [] }],
  ])("deletes the customer and their loyalty data on %s", async (topic, payload) => {
    db.customer.deleteMany.mockResolvedValue({ count: 1 });

    await processWebhookJob(job(topic, payload));

    expect(db.customer.deleteMany).toHaveBeenCalledWith({
      where: { shop: { domain: DOMAIN }, shopifyCustomerId: "gid://shopify/Customer/42" },
    });
  });

  it("drops jobs for unknown topics without throwing", async () => {
    await expect(processWebhookJob(job("PRODUCTS_CREATE"))).resolves.toBeUndefined();
    expect(saveOrder).not.toHaveBeenCalled();
  });
});
