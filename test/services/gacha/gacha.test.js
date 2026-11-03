import { describe, expect, it } from "vitest";
import { db } from "../../mocks/db";
import {
  getPityValues,
  listGachaRules,
  parsePityForm,
  parseTierForm,
  saveGachaSetup,
  saveTiers,
} from "../../../app/services/gacha/gacha.server";

const DOMAIN = "a.myshopify.com";

const form = (entries) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.append(k, v);
  return data;
};

describe("listGachaRules", () => {
  it("returns the shop's rules with their tier and formatted discount", async () => {
    db.discountRule.findMany.mockResolvedValue([
      { id: 1, title: "10% off", pointsCost: 100, discountType: "PERCENTAGE", discountValue: "10.00", active: true, gachaTier: "GOLD" },
      { id: 2, title: "Ship", pointsCost: 50, discountType: "FREE_SHIPPING", discountValue: null, active: false, gachaTier: null },
    ]);

    expect(await listGachaRules(DOMAIN)).toEqual([
      { id: 1, title: "10% off", pointsCost: 100, value: "10% off", active: true, tier: "GOLD" },
      { id: 2, title: "Ship", pointsCost: 50, value: "Free shipping", active: false, tier: "" },
    ]);
    expect(db.discountRule.findMany.mock.calls[0][0].where).toEqual({ shop: { domain: DOMAIN } });
  });
});

describe("parseTierForm", () => {
  it("reads tier-<id> fields, with an empty value meaning not in the gacha", () => {
    expect(parseTierForm(form({ "tier-1": "WHITE", "tier-2": "", "tier-3": "GOLD" }))).toEqual({
      1: "WHITE",
      2: null,
      3: "GOLD",
    });
  });

  it("ignores unknown tiers and other fields", () => {
    expect(parseTierForm(form({ "tier-1": "RED", "tier-x": "GOLD", other: "1" }))).toEqual({});
  });
});

describe("saveTiers", () => {
  it("updates the shop's rules with one query per tier", async () => {
    db.shop.upsert.mockResolvedValue({ id: 7, domain: DOMAIN });
    db.discountRule.updateMany.mockResolvedValue({ count: 1 });

    await saveTiers(DOMAIN, { 1: "WHITE", 2: null, 3: "WHITE" });

    expect(db.discountRule.updateMany).toHaveBeenCalledTimes(2);
    expect(db.discountRule.updateMany).toHaveBeenCalledWith({
      where: { shopId: 7, id: { in: [1, 3] } },
      data: { gachaTier: "WHITE" },
    });
    expect(db.discountRule.updateMany).toHaveBeenCalledWith({
      where: { shopId: 7, id: { in: [2] } },
      data: { gachaTier: null },
    });
  });
});

describe("getPityValues", () => {
  it("returns the saved guarantees as form values", async () => {
    db.gachaSettings.findFirst.mockResolvedValue({ goldPity: 90, purplePity: null });
    expect(await getPityValues(DOMAIN)).toEqual({ goldPity: "90", purplePity: "" });
    expect(db.gachaSettings.findFirst.mock.calls[0][0].where).toEqual({ shop: { domain: DOMAIN } });
  });

  it("is empty when the shop has no settings yet", async () => {
    db.gachaSettings.findFirst.mockResolvedValue(null);
    expect(await getPityValues(DOMAIN)).toEqual({ goldPity: "", purplePity: "" });
  });
});

describe("parsePityForm", () => {
  it("returns the typed values, the guarantees and any errors", () => {
    expect(parsePityForm(form({ goldPity: " 90 ", purplePity: "x" }))).toEqual({
      values: { goldPity: "90", purplePity: "x" },
      pity: { gold: 90, purple: null },
      errors: { purplePity: expect.stringMatching(/whole number/) },
    });
  });
});

describe("saveGachaSetup", () => {
  it("saves the tiers and upserts the guarantees in one transaction", async () => {
    db.shop.upsert.mockResolvedValue({ id: 7, domain: DOMAIN });
    db.discountRule.updateMany.mockResolvedValue({ count: 1 });
    db.gachaSettings.upsert.mockResolvedValue({});

    await saveGachaSetup(DOMAIN, { 1: "GOLD", 2: null }, { gold: 90, purple: null });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.discountRule.updateMany).toHaveBeenCalledWith({
      where: { shopId: 7, id: { in: [1] } },
      data: { gachaTier: "GOLD" },
    });
    expect(db.discountRule.updateMany).toHaveBeenCalledWith({
      where: { shopId: 7, id: { in: [2] } },
      data: { gachaTier: null },
    });
    expect(db.gachaSettings.upsert).toHaveBeenCalledWith({
      where: { shopId: 7 },
      create: { shopId: 7, goldPity: 90, purplePity: null },
      update: { goldPity: 90, purplePity: null },
    });
  });
});
