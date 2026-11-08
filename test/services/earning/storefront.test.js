import { describe, expect, it, vi } from "vitest";
import { db } from "../../mocks/db";
import { getWidgetData, runEarnAction } from "../../../app/services/earning/storefront.server";
import { getShopAdmin } from "../../../app/services/shopify/admin.server";

vi.mock("../../../app/services/shopify/admin.server", () => ({ getShopAdmin: vi.fn() }));

const shop = "a.myshopify.com";
const customer = { id: 3, shopId: 7, shopifyCustomerId: "gid://shopify/Customer/9", points: 40, excluded: false, birthday: null, referralCode: "CODE234567" };
const rule = (type, over = {}) => ({ type, name: type, active: true, points: 15, config: {}, ...over });
const fakeAdmin = (data) => ({ graphql: vi.fn(async () => ({ json: async () => ({ data }) })) });

describe("getWidgetData", () => {
  it("lists active rules and marks the one-time rules the customer has done", async () => {
    db.shop.findUnique.mockResolvedValue({ id: 7 });
    db.storeSettings.findFirst.mockResolvedValue({ programEnabled: true, pointsName: "Coins" });
    db.earningRule.findMany.mockResolvedValue([
      rule("PLACE_ORDER", { config: { method: "FIXED" } }),
      rule("FOLLOW_INSTAGRAM", { config: { url: "https://instagram.com/shop" } }),
      rule("SHARE_ON_X", { config: { url: "https://shop.com" } }),
      rule("REFERRER"),
    ]);
    db.customer.findFirst.mockResolvedValue(customer);
    db.pointHistory.findMany.mockResolvedValue([{ dedupeKey: "FOLLOW_INSTAGRAM" }]);
    db.discountRule.findMany.mockResolvedValue([
      { id: 4, title: "$5 off", discountType: "FIXED_AMOUNT", discountValue: "5.00", pointsCost: 500, spendMode: "FIXED" },
    ]);
    db.redeemHistory.findMany.mockResolvedValue([
      { code: "ABCD2345", title: "$5 off", expiresAt: null, usedAt: null },
      { code: "USED2345", title: "$5 off", expiresAt: null, usedAt: new Date() },
    ]);

    const data = await getWidgetData(shop, "9");

    expect(data).toMatchObject({ loggedIn: true, enabled: true, pointsName: "Coins", points: 40, referralCode: "CODE234567" });
    expect(data.rules.map((r) => [r.type, r.done])).toEqual([
      ["PLACE_ORDER", false],
      ["REFERRER", false],
      ["FOLLOW_INSTAGRAM", true],
      ["SHARE_ON_X", false],
    ]);
    expect(data.rewards).toEqual([
      expect.objectContaining({ id: 4, title: "$5 off", value: "5.00 off", pointsCost: 500, discountValue: 5 }),
    ]);
    expect(data.codes).toEqual([
      { code: "ABCD2345", title: "$5 off", expiresAt: null, used: false, expired: false },
      { code: "USED2345", title: "$5 off", expiresAt: null, used: true, expired: false },
    ]);
    expect(data.rules.find((r) => r.type === "SHARE_ON_X").link).toBe("https://x.com/intent/post?url=https%3A%2F%2Fshop.com");
    expect(db.pointHistory.findMany).toHaveBeenCalledWith({
      where: { customerId: 3, dedupeKey: { in: ["FOLLOW_INSTAGRAM", "SHARE_ON_X"] } },
      select: { dedupeKey: true },
    });
  });

  it("shows no rules while the program is off", async () => {
    db.shop.findUnique.mockResolvedValue({ id: 7 });
    db.storeSettings.findFirst.mockResolvedValue({ programEnabled: false });
    expect(await getWidgetData(shop, null)).toMatchObject({ loggedIn: false, enabled: false, rules: [] });
  });
});

describe("runEarnAction", () => {
  const setup = () => {
    db.customer.findFirst.mockResolvedValue(customer);
    db.customer.findUnique.mockResolvedValue({ points: 55 });
    db.customer.updateMany.mockResolvedValue({ count: 1 });
    db.storeSettings.findFirst.mockResolvedValue({ programEnabled: true });
    db.pointHistory.count.mockResolvedValue(0);
  };

  it("gives a social rule's points once", async () => {
    setup();
    db.earningRule.findFirst.mockResolvedValue(rule("FOLLOW_TIKTOK"));

    expect(await runEarnAction(shop, "9", { action: "social", type: "FOLLOW_TIKTOK" })).toEqual({ ok: true, points: 55 });
    expect(db.pointHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ dedupeKey: "FOLLOW_TIKTOK" }) });

    db.pointHistory.count.mockResolvedValue(1);
    expect(await runEarnAction(shop, "9", { action: "social", type: "FOLLOW_TIKTOK" })).toEqual({
      ok: false,
      error: "You've already earned this reward.",
    });
  });

  it("refuses non-social types sent as social, and excluded customers", async () => {
    setup();
    expect((await runEarnAction(shop, "9", { action: "social", type: "PLACE_ORDER" })).ok).toBe(false);
    db.customer.findFirst.mockResolvedValue({ ...customer, excluded: true });
    expect((await runEarnAction(shop, "9", { action: "social", type: "FOLLOW_X" })).error).toMatch(/isn't part/);
  });

  it("subscribes the customer to email marketing before giving newsletter points", async () => {
    setup();
    db.earningRule.findFirst.mockResolvedValue(rule("NEWSLETTER"));
    const admin = fakeAdmin({ customerEmailMarketingConsentUpdate: { customer: { id: "x" }, userErrors: [] } });
    getShopAdmin.mockResolvedValue(admin);

    expect(await runEarnAction(shop, "9", { action: "newsletter" })).toEqual({ ok: true, points: 55 });
    expect(admin.graphql).toHaveBeenCalledWith(expect.stringContaining("customerEmailMarketingConsentUpdate"), {
      variables: { customerId: "gid://shopify/Customer/9" },
    });
  });

  it("gives no newsletter points when Shopify refuses the subscription", async () => {
    setup();
    db.earningRule.findFirst.mockResolvedValue(rule("NEWSLETTER"));
    getShopAdmin.mockResolvedValue(
      fakeAdmin({ customerEmailMarketingConsentUpdate: { customer: null, userErrors: [{ field: ["email"], message: "Email required" }] } }),
    );

    expect((await runEarnAction(shop, "9", { action: "newsletter" })).ok).toBe(false);
    expect(db.pointHistory.create).not.toHaveBeenCalled();
  });

  it("checks the Shopify profile before giving Complete profile points", async () => {
    setup();
    db.earningRule.findFirst.mockResolvedValue(rule("COMPLETE_PROFILE"));
    getShopAdmin.mockResolvedValue(fakeAdmin({ customer: { firstName: "Ha", lastName: null, defaultAddress: { id: "a" } } }));
    expect((await runEarnAction(shop, "9", { action: "profile" })).error).toMatch(/last name/);

    getShopAdmin.mockResolvedValue(fakeAdmin({ customer: { firstName: "Ha", lastName: "Viet", defaultAddress: { id: "a" } } }));
    expect(await runEarnAction(shop, "9", { action: "profile" })).toEqual({ ok: true, points: 55 });
  });

  it("validates and saves a birthday", async () => {
    setup();
    expect((await runEarnAction(shop, "9", { action: "birthday", birthday: "1990-13-01" })).ok).toBe(false);
    db.earningRule.findFirst.mockResolvedValue(null);
    expect(await runEarnAction(shop, "9", { action: "birthday", birthday: "1990-06-01" })).toEqual({ ok: true, points: 55 });
    expect(db.customer.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: expect.objectContaining({ birthday: new Date("1990-06-01T00:00:00Z") }),
    });
  });
});
