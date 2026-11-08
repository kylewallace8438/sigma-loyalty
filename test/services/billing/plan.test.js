import { describe, expect, it } from "vitest";
import { db, FREE_SUBSCRIPTION } from "../../mocks/db";
import { canUse, ensureSubscription, planSummary, recordUse, remaining } from "../../../app/services/billing/plan.server";

const now = new Date("2026-06-01T00:00:00Z");
const withFeatures = (features) => ({ ...FREE_SUBSCRIPTION, plan: { ...FREE_SUBSCRIPTION.plan, features } });

describe("ensureSubscription", () => {
  it("subscribes a shop without a plan to Free", async () => {
    db.subscription.findFirst.mockResolvedValue(null);
    db.plan.findUnique.mockResolvedValue({ id: 2, name: "Free" });
    db.subscription.create.mockResolvedValue({ id: 5 });

    await ensureSubscription(7);

    expect(db.subscription.create).toHaveBeenCalledWith({ data: { shopId: 7, planId: 2 }, include: { plan: { include: { features: true } } } });
  });
});

describe("canUse / remaining", () => {
  it("treats Y and UNLIMITED as on, N and missing as off", async () => {
    db.subscription.findFirst.mockResolvedValue(withFeatures([
      { code: "tier.vip_tiers", value: "Y" },
      { code: "orders.monthly_limit", value: "UNLIMITED" },
      { code: "earning.birthday", value: "N" },
    ]));
    expect(await canUse(7, "tier.vip_tiers", now)).toBe(true);
    expect(await remaining(7, "orders.monthly_limit", now)).toBe(Infinity);
    expect(await canUse(7, "earning.birthday", now)).toBe(false);
    expect(await canUse(7, "points.expiration", now)).toBe(false);
  });

  it("counts limits against the usage in the current window", async () => {
    db.subscription.findFirst.mockResolvedValue(withFeatures([{ code: "orders.monthly_limit", value: "250" }]));
    db.subscriptionUsage.findUnique.mockResolvedValue({ used: 249, validUntil: new Date("2026-06-10") });
    expect(await remaining(7, "orders.monthly_limit", now)).toBe(1);

    db.subscriptionUsage.findUnique.mockResolvedValue({ used: 250, validUntil: new Date("2026-06-10") });
    expect(await canUse(7, "orders.monthly_limit", now)).toBe(false);

    // The window has passed: the limit is available again.
    db.subscriptionUsage.findUnique.mockResolvedValue({ used: 250, validUntil: new Date("2026-05-01") });
    expect(await remaining(7, "orders.monthly_limit", now)).toBe(250);
  });

  it("lets a shop override win inside its time window", async () => {
    db.subscription.findFirst.mockResolvedValue(withFeatures([{ code: "earning.birthday", value: "N" }]));
    db.shopFeature.findMany.mockResolvedValue([
      { code: "earning.birthday", value: "Y", startsAt: null, endsAt: new Date("2026-07-01") },
      { code: "tier.vip_tiers", value: "Y", startsAt: new Date("2026-09-01"), endsAt: null },
    ]);
    expect(await canUse(7, "earning.birthday", now)).toBe(true);
    expect(await canUse(7, "tier.vip_tiers", now)).toBe(false);
  });
});

describe("recordUse", () => {
  it("doesn't count unlimited features", async () => {
    await recordUse(7, "orders.monthly_limit", now);
    expect(db.subscriptionUsage.create).not.toHaveBeenCalled();
  });

  it("starts a 30-day window on first use and restarts it once it has passed", async () => {
    db.subscription.findFirst.mockResolvedValue(withFeatures([{ code: "orders.monthly_limit", value: "250" }]));
    db.subscriptionUsage.findUnique.mockResolvedValue(null);
    await recordUse(7, "orders.monthly_limit", now);
    expect(db.subscriptionUsage.create).toHaveBeenCalledWith({
      data: { subscriptionId: 1, code: "orders.monthly_limit", used: 1, validUntil: new Date("2026-07-01T00:00:00Z") },
    });

    db.subscriptionUsage.findUnique.mockResolvedValue({ used: 10, validUntil: new Date("2026-05-01") });
    await recordUse(7, "orders.monthly_limit", now);
    expect(db.subscriptionUsage.update).toHaveBeenLastCalledWith({
      where: { subscriptionId_code: { subscriptionId: 1, code: "orders.monthly_limit" } },
      data: { used: 1, validUntil: new Date("2026-07-01T00:00:00Z") },
    });

    db.subscriptionUsage.findUnique.mockResolvedValue({ used: 10, validUntil: new Date("2026-06-20") });
    await recordUse(7, "orders.monthly_limit", now);
    expect(db.subscriptionUsage.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { used: { increment: 1 } } }));
  });
});

describe("planSummary", () => {
  it("lists the Free plan with every feature included", async () => {
    const summary = await planSummary(7, now);
    expect(summary).toMatchObject({ name: "Free", price: 0 });
    expect(summary.features.every((f) => f.on && f.limit === null)).toBe(true);
  });
});
