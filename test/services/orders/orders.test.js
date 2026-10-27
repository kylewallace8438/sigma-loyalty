import { describe, expect, it } from "vitest";
import { db } from "../../mocks/db";
import { orderFromPayload, saveOrder } from "../../../app/services/orders/orders.server";

const DOMAIN = "a.myshopify.com";

// Trimmed orders/create webhook payload (REST shape).
const payload = (overrides = {}) => ({
  id: 1001,
  admin_graphql_api_id: "gid://shopify/Order/1001",
  name: "#1001",
  customer: { id: 55, admin_graphql_api_id: "gid://shopify/Customer/55" },
  currency: "USD",
  subtotal_price: "90.00",
  total_discounts: "10.00",
  total_price: "98.50",
  financial_status: "paid",
  fulfillment_status: null,
  discount_codes: [{ code: "SAVE10", amount: "10.00", type: "fixed_amount" }],
  line_items: [
    {
      id: 501,
      product_id: 601,
      variant_id: 701,
      quantity: 2,
      price: "50.00",
      gift_card: false,
      discount_allocations: [{ amount: "7.50" }, { amount: "2.50" }],
    },
    { id: 502, product_id: null, variant_id: null, quantity: 1, price: "25.00", gift_card: true, discount_allocations: [] },
  ],
  cancelled_at: null,
  fulfillments: [],
  created_at: "2026-10-27T10:00:00+07:00",
  updated_at: "2026-10-27T10:00:05+07:00",
  ...overrides,
});

const duplicateKey = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

describe("orderFromPayload", () => {
  it("maps the webhook payload to Order columns", () => {
    expect(orderFromPayload(payload())).toEqual({
      shopifyOrderId: 1001n,
      shopifyCustomerId: 55n,
      name: "#1001",
      currency: "USD",
      subtotalPrice: "90.00",
      totalDiscounts: "10.00",
      totalPrice: "98.50",
      financialStatus: "paid",
      fulfillmentStatus: null,
      discountCodes: ["SAVE10"],
      lineItems: [
        { id: 501, productId: 601, variantId: 701, quantity: 2, price: "50.00", discount: "10.00", giftCard: false },
        { id: 502, productId: null, variantId: null, quantity: 1, price: "25.00", discount: "0.00", giftCard: true },
      ],
      cancelledAt: null,
      fulfilledAt: null,
      shopifyCreatedAt: new Date("2026-10-27T03:00:00Z"),
      shopifyUpdatedAt: new Date("2026-10-27T03:00:05Z"),
    });
  });

  it("sets fulfilledAt to the latest fulfillment once fully fulfilled", () => {
    const order = orderFromPayload(
      payload({
        fulfillment_status: "fulfilled",
        fulfillments: [{ created_at: "2026-10-28T09:00:00Z" }, { created_at: "2026-10-29T09:00:00Z" }],
      }),
    );
    expect(order.fulfilledAt).toEqual(new Date("2026-10-29T09:00:00Z"));
  });

  it("leaves fulfilledAt null while partially fulfilled", () => {
    const order = orderFromPayload(
      payload({ fulfillment_status: "partial", fulfillments: [{ created_at: "2026-10-28T09:00:00Z" }] }),
    );
    expect(order.fulfilledAt).toBeNull();
  });
});

describe("saveOrder", () => {
  it("skips guest orders, which can't earn points", async () => {
    expect(await saveOrder(DOMAIN, payload({ customer: null }))).toBe("skipped");
    expect(db.order.updateMany).not.toHaveBeenCalled();
    expect(db.order.create).not.toHaveBeenCalled();
  });

  it("creates the order, linking the shop by domain, when it isn't stored yet", async () => {
    db.order.updateMany.mockResolvedValue({ count: 0 });
    db.order.create.mockResolvedValue({});

    expect(await saveOrder(DOMAIN, payload())).toBe("created");

    const { data } = db.order.create.mock.calls[0][0];
    expect(data).toMatchObject({ shopifyOrderId: 1001n, name: "#1001" });
    expect(data.shop).toEqual({
      connectOrCreate: { where: { domain: DOMAIN }, create: { domain: DOMAIN } },
    });
  });

  it("updates the stored order only if the payload is not older", async () => {
    db.order.updateMany.mockResolvedValue({ count: 1 });

    expect(await saveOrder(DOMAIN, payload({ fulfillment_status: "fulfilled" }))).toBe("updated");

    expect(db.order.updateMany.mock.calls[0][0].where).toEqual({
      shop: { domain: DOMAIN },
      shopifyOrderId: 1001n,
      shopifyUpdatedAt: { lte: new Date("2026-10-27T03:00:05Z") },
    });
    expect(db.order.create).not.toHaveBeenCalled();
  });

  it("ignores a payload older than the stored order", async () => {
    db.order.updateMany.mockResolvedValue({ count: 0 });
    db.order.create.mockRejectedValue(duplicateKey());

    expect(await saveOrder(DOMAIN, payload())).toBe("stale");
    expect(db.order.updateMany).toHaveBeenCalledTimes(2);
  });

  it("updates after losing a create race to a concurrent webhook", async () => {
    db.order.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    db.order.create.mockRejectedValue(duplicateKey());

    expect(await saveOrder(DOMAIN, payload())).toBe("updated");
  });

  it("rethrows other database errors", async () => {
    db.order.updateMany.mockResolvedValue({ count: 0 });
    db.order.create.mockRejectedValue(new Error("Connection lost"));

    await expect(saveOrder(DOMAIN, payload())).rejects.toThrow("Connection lost");
  });
});
