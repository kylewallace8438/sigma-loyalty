import { describe, expect, it } from "vitest";
import { db } from "../../mocks/db";
import {
  DEFAULT_SETTINGS,
  getSettings,
  parseSettingsForm,
  pointsLabel,
  saveSettings,
  toSettingsValues,
} from "../../../app/services/settings/settings.server";

const DOMAIN = "a.myshopify.com";
const form = (entries) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.append(k, v);
  return data;
};

describe("getSettings", () => {
  it("returns the defaults (program off) when the shop never saved settings", async () => {
    db.storeSettings.findFirst.mockResolvedValue(null);
    expect(await getSettings(DOMAIN)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.programEnabled).toBe(false);
  });

  it("returns the stored settings without the row's ids", async () => {
    db.storeSettings.findFirst.mockResolvedValue({ id: 1, shopId: 7, ...DEFAULT_SETTINGS, pointsName: "Coins" });
    expect(await getSettings(DOMAIN)).toEqual({ ...DEFAULT_SETTINGS, pointsName: "Coins" });
    expect(db.storeSettings.findFirst.mock.calls[0][0].where).toEqual({ shop: { domain: DOMAIN } });
  });
});

describe("pointsLabel", () => {
  it("falls back to Points", () => {
    expect(pointsLabel({ pointsName: null })).toBe("Points");
    expect(pointsLabel({ pointsName: "Stars" })).toBe("Stars");
  });
});

describe("parseSettingsForm", () => {
  it("reads checkboxes by presence and the expiration months", () => {
    const { data, errors } = parseSettingsForm(
      form({ programEnabled: "on", pointsName: " Coins ", pointExpirationEnabled: "on", pointExpirationMonths: "6" }),
    );
    expect(errors).toEqual({});
    expect(data).toEqual({
      programEnabled: true,
      pointsName: "Coins",
      includeTax: false,
      rewardFulfilled: false,
      pointExpirationEnabled: true,
      pointExpirationMonths: 6,
    });
  });

  it("ignores the months when expiration is off", () => {
    const { data, errors } = parseSettingsForm(form({ pointExpirationMonths: "abc" }));
    expect(errors).toEqual({});
    expect(data.pointExpirationMonths).toBeNull();
    expect(data.pointsName).toBeNull();
  });

  it("validates the months and the name length", () => {
    const { errors } = parseSettingsForm(
      form({ pointsName: "x".repeat(51), pointExpirationEnabled: "on", pointExpirationMonths: "0" }),
    );
    expect(errors.pointsName).toBeDefined();
    expect(errors.pointExpirationMonths).toBeDefined();
  });

  it("round-trips the form values", () => {
    const values = toSettingsValues({ ...DEFAULT_SETTINGS, pointExpirationMonths: 3 });
    expect(values.pointExpirationMonths).toBe("3");
    expect(values.pointsName).toBe("");
  });
});

describe("saveSettings", () => {
  it("upserts the shop's row", async () => {
    db.shop.upsert.mockResolvedValue({ id: 7, domain: DOMAIN });
    const data = { programEnabled: true };

    await saveSettings(DOMAIN, data);

    expect(db.storeSettings.upsert).toHaveBeenCalledWith({
      where: { shopId: 7 },
      create: { shopId: 7, programEnabled: true },
      update: data,
    });
  });
});
