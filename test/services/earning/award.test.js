import { describe, expect, it, vi } from "vitest";
import { db } from "../../mocks/db";
import { earnPoints, earnReward } from "../../../app/services/earning/award.server";
import { awardSignupPoints } from "../../../app/services/earning/account.server";
import { getShopAdmin } from "../../../app/services/shopify/admin.server";

vi.mock("../../../app/services/shopify/admin.server", () => ({ getShopAdmin: vi.fn() }));

const customer = { id: 3, shopId: 7, excluded: false, state: "ENABLED" };
const award = { type: "NEWSLETTER", points: 20, reason: "Subscribe", dedupeKey: "NEWSLETTER" };

describe("earnPoints", () => {
  it("awards points as an EARN row with the rule type and key", async () => {
    db.customer.updateMany.mockResolvedValue({ count: 1 });

    expect(await earnPoints({ programEnabled: true }, customer, award)).toBe("awarded");
    expect(db.pointHistory.create).toHaveBeenCalledWith({
      data: {
        shopId: 7,
        customerId: 3,
        type: "EARN",
        points: 20,
        reason: "Subscribe",
        earningType: "NEWSLETTER",
        shopifyOrderId: null,
        dedupeKey: "NEWSLETTER",
      },
    });
  });

  it("restarts the expiration period when expiration is on", async () => {
    vi.useFakeTimers({ now: new Date("2026-01-15T00:00:00Z") });
    db.customer.updateMany.mockResolvedValue({ count: 1 });

    await earnPoints({ programEnabled: true, pointExpirationEnabled: true, pointExpirationMonths: 6 }, customer, award);

    expect(db.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 3 },
      data: expect.objectContaining({ pointsExpireAt: new Date("2026-07-15T00:00:00Z") }),
    });
    vi.useRealTimers();
  });

  it("gives nothing while the program is off, to excluded customers or for 0 points", async () => {
    expect(await earnPoints({ programEnabled: false }, customer, award)).toBe("disabled");
    expect(await earnPoints({ programEnabled: true }, { ...customer, excluded: true }, award)).toBe("excluded");
    expect(await earnPoints({ programEnabled: true }, customer, { ...award, points: 0 })).toBe("zero");
    expect(db.customer.updateMany).not.toHaveBeenCalled();
  });

  it("reports a second award with the same key as a duplicate", async () => {
    db.customer.updateMany.mockResolvedValue({ count: 1 });
    db.pointHistory.create.mockRejectedValue(Object.assign(new Error("Unique"), { code: "P2002" }));
    expect(await earnPoints({ programEnabled: true }, customer, award)).toBe("duplicate");
  });
});

describe("awardSignupPoints", () => {
  const rule = { type: "CREATE_ACCOUNT", name: "Create an account", active: true, points: 100, config: {} };

  it("gives the Create account points once", async () => {
    db.customer.findFirst.mockResolvedValue(customer);
    db.earningRule.findFirst.mockResolvedValue(rule);
    db.storeSettings.findFirst.mockResolvedValue({ programEnabled: true, rewardGuests: true });
    db.customer.updateMany.mockResolvedValue({ count: 1 });

    expect(await awardSignupPoints("a.myshopify.com", { id: 9 })).toBe("awarded");
    expect(db.pointHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ points: 100, earningType: "CREATE_ACCOUNT", dedupeKey: "CREATE_ACCOUNT" }),
    });
  });

  it("skips guests when the shop doesn't reward them, and inactive rules", async () => {
    db.customer.findFirst.mockResolvedValue({ ...customer, state: "DISABLED" });
    db.earningRule.findFirst.mockResolvedValue(rule);
    db.storeSettings.findFirst.mockResolvedValue({ programEnabled: true, rewardGuests: false });
    expect(await awardSignupPoints("a.myshopify.com", { id: 9 })).toBe("guest");

    db.earningRule.findFirst.mockResolvedValue(null);
    expect(await awardSignupPoints("a.myshopify.com", { id: 9 })).toBe("inactive");
  });
});

describe("earnReward", () => {
  const settings = { programEnabled: true };
  const couponRule = { type: "REFERRER", name: "Refer a friend", points: 10, config: { rewardType: "COUPON", discountRuleId: 4 } };

  it("gives points for a points rule", async () => {
    db.customer.updateMany.mockResolvedValue({ count: 1 });
    const pointsRule = { ...couponRule, config: { rewardType: "POINTS" } };
    expect(await earnReward(settings, "a.myshopify.com", customer, pointsRule, { type: "REFERRER", reason: "Refer", dedupeKey: "REFERRER:5" })).toBe("awarded");
    expect(db.pointHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ points: 10 }) });
  });

  it("gives a free code once, logged as a 0-point row", async () => {
    db.pointHistory.count.mockResolvedValue(0);
    db.discountRule.findFirst.mockResolvedValue({ id: 4, title: "Free shipping", discountType: "FREE_SHIPPING", discountValue: null });
    getShopAdmin.mockResolvedValue({
      graphql: vi.fn(async () => ({
        json: async () => ({ data: { discountCodeFreeShippingCreate: { codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/1" }, userErrors: [] } } }),
      })),
    });
    db.redeemHistory.create.mockResolvedValue({ id: 12 });
    db.customer.updateMany.mockResolvedValue({ count: 1 });

    expect(await earnReward(settings, "a.myshopify.com", customer, couponRule, { type: "REFERRER", reason: "Refer a friend", dedupeKey: "REFERRER:5" })).toBe("awarded");
    expect(db.pointHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ points: 0, earningType: "REFERRER", dedupeKey: "REFERRER:5", reason: expect.stringMatching(/^Refer a friend: Free shipping \(/) }),
    });

    db.pointHistory.count.mockResolvedValue(1);
    expect(await earnReward(settings, "a.myshopify.com", customer, couponRule, { type: "REFERRER", reason: "Refer", dedupeKey: "REFERRER:5" })).toBe("duplicate");
  });
});
