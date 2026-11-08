import { describe, expect, it } from "vitest";
import { db } from "../../mocks/db";
import {
  deleteTier,
  ensureTiers,
  parseProgramForm,
  parseTierForm,
  saveProgram,
  saveTier,
} from "../../../app/services/tiers/program.server";

const form = (entries) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const item of [].concat(v)) data.append(k, item);
  return data;
};

describe("ensureTiers", () => {
  it("creates the entry tier when the shop has none", async () => {
    db.tier.findMany.mockResolvedValueOnce([]).mockResolvedValue([{ id: 1, isDefault: true }]);
    expect(await ensureTiers(7)).toEqual([{ id: 1, isDefault: true }]);
    expect(db.tier.create).toHaveBeenCalledWith({ data: { shopId: 7, title: "Entry tier", icon: "STAR", threshold: 0, isDefault: true } });
  });
});

describe("parseProgramForm", () => {
  it("reads the settings and validates the choices", () => {
    const { data, errors } = parseProgramForm(form({ enabled: "on", entryMethod: "MONEY_SPENT", milestone: "CALENDAR_YEAR", startDate: "2026-12-01" }));
    expect(errors).toEqual({});
    expect(data).toEqual({ enabled: true, entryMethod: "MONEY_SPENT", milestone: "CALENDAR_YEAR", startDate: new Date("2026-12-01T00:00:00Z") });
    expect(Object.keys(parseProgramForm(form({ entryMethod: "X", milestone: "Y", startDate: "soon" })).errors).sort()).toEqual([
      "entryMethod",
      "milestone",
      "startDate",
    ]);
  });
});

describe("saveProgram", () => {
  it("resets tiers when what customers qualify by changes", async () => {
    db.shop.upsert.mockResolvedValue({ id: 7 });
    db.tierProgram.findUnique.mockResolvedValue({ id: 1, shopId: 7, entryMethod: "POINTS_EARNED", milestone: "LIFETIME" });

    await saveProgram("a.myshopify.com", { enabled: true, entryMethod: "MONEY_SPENT", milestone: "LIFETIME", startDate: new Date() });

    expect(db.tier.deleteMany).toHaveBeenCalledWith({ where: { shopId: 7, isDefault: false } });
    expect(db.customer.updateMany).toHaveBeenCalledWith({ where: { shopId: 7 }, data: { tierId: null, tierAchievedAt: null, tierExpiresAt: null } });
    expect(db.tierCredit.deleteMany).toHaveBeenCalledWith({ where: { shopId: 7, kind: "MANUAL" } });
  });

  it("moves the re-evaluation date when the period changes", async () => {
    db.shop.upsert.mockResolvedValue({ id: 7 });
    db.tierProgram.findUnique.mockResolvedValue({ id: 1, shopId: 7, entryMethod: "POINTS_EARNED", milestone: "LIFETIME" });
    const now = new Date("2026-03-01T00:00:00Z");

    await saveProgram("a.myshopify.com", { enabled: true, entryMethod: "POINTS_EARNED", milestone: "CALENDAR_YEAR", startDate: now }, now);

    expect(db.tier.deleteMany).not.toHaveBeenCalled();
    expect(db.customer.updateMany).toHaveBeenCalledWith({
      where: { shopId: 7, tierId: { not: null } },
      data: { tierExpiresAt: new Date("2026-12-31T23:59:59Z") },
    });
  });
});

describe("parseTierForm", () => {
  const valid = { title: "Gold", icon: "CROWN", threshold: "1000", multiplier: "1.5", perks: "Free gift wrap\n\nEarly access\n" };

  it("reads a tier with perks and entry rewards", () => {
    const { data, rewardIds, errors } = parseTierForm(form({ ...valid, tagEnabled: "on", rewardIds: ["4", "5", "4"] }));
    expect(errors).toEqual({});
    expect(data).toEqual({ title: "Gold", icon: "CROWN", threshold: "1000.00", multiplier: "1.50", perks: ["Free gift wrap", "Early access"], tagEnabled: true });
    expect(rewardIds).toEqual([4, 5]);
  });

  it("requires a threshold above 0 (except the entry tier) and a multiplier above 1", () => {
    const { errors } = parseTierForm(form({ ...valid, threshold: "0", multiplier: "1" }));
    expect(Object.keys(errors).sort()).toEqual(["multiplier", "threshold"]);
    expect(parseTierForm(form({ ...valid, threshold: "" }), { isDefault: true }).data.threshold).toBe("0.00");
  });
});

describe("saveTier / deleteTier", () => {
  it("refuses a threshold another tier already uses", async () => {
    db.shop.upsert.mockResolvedValue({ id: 7 });
    db.tier.findFirst.mockResolvedValue({ id: 2, title: "Silver" });
    const result = await saveTier("a.myshopify.com", null, { title: "Gold", threshold: "500.00" }, []);
    expect(result.errors.threshold).toMatch(/Silver/);
  });

  it("links only the shop's own discount rules as entry rewards", async () => {
    db.shop.upsert.mockResolvedValue({ id: 7 });
    db.tier.findFirst.mockResolvedValue(null);
    db.discountRule.findMany.mockResolvedValue([{ id: 4 }]);
    db.tier.create.mockResolvedValue({ id: 9 });

    await saveTier("a.myshopify.com", null, { title: "Gold", threshold: "500.00" }, [4, 99]);

    expect(db.tier.create).toHaveBeenCalledWith({
      data: { title: "Gold", threshold: "500.00", shopId: 7, rewards: { create: [{ discountRuleId: 4 }] } },
    });
  });

  it("won't delete the entry tier, and returns the customers to re-place", async () => {
    db.tier.findFirst.mockResolvedValue({ id: 1, isDefault: true });
    expect((await deleteTier("a.myshopify.com", 1)).errors).toBeDefined();

    db.tier.findFirst.mockResolvedValue({ id: 2, isDefault: false, shopId: 7 });
    db.customer.findMany.mockResolvedValue([{ id: 3 }, { id: 4 }]);
    expect(await deleteTier("a.myshopify.com", 2)).toEqual({ ok: true, customerIds: [3, 4] });
    expect(db.tier.delete).toHaveBeenCalledWith({ where: { id: 2 } });
  });
});
