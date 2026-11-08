import { describe, expect, it, vi } from "vitest";
import { db, FREE_SUBSCRIPTION } from "../../mocks/db";
import {
  changeCustomerTier,
  orderSpend,
  recordOrderSpend,
  resetExpiredTiers,
  revokeOrderSpend,
  syncCustomerTier,
  tierValue,
} from "../../../app/services/tiers/sync.server";
import { getShopAdmin } from "../../../app/services/shopify/admin.server";

vi.mock("../../../app/services/shopify/admin.server", () => ({ getShopAdmin: vi.fn() }));

const now = new Date("2026-06-15T00:00:00Z");
const program = (over = {}) => ({ id: 1, shopId: 7, enabled: true, entryMethod: "POINTS_EARNED", milestone: "LIFETIME", startDate: new Date("2026-01-01"), ...over });
const tier = (id, threshold, over = {}) => ({ id, shopId: 7, title: `T${id}`, threshold: String(threshold), multiplier: null, tagEnabled: false, isDefault: threshold === 0, rewards: [], ...over });
const TIERS = [tier(1, 0), tier(2, 500), tier(3, 2000)];
const customer = (over = {}) => ({ id: 3, shopId: 7, shopifyCustomerId: "gid://shopify/Customer/9", excluded: false, tierId: null, tierExpiresAt: null, shop: { domain: "a.myshopify.com" }, ...over });
const fakeAdmin = (...responses) => {
  const queue = [...responses];
  return { graphql: vi.fn(async () => ({ json: async () => ({ data: queue.shift() ?? {} }) })) };
};

// Points earned: earn rows, positive adjustments and manual credits.
function mockValue({ earned = 0, adjusted = 0, manual = 0, spent = 0 } = {}) {
  db.pointHistory.aggregate.mockImplementation(async ({ where }) => ({ _sum: { points: where.type === "ADJUST" ? adjusted : earned } }));
  db.tierCredit.aggregate.mockImplementation(async ({ where }) => ({ _sum: { amount: where.kind === "MANUAL" ? manual : spent } }));
}

function setup({ prog = program(), tiers = TIERS, cust = customer(), history = 0 } = {}) {
  db.tierProgram.findUnique.mockResolvedValue(prog);
  db.tier.findMany.mockResolvedValue(tiers);
  db.customer.findUnique.mockResolvedValue(cust);
  db.customer.updateMany.mockResolvedValue({ count: 1 });
  db.tierHistory.count.mockResolvedValue(history);
  getShopAdmin.mockResolvedValue(fakeAdmin({ customer: { tags: [] } }));
}

describe("tierValue", () => {
  it("counts earned points (not the VIP bonus), positive adjustments and manual credits", async () => {
    mockValue({ earned: 300, adjusted: 50, manual: 100 });
    expect(await tierValue(program(), 3, now)).toBe(450);
    expect(db.pointHistory.aggregate).toHaveBeenCalledWith({
      _sum: { points: true },
      where: { customerId: 3, type: { in: ["EARN", "REFUND"] }, OR: [{ earningType: null }, { earningType: { not: "VIP_BONUS" } }] },
    });
  });

  it("counts amounts spent since Jan 1 in a calendar-year program", async () => {
    mockValue({ spent: 120.5 });
    expect(await tierValue(program({ entryMethod: "MONEY_SPENT", milestone: "CALENDAR_YEAR" }), 3, now)).toBe(120.5);
    expect(db.tierCredit.aggregate).toHaveBeenCalledWith({
      _sum: { amount: true },
      where: { customerId: 3, createdAt: { gte: new Date("2026-01-01T00:00:00Z") } },
    });
  });
});

describe("syncCustomerTier", () => {
  it("does nothing while the program is off or not started", async () => {
    setup({ prog: program({ enabled: false }) });
    expect(await syncCustomerTier(7, 3, { now })).toEqual({ skipped: "inactive" });
    setup({ prog: program({ startDate: new Date("2027-01-01") }) });
    expect(await syncCustomerTier(7, 3, { now })).toEqual({ skipped: "inactive" });
  });

  it("does nothing when the plan doesn't include VIP tiers", async () => {
    setup();
    db.subscription.findFirst.mockResolvedValue({
      ...FREE_SUBSCRIPTION,
      plan: { ...FREE_SUBSCRIPTION.plan, features: [{ code: "tier.vip_tiers", value: "N" }] },
    });
    expect(await syncCustomerTier(7, 3, { now })).toEqual({ skipped: "plan" });
  });

  it("places a new customer by climbing from the entry tier, giving each tier's rewards", async () => {
    const rule = { id: 40, title: "Free shipping", discountType: "FREE_SHIPPING", discountValue: null };
    setup({ tiers: [tier(1, 0), tier(2, 500, { rewards: [{ discountRule: rule }], tagEnabled: true }), tier(3, 2000)] });
    mockValue({ earned: 800 });
    const admin = fakeAdmin(
      { discountCodeFreeShippingCreate: { codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/1" }, userErrors: [] } },
      { customer: { tags: ["VIP: T1", "wholesale"] } },
      { tagsRemove: { userErrors: [] } },
      { tagsAdd: { userErrors: [] } },
    );
    getShopAdmin.mockResolvedValue(admin);
    db.redeemHistory.create.mockResolvedValue({ id: 9 });

    expect(await syncCustomerTier(7, 3, { now })).toEqual({ from: null, to: 2 });
    expect(db.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 3, tierId: null },
      data: { tierId: 2, tierAchievedAt: now, tierExpiresAt: null },
    });
    expect(db.tierHistory.create.mock.calls.map(([{ data }]) => data.tierId)).toEqual([1, 2]);
    expect(db.redeemHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ discountRuleId: 40, points: 0 }) });
    expect(admin.graphql).toHaveBeenCalledWith(expect.stringContaining("tagsRemove"), { variables: { id: "gid://shopify/Customer/9", tags: ["VIP: T1"] } });
    expect(admin.graphql).toHaveBeenCalledWith(expect.stringContaining("tagsAdd"), { variables: { id: "gid://shopify/Customer/9", tags: ["VIP: T2"] } });
  });

  it("doesn't give a tier's rewards again to a customer who reached it before", async () => {
    const rule = { id: 40, title: "Gift", discountType: "FREE_SHIPPING" };
    setup({ cust: customer({ tierId: 1 }), tiers: [tier(1, 0), tier(2, 500, { rewards: [{ discountRule: rule }] })], history: 1 });
    mockValue({ earned: 600 });
    await syncCustomerTier(7, 3, { now });
    expect(db.redeemHistory.create).not.toHaveBeenCalled();
  });

  it("only moves down when allowed, straight to the best fit", async () => {
    setup({ cust: customer({ tierId: 3 }) });
    mockValue({ earned: 600 });
    expect(await syncCustomerTier(7, 3, { now })).toEqual({ skipped: "unchanged" });
    expect(await syncCustomerTier(7, 3, { now, allowDowngrade: true })).toEqual({ from: 3, to: 2 });
    expect(db.tierHistory.create).toHaveBeenCalledTimes(1);
  });

  it("sets the Dec 31 re-evaluation date in calendar-year programs", async () => {
    setup({ prog: program({ milestone: "CALENDAR_YEAR" }) });
    mockValue({ earned: 0 });
    await syncCustomerTier(7, 3, { now });
    expect(db.customer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tierId: 1, tierExpiresAt: new Date("2026-12-31T23:59:59Z") }) }),
    );
  });

  it("gives up when another sync moved the customer first", async () => {
    setup();
    mockValue({ earned: 600 });
    db.customer.updateMany.mockResolvedValue({ count: 0 });
    expect(await syncCustomerTier(7, 3, { now })).toEqual({ skipped: "concurrent" });
    expect(db.tierHistory.create).not.toHaveBeenCalled();
  });
});

describe("order spend", () => {
  it("counts the current subtotal, plus tax when included", () => {
    expect(orderSpend({ current_subtotal_price: "80.00", current_total_tax: "8.00" }, { includeTax: false })).toBe(80);
    expect(orderSpend({ current_subtotal_price: "80.00", current_total_tax: "8.00" }, { includeTax: true })).toBe(88);
  });

  it("records an order once and re-evaluates the tier", async () => {
    db.tierProgram.findUnique.mockResolvedValue(program({ enabled: false }));
    expect(await recordOrderSpend(customer(), { id: 55, current_subtotal_price: "40.00" }, { includeTax: false })).toBe(true);
    expect(db.tierCredit.create).toHaveBeenCalledWith({
      data: { shopId: 7, customerId: 3, kind: "SPEND", amount: "40.00", sourceKey: "order:55" },
    });
    db.tierCredit.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    expect(await recordOrderSpend(customer(), { id: 55, current_subtotal_price: "40.00" }, { includeTax: false })).toBe(false);
  });

  it("takes refunds off the order's amount, never below 0, and a cancellation takes the rest", async () => {
    db.tierCredit.findFirst.mockResolvedValue({ customerId: 3, customer: customer() });
    db.tierCredit.aggregate.mockResolvedValue({ _sum: { amount: "30.00" } });
    const refund = { id: 9, refund_line_items: [{ subtotal: "50.00", total_tax: "5.00" }] };

    await revokeOrderSpend("a.myshopify.com", 55, "refund", { refund, settings: { includeTax: false } });
    expect(db.tierCredit.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ amount: "-30.00", sourceKey: "refund:55:9" }) });

    await revokeOrderSpend("a.myshopify.com", 55, "cancel");
    expect(db.tierCredit.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ amount: "-30.00", sourceKey: "cancel:55" }) });
  });
});

describe("changeCustomerTier", () => {
  it("tops the customer up to the chosen tier", async () => {
    setup({ cust: customer({ tierId: 1 }) });
    db.tier.findMany.mockResolvedValue(TIERS);
    mockValue({ earned: 200 });
    expect(await changeCustomerTier(customer({ tierId: 1 }), 3, now)).toEqual({ ok: true });
    expect(db.tierCredit.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "MANUAL", amount: "1800.00" }) });
  });

  it("only moves customers up", async () => {
    setup({ cust: customer({ tierId: 2 }) });
    expect(await changeCustomerTier(customer({ tierId: 2 }), 1, now)).toEqual({ error: expect.stringMatching(/above/) });
  });
});

describe("resetExpiredTiers", () => {
  it("re-evaluates customers whose year ended, allowing them to move down", async () => {
    db.customer.findMany.mockResolvedValueOnce([{ id: 3, shopId: 7 }]).mockResolvedValue([]);
    setup({ prog: program({ milestone: "CALENDAR_YEAR" }), cust: customer({ tierId: 3, tierExpiresAt: new Date("2025-12-31T23:59:59Z") }) });
    mockValue({ earned: 0 });

    expect(await resetExpiredTiers(new Date("2026-01-01T01:00:00Z"))).toBe(1);
    expect(db.customer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tierId: 1, tierExpiresAt: new Date("2026-12-31T23:59:59Z") }) }),
    );
  });
});
