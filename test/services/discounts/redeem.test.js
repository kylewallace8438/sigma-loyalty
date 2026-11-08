import { describe, expect, it, vi } from "vitest";
import { db } from "../../mocks/db";
import {
  RedeemError,
  discountInput,
  issueRewardCode,
  markCodesUsed,
  redeemReward,
  redemptionCost,
  returnCodePoints,
} from "../../../app/services/discounts/redeem.server";
import { getShopAdmin } from "../../../app/services/shopify/admin.server";

vi.mock("../../../app/services/shopify/admin.server", () => ({ getShopAdmin: vi.fn() }));

const shop = "a.myshopify.com";
const now = new Date("2026-11-09T00:00:00Z");
const customer = { id: 3, shopId: 7, shopifyCustomerId: "gid://shopify/Customer/9", points: 1000, excluded: false };
const rule = (over = {}) => ({
  id: 4,
  title: "$5 off",
  pointsCost: 500,
  discountType: "FIXED_AMOUNT",
  discountValue: "5.00",
  minimumSubtotal: null,
  usageLimit: null,
  perCustomerLimit: null,
  appliesOncePerCustomer: true,
  spendMode: "FIXED",
  minPoints: null,
  maxPoints: null,
  expiresInDays: null,
  collections: null,
  product: null,
  maxShippingFee: null,
  combinesWithOrder: false,
  combinesWithProduct: true,
  combinesWithShipping: true,
  ...over,
});

// Admin API stand-in: answers each call with the next response (data for the mutation's field).
function fakeAdmin(...responses) {
  const queue = [...responses];
  return { graphql: vi.fn(async () => ({ json: async () => ({ data: queue.shift() }) })) };
}
const created = (field = "discountCodeBasicCreate") => ({ [field]: { codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/77" }, userErrors: [] } });

describe("redemptionCost", () => {
  it("is the rule's cost for a fixed reward", () => {
    expect(redemptionCost(rule(), 9999)).toEqual({ points: 500, value: 5 });
  });

  it("scales the value for points the customer chooses, within the bounds", () => {
    const increment = rule({ spendMode: "INCREMENT", pointsCost: 100, discountValue: "1.00", minPoints: 200, maxPoints: 1000 });
    expect(redemptionCost(increment, 700)).toEqual({ points: 700, value: 7 });
    expect(() => redemptionCost(increment, 100)).toThrow(RedeemError);
    expect(() => redemptionCost(increment, 250)).toThrow(/multiple/);
    expect(() => redemptionCost(increment, 1100)).toThrow(/at most/);
  });
});

describe("discountInput", () => {
  const args = { code: "ABCD2345", customerGid: customer.shopifyCustomerId, value: 5, now };

  it("builds a one-customer, single-use amount-off code", () => {
    const { field, input } = discountInput(rule({ expiresInDays: 30, minimumSubtotal: "20.00" }), args);
    expect(field).toBe("discountCodeBasicCreate");
    expect(input).toEqual({
      title: "Loyalty reward: $5 off",
      code: "ABCD2345",
      startsAt: "2026-11-09T00:00:00.000Z",
      endsAt: "2026-12-09T00:00:00.000Z",
      context: { customers: { add: ["gid://shopify/Customer/9"] } },
      minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: "20.00" } },
      usageLimit: 1,
      appliesOncePerCustomer: true,
      customerGets: { value: { discountAmount: { amount: "5.00", appliesOnEachItem: false } }, items: { all: true } },
      combinesWith: { orderDiscounts: false, productDiscounts: true, shippingDiscounts: true },
    });
  });

  it("limits percentage codes to collections and free product codes to the product", () => {
    const percent = discountInput(rule({ discountType: "PERCENTAGE", collections: [{ id: "gid://shopify/Collection/5" }] }), { ...args, value: 10 });
    expect(percent.input.customerGets).toEqual({ value: { percentage: 0.1 }, items: { collections: { add: ["gid://shopify/Collection/5"] } } });

    const free = discountInput(rule({ discountType: "FREE_PRODUCT", product: { id: "gid://shopify/Product/9" } }), { ...args, value: 25 });
    expect(free.input.customerGets.items).toEqual({ products: { productsToAdd: ["gid://shopify/Product/9"] } });
  });

  it("uses the free shipping mutation with the shipping rate cap", () => {
    const { field, input } = discountInput(rule({ discountType: "FREE_SHIPPING", maxShippingFee: "10.00" }), { ...args, value: null });
    expect(field).toBe("discountCodeFreeShippingCreate");
    expect(input).toMatchObject({ destination: { all: true }, maximumShippingPrice: "10.00", combinesWith: { orderDiscounts: false, productDiscounts: true } });
    expect(input.customerGets).toBeUndefined();
  });
});

describe("redeemReward", () => {
  const setup = (ruleOver) => {
    db.storeSettings.findFirst.mockResolvedValue({ programEnabled: true });
    db.discountRule.findFirst.mockResolvedValue(rule(ruleOver));
    db.customer.updateMany.mockResolvedValue({ count: 1 });
    db.customer.findUnique.mockResolvedValue({ points: 500 });
  };

  it("creates the code, then takes the points and records the code", async () => {
    setup();
    const admin = fakeAdmin(created());
    getShopAdmin.mockResolvedValue(admin);

    const result = await redeemReward(shop, customer, "4");

    expect(result).toMatchObject({ code: expect.stringMatching(/^[A-Z2-9]{8}$/), title: "$5 off", value: "5.00 off", points: 500 });
    expect(db.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 3, points: { gte: 500 } },
      data: { points: { increment: -500 }, pointsEarned: { increment: 0 } },
    });
    expect(db.pointHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "REDEEM", points: -500, reason: `Redeemed: $5 off (${result.code})` }),
    });
    expect(db.redeemHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        shopifyCustomerId: "gid://shopify/Customer/9",
        points: 500,
        shopifyDiscountId: "gid://shopify/DiscountCodeNode/77",
        discountRuleId: 4,
        code: result.code,
        discountValue: "5.00",
      }),
    });
  });

  it("tries a new code when Shopify says the code is taken", async () => {
    setup();
    const admin = fakeAdmin({ discountCodeBasicCreate: { codeDiscountNode: null, userErrors: [{ code: "TAKEN", message: "Code must be unique" }] } }, created());
    getShopAdmin.mockResolvedValue(admin);

    await redeemReward(shop, customer, 4);
    expect(admin.graphql).toHaveBeenCalledTimes(2);
  });

  it("deletes the Shopify code when the points can't be taken", async () => {
    setup();
    db.customer.updateMany.mockResolvedValue({ count: 0 }); // balance spent elsewhere meanwhile
    const admin = fakeAdmin(created(), { discountCodeDelete: { deletedCodeDiscountId: "x", userErrors: [] } });
    getShopAdmin.mockResolvedValue(admin);

    await expect(redeemReward(shop, customer, 4)).rejects.toThrow(/enough points/);
    expect(admin.graphql).toHaveBeenLastCalledWith(expect.stringContaining("discountCodeDelete"), {
      variables: { id: "gid://shopify/DiscountCodeNode/77" },
    });
    expect(db.redeemHistory.create).not.toHaveBeenCalled();
  });

  it("refuses without calling Shopify when not allowed", async () => {
    setup();
    await expect(redeemReward(shop, { ...customer, points: 100 }, 4)).rejects.toThrow(/enough points/);
    await expect(redeemReward(shop, { ...customer, excluded: true }, 4)).rejects.toThrow(/isn't part/);

    setup({ perCustomerLimit: 1 });
    db.redeemHistory.count.mockResolvedValue(1);
    await expect(redeemReward(shop, customer, 4)).rejects.toThrow(/maximum/);

    db.discountRule.findFirst.mockResolvedValue(null);
    await expect(redeemReward(shop, customer, 99)).rejects.toThrow(/isn't available/);

    db.storeSettings.findFirst.mockResolvedValue({ programEnabled: false });
    await expect(redeemReward(shop, customer, 4)).rejects.toThrow(/paused/);
    expect(getShopAdmin).not.toHaveBeenCalled();
  });
});

describe("issueRewardCode", () => {
  it("records a free code without touching the balance", async () => {
    getShopAdmin.mockResolvedValue(fakeAdmin(created("discountCodeFreeShippingCreate")));
    db.redeemHistory.create.mockResolvedValue({ id: 12 });

    const issued = await issueRewardCode(shop, customer, rule({ discountType: "FREE_SHIPPING", discountValue: null }));

    expect(issued).toMatchObject({ code: expect.any(String), redemptionId: 12 });
    expect(db.redeemHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ points: 0, discountValue: null }) });
    expect(db.customer.updateMany).not.toHaveBeenCalled();
  });
});

describe("markCodesUsed", () => {
  it("marks the app's codes used by an order, matching case-insensitively", async () => {
    db.redeemHistory.updateMany.mockResolvedValue({ count: 1 });
    const payload = { id: 555, created_at: "2026-11-09T10:00:00Z", discount_codes: [{ code: "abcd2345" }, { code: "SUMMER" }] };

    expect(await markCodesUsed(shop, payload)).toBe(1);
    expect(db.redeemHistory.updateMany).toHaveBeenCalledWith({
      where: { shop: { domain: shop }, code: { in: ["ABCD2345", "SUMMER"] }, usedAt: null },
      data: { usedAt: new Date("2026-11-09T10:00:00Z"), usedOrderId: 555n },
    });
    expect(await markCodesUsed(shop, { id: 1, discount_codes: [] })).toBe(0);
  });
});

describe("returnCodePoints", () => {
  it("gives back the points of codes used in the order, once each", async () => {
    db.storeSettings.findFirst.mockResolvedValue({ programEnabled: true, returnPointsOnRefund: true });
    db.redeemHistory.findMany.mockResolvedValue([{ id: 8, shopId: 7, points: 500, code: "ABCD2345", title: "$5 off", customer: { id: 3 } }]);
    db.customer.updateMany.mockResolvedValue({ count: 1 });

    expect(await returnCodePoints(shop, 555)).toBe(1);
    expect(db.pointHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "RETURN_CODE", points: 500, dedupeKey: "return:8", shopifyOrderId: 555n }),
    });

    db.pointHistory.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    expect(await returnCodePoints(shop, 555)).toBe(0);
  });

  it("does nothing when the shop doesn't return points", async () => {
    db.storeSettings.findFirst.mockResolvedValue({ programEnabled: true, returnPointsOnRefund: false });
    expect(await returnCodePoints(shop, 555)).toBe(0);
    expect(db.redeemHistory.findMany).not.toHaveBeenCalled();
  });
});
