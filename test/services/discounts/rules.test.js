import { describe, expect, it } from "vitest";
import { parseRuleFilters, parseRuleForm } from "../../../app/services/discounts/rules.server";

const form = (fields) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

const valid = { title: "10 off", pointsCost: "100", discountType: "FIXED_AMOUNT", discountValue: "10" };

describe("parseRuleFilters", () => {
  it("keeps known values and drops unknown ones", () => {
    expect(parseRuleFilters(new URLSearchParams("q= off &status=active&type=PERCENTAGE"))).toEqual({
      query: "off",
      status: "active",
      type: "PERCENTAGE",
    });
    expect(parseRuleFilters(new URLSearchParams("status=archived&type=BOGUS"))).toEqual({
      query: "",
      status: "",
      type: "",
    });
  });
});

describe("parseRuleForm", () => {
  it("returns Prisma-ready data for a valid form", () => {
    const { data, errors } = parseRuleForm(form({ ...valid, minimumSubtotal: "50", active: "on" }));
    expect(errors).toEqual({});
    expect(data).toEqual({
      title: "10 off",
      pointsCost: 100,
      discountType: "FIXED_AMOUNT",
      discountValue: "10.00",
      minimumSubtotal: "50.00",
      usageLimit: null,
      appliesOncePerCustomer: false,
      active: true,
    });
  });

  it("requires a title and a whole points cost of at least 1", () => {
    const { errors } = parseRuleForm(form({ ...valid, title: " ", pointsCost: "1.5" }));
    expect(Object.keys(errors).sort()).toEqual(["pointsCost", "title"]);
  });

  it("caps percentages at 100", () => {
    const { errors } = parseRuleForm(form({ ...valid, discountType: "PERCENTAGE", discountValue: "120" }));
    expect(errors.discountValue).toMatch(/100/);
  });

  it("doesn't need a value for free shipping", () => {
    const { data, errors } = parseRuleForm(form({ ...valid, discountType: "FREE_SHIPPING", discountValue: "" }));
    expect(errors).toEqual({});
    expect(data.discountValue).toBeNull();
  });

  it("rejects a usage limit that isn't a positive whole number", () => {
    expect(parseRuleForm(form({ ...valid, usageLimit: "0" })).errors.usageLimit).toBeDefined();
    expect(parseRuleForm(form({ ...valid, usageLimit: "5" })).data.usageLimit).toBe(5);
  });
});
