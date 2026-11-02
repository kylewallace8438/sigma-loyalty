import { describe, expect, it } from "vitest";
import { db } from "../../mocks/db";
import { listGachaRules, parseTierForm, saveTiers } from "../../../app/services/gacha/gacha.server";

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
