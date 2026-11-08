import { describe, expect, it } from "vitest";
import { db } from "../../mocks/db";
import {
  getActiveRule,
  listEarningRules,
  parseEarningRuleForm,
  saveEarningRule,
} from "../../../app/services/earning/rules.server";
import { EARNING_TYPES, describeEarning, earningSlug, typeFromSlug } from "../../../app/services/earning/types";

const form = (entries) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) if (v !== undefined) data.append(k, v);
  return data;
};

describe("listEarningRules", () => {
  it("lists every rule type, with defaults for rules never saved", async () => {
    db.earningRule.findMany.mockResolvedValue([
      { type: "PLACE_ORDER", name: "Shop with us", active: true, points: 5, config: { method: "PER_AMOUNT", spent: 10 } },
    ]);

    const groups = await listEarningRules("a.myshopify.com");
    const rules = groups.flatMap((g) => g.rules);

    expect(rules.map((r) => r.type).sort()).toEqual(EARNING_TYPES.map((t) => t.type).sort());
    expect(rules.find((r) => r.type === "PLACE_ORDER")).toEqual({
      type: "PLACE_ORDER",
      name: "Shop with us",
      active: true,
      points: 5,
      // Stored settings win; missing ones come from the defaults.
      config: { method: "PER_AMOUNT", spent: 10, itemScope: "ALL", products: [], collections: [] },
    });
    expect(rules.find((r) => r.type === "BIRTHDAY")).toEqual({
      type: "BIRTHDAY",
      name: "Happy birthday",
      active: false,
      points: 10,
      config: { requireNotice: true },
    });
  });
});

describe("getActiveRule", () => {
  it("returns null for an inactive or missing rule", async () => {
    db.earningRule.findFirst.mockResolvedValue(null);
    expect(await getActiveRule(7, "NEWSLETTER")).toBeNull();
    expect(db.earningRule.findFirst).toHaveBeenCalledWith({ where: { shopId: 7, type: "NEWSLETTER", active: true } });
  });
});

describe("parseEarningRuleForm", () => {
  const base = { name: "Complete an order", points: "10", active: "on" };

  it("reads a fixed order rule and ignores item filters", () => {
    const { data, errors } = parseEarningRuleForm(
      "PLACE_ORDER",
      form({ ...base, method: "FIXED", itemScope: "INCLUDE", products: '[{"id":"gid://shopify/Product/1","title":"Hat"}]' }),
    );
    expect(errors).toEqual({});
    expect(data).toEqual({
      name: "Complete an order",
      active: true,
      points: 10,
      config: { method: "FIXED", spent: 1, itemScope: "ALL", products: [], collections: [] },
    });
  });

  it("reads points per amount spent on selected items", () => {
    const { data, errors } = parseEarningRuleForm(
      "PLACE_ORDER",
      form({
        ...base,
        method: "PER_AMOUNT",
        spent: "12.50",
        itemScope: "EXCLUDE",
        products: "[]",
        collections: '[{"id":"gid://shopify/Collection/9","title":"Sale"}]',
      }),
    );
    expect(errors).toEqual({});
    expect(data.config).toEqual({
      method: "PER_AMOUNT",
      spent: 12.5,
      itemScope: "EXCLUDE",
      products: [],
      collections: [{ id: "gid://shopify/Collection/9", title: "Sale" }],
    });
  });

  it("rejects a bad amount, an empty selection and ids of the wrong resource", () => {
    expect(
      parseEarningRuleForm("PLACE_ORDER", form({ ...base, method: "PER_AMOUNT", spent: "0", itemScope: "INCLUDE" })).errors,
    ).toEqual({ spent: expect.any(String), items: "Select at least one product or collection." });
    expect(
      parseEarningRuleForm(
        "PLACE_ORDER",
        form({ ...base, method: "PER_AMOUNT", spent: "1", itemScope: "INCLUDE", products: '[{"id":"gid://shopify/Collection/1"}]' }),
      ).errors.items,
    ).toMatch(/Select up to/);
  });

  it("requires a name and whole points from 1", () => {
    const { errors } = parseEarningRuleForm("NEWSLETTER", form({ name: " ", points: "2.5" }));
    expect(errors).toEqual({ name: expect.any(String), points: expect.any(String) });
  });

  it("requires an http(s) link for social rules", () => {
    expect(parseEarningRuleForm("FOLLOW_INSTAGRAM", form({ ...base, url: "javascript:alert(1)" })).errors.url).toBeDefined();
    const { data, errors } = parseEarningRuleForm("FOLLOW_INSTAGRAM", form({ ...base, url: "https://instagram.com/shop" }));
    expect(errors).toEqual({});
    expect(data.config).toEqual({ url: "https://instagram.com/shop" });
  });

  it("lets referral rules give a discount code instead of points", () => {
    const coupon = parseEarningRuleForm("REFERRER", form({ ...base, points: "", rewardType: "COUPON", discountRuleId: "4" }));
    expect(coupon.errors).toEqual({});
    expect(coupon.data).toMatchObject({ points: 10, config: { rewardType: "COUPON", discountRuleId: 4 } });
    expect(parseEarningRuleForm("REFERRER", form({ ...base, rewardType: "COUPON" })).errors.discountRuleId).toBeDefined();
    expect(parseEarningRuleForm("REFERRER", form(base)).data.config).toEqual({ rewardType: "POINTS", discountRuleId: null });
  });

  it("reads the birthday notice option and stores {} for rules without settings", () => {
    expect(parseEarningRuleForm("BIRTHDAY", form(base)).data.config).toEqual({ requireNotice: false });
    expect(parseEarningRuleForm("BIRTHDAY", form({ ...base, requireNotice: "on" })).data.config).toEqual({ requireNotice: true });
    expect(parseEarningRuleForm("CREATE_ACCOUNT", form(base)).data.config).toEqual({});
  });
});

describe("saveEarningRule", () => {
  it("upserts the shop's rule of that type", async () => {
    db.shop.upsert.mockResolvedValue({ id: 7 });
    const data = { name: "Join", active: true, points: 50, config: {} };

    await saveEarningRule("a.myshopify.com", "CREATE_ACCOUNT", data);

    expect(db.earningRule.upsert).toHaveBeenCalledWith({
      where: { shopId_type: { shopId: 7, type: "CREATE_ACCOUNT" } },
      create: { shopId: 7, type: "CREATE_ACCOUNT", ...data },
      update: data,
    });
  });
});

describe("types helpers", () => {
  it("maps types to URL slugs and back", () => {
    expect(earningSlug("PLACE_ORDER")).toBe("place-order");
    expect(typeFromSlug("place-order")).toBe("PLACE_ORDER");
    expect(typeFromSlug("nope")).toBeNull();
  });

  it("describes what a rule gives", () => {
    const order = { type: "PLACE_ORDER", points: 5, config: { method: "PER_AMOUNT", spent: 1, itemScope: "INCLUDE" } };
    expect(describeEarning(order, { pointsName: "Coins", formatMoney: (v) => `$${v}` })).toBe(
      "5 coins for every $1 spent on selected items",
    );
    expect(describeEarning({ type: "BIRTHDAY", points: 100, config: {} })).toBe("100 points every birthday");
    expect(describeEarning({ type: "NEWSLETTER", points: 20, config: {} })).toBe("20 points once");
  });
});
