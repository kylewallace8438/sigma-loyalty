import { describe, expect, it, vi } from "vitest";
import { db } from "../../mocks/db";
import {
  awardOrderPoints,
  countedAmount,
  orderPoints,
  revokeOrderPoints,
} from "../../../app/services/earning/orders.server";

vi.mock("../../../app/services/shopify/admin.server", () => ({ getShopAdmin: vi.fn() }));

const settings = { includeTax: false };
const perAmount = (config = {}) => ({
  points: 1,
  config: { method: "PER_AMOUNT", spent: 1, itemScope: "ALL", products: [], collections: [], ...config },
});
const line = (productId, price, quantity = 1, extra = {}) => ({ product_id: productId, price, quantity, ...extra });

describe("countedAmount / orderPoints", () => {
  const payload = {
    current_subtotal_price: "95.00",
    current_total_tax: "9.50",
    line_items: [
      line(1, "50.00", 1, { discount_allocations: [{ amount: "5.00" }], tax_lines: [{ price: "4.50" }] }),
      line(2, "25.00", 2, { tax_lines: [{ price: "5.00" }] }),
      line(3, "10.00", 1, { gift_card: true }),
    ],
  };

  it("uses the current subtotal for all items, plus tax when included", () => {
    expect(countedAmount(perAmount(), payload, settings)).toBe(95);
    expect(countedAmount(perAmount(), payload, { includeTax: true })).toBe(104.5);
  });

  it("counts only selected products or collections (INCLUDE), never gift cards", () => {
    const rule = perAmount({ itemScope: "INCLUDE", products: [{ id: "gid://shopify/Product/1" }], collections: [{ id: "gid://shopify/Collection/9" }] });
    const collections = new Map([["gid://shopify/Product/2", new Set(["gid://shopify/Collection/9"])]]);
    expect(countedAmount(rule, payload, settings, collections)).toBe(45 + 50);
    expect(countedAmount(rule, payload, settings, new Map())).toBe(45);
  });

  it("counts everything except the selection (EXCLUDE), using current quantities", () => {
    const rule = perAmount({ itemScope: "EXCLUDE", products: [{ id: "gid://shopify/Product/1" }] });
    const refunded = { line_items: [line(1, "50.00"), line(2, "25.00", 2, { current_quantity: 1 })] };
    expect(countedAmount(rule, refunded, settings)).toBe(25);
  });

  it("gives fixed points per order, or rounded points per amount with nothing below it", () => {
    expect(orderPoints({ points: 30, config: { method: "FIXED" } }, payload, settings)).toBe(30);
    expect(orderPoints({ ...perAmount({ spent: 10 }), points: 10 }, payload, settings)).toBe(95);
    expect(orderPoints({ ...perAmount({ spent: 20 }), points: 3 }, payload, settings)).toBe(14); // 3 × 95/20 = 14.25
    expect(orderPoints({ ...perAmount({ spent: 100 }), points: 3 }, payload, settings)).toBe(0);
  });
});

describe("awardOrderPoints", () => {
  const order = {
    id: 555,
    name: "#1001",
    current_subtotal_price: "40.00",
    customer: { id: 9, updated_at: "2026-11-01T00:00:00Z" },
    line_items: [],
  };
  const customer = { id: 3, shopId: 7, excluded: false, referredById: null };
  const settingsRow = (over = {}) => ({ programEnabled: true, rewardFulfilled: true, ...over });

  it("only awards on the event the shop rewards on", async () => {
    db.storeSettings.findFirst.mockResolvedValue(settingsRow());
    expect(await awardOrderPoints("a.myshopify.com", order, "create")).toEqual({ skipped: "not-trigger" });
    expect(await awardOrderPoints("a.myshopify.com", { ...order, customer: null }, "fulfilled")).toEqual({ skipped: "guest" });
    expect(await awardOrderPoints("a.myshopify.com", { ...order, cancelled_at: "x" }, "fulfilled")).toEqual({ skipped: "cancelled" });
  });

  it("gives the order's points once, keyed by the order id", async () => {
    db.storeSettings.findFirst.mockResolvedValue(settingsRow());
    db.customer.findFirst.mockResolvedValue(customer);
    db.earningRule.findFirst.mockResolvedValue({ type: "PLACE_ORDER", name: "Complete an order", active: true, points: 2, config: { method: "PER_AMOUNT", spent: 1 } });
    db.customer.updateMany.mockResolvedValue({ count: 1 });

    const result = await awardOrderPoints("a.myshopify.com", order, "fulfilled");

    expect(result).toEqual({ order: "awarded", vipBonus: "none" });
    expect(db.pointHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: 3,
        type: "EARN",
        points: 80,
        reason: "Complete an order #1001",
        earningType: "PLACE_ORDER",
        shopifyOrderId: 555n,
        dedupeKey: "order:555",
      }),
    });
  });

  it("reports a re-delivered order as a duplicate", async () => {
    db.storeSettings.findFirst.mockResolvedValue(settingsRow({ rewardFulfilled: false }));
    db.customer.findFirst.mockResolvedValue(customer);
    db.earningRule.findFirst.mockResolvedValue({ type: "PLACE_ORDER", name: "Order", active: true, points: 5, config: { method: "FIXED" } });
    db.customer.updateMany.mockResolvedValue({ count: 1 });
    db.pointHistory.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));

    expect(await awardOrderPoints("a.myshopify.com", order, "create")).toEqual({ order: "duplicate" });
  });

  it("rewards the referrer of a referred customer, once per friend", async () => {
    db.storeSettings.findFirst.mockResolvedValue(settingsRow());
    db.customer.findFirst.mockResolvedValue({ ...customer, referredById: 40 });
    db.earningRule.findFirst.mockImplementation(async ({ where }) =>
      where.type === "REFERRER" ? { type: "REFERRER", name: "Refer a friend", active: true, points: 100, config: {} } : null,
    );
    db.customer.findUnique.mockResolvedValue({ id: 40, shopId: 7, excluded: false });
    db.customer.updateMany.mockResolvedValue({ count: 1 });

    expect(await awardOrderPoints("a.myshopify.com", order, "fulfilled")).toEqual({ referrer: "awarded" });
    expect(db.pointHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ customerId: 40, points: 100, earningType: "REFERRER", dedupeKey: "REFERRER:3" }),
    });
  });

  it("creates a customer the app hasn't synced yet", async () => {
    db.storeSettings.findFirst.mockResolvedValue(settingsRow());
    db.customer.findFirst.mockResolvedValueOnce(null).mockResolvedValue(customer);
    db.customer.updateMany.mockResolvedValue({ count: 0 });
    db.customer.create.mockResolvedValue({});
    db.earningRule.findFirst.mockResolvedValue(null);

    await awardOrderPoints("a.myshopify.com", order, "fulfilled");

    expect(db.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ shopifyCustomerId: "gid://shopify/Customer/9" }),
    });
  });
});

describe("revokeOrderPoints", () => {
  const earned = { shopId: 7, customerId: 3, points: 80, reason: "Complete an order #1001", customer: { points: 50 } };

  it("does nothing when refunds don't take points back or the order earned nothing", async () => {
    db.storeSettings.findFirst.mockResolvedValue({ programEnabled: true, refundEnabled: false });
    expect(await revokeOrderPoints("a.myshopify.com", 555, "refund")).toBe("disabled");

    db.storeSettings.findFirst.mockResolvedValue({ programEnabled: true, refundEnabled: true });
    db.pointHistory.findFirst.mockResolvedValue(null);
    expect(await revokeOrderPoints("a.myshopify.com", 555, "refund")).toBe("none");
  });

  it("takes back the order reward once, capped at the remaining balance", async () => {
    db.storeSettings.findFirst.mockResolvedValue({ programEnabled: true, refundEnabled: true });
    db.pointHistory.findFirst.mockResolvedValue(earned);
    db.customer.updateMany.mockResolvedValue({ count: 1 });

    expect(await revokeOrderPoints("a.myshopify.com", 555, "cancel")).toBe("revoked");
    expect(db.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 3, points: { gte: 50 } },
      data: { points: { increment: -50 }, pointsEarned: { increment: -50 } },
    });
    expect(db.pointHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "REFUND",
        points: -50,
        reason: "Order cancelled: Complete an order #1001",
        dedupeKey: "refund:555",
      }),
    });
  });
});

describe("awardOrderPoints with VIP tiers and plans", () => {
  const order = { id: 556, name: "#1002", current_subtotal_price: "40.00", customer: { id: 9 }, line_items: [] };
  const customer = { id: 3, shopId: 7, excluded: false, referredById: null };

  it("adds the VIP tier bonus as a separate row", async () => {
    db.storeSettings.findFirst.mockResolvedValue({ programEnabled: true, rewardFulfilled: true });
    db.customer.findFirst.mockResolvedValue(customer);
    db.customer.findUnique.mockResolvedValue({ tierId: 2 });
    db.tier.findUnique.mockResolvedValue({ id: 2, title: "Gold", multiplier: "1.50" });
    db.earningRule.findFirst.mockResolvedValue({ type: "PLACE_ORDER", name: "Complete an order", active: true, points: 40, config: { method: "FIXED" } });
    db.customer.updateMany.mockResolvedValue({ count: 1 });

    expect(await awardOrderPoints("a.myshopify.com", order, "fulfilled")).toEqual({ order: "awarded", vipBonus: "awarded" });
    expect(db.pointHistory.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ points: 20, earningType: "VIP_BONUS", reason: "Gold bonus #1002", dedupeKey: "vipbonus:556" }),
    });
    expect(db.tierCredit.create).toHaveBeenCalledWith({ data: expect.objectContaining({ sourceKey: "order:556", amount: "40.00" }) });
  });

  it("skips orders over the plan's limit", async () => {
    db.storeSettings.findFirst.mockResolvedValue({ programEnabled: true, rewardFulfilled: true });
    db.customer.findFirst.mockResolvedValue(customer);
    db.subscription.findFirst.mockResolvedValue({
      id: 1,
      plan: { features: [{ code: "orders.monthly_limit", value: "250" }] },
    });
    db.subscriptionUsage.findUnique.mockResolvedValue({ used: 250, validUntil: new Date(Date.now() + 86_400_000) });

    expect(await awardOrderPoints("a.myshopify.com", order, "fulfilled")).toEqual({ skipped: "plan-limit" });
    expect(db.pointHistory.create).not.toHaveBeenCalled();
  });
});
