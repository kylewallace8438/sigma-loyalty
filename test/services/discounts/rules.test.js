import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
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
      perCustomerLimit: null,
      appliesOncePerCustomer: false,
      active: true,
      spendMode: "FIXED",
      minPoints: null,
      maxPoints: null,
      expiresInDays: null,
      collections: Prisma.DbNull,
      product: Prisma.DbNull,
      maxShippingFee: null,
      combinesWithOrder: false,
      combinesWithProduct: false,
      combinesWithShipping: false,
    });
  });

  it("reads points chosen by the customer (fixed amount only), with multiples of the cost as bounds", () => {
    const { data, errors } = parseRuleForm(
      form({ ...valid, spendMode: "INCREMENT", minPoints: "200", maxPoints: "1000", expiresInDays: "30" }),
    );
    expect(errors).toEqual({});
    expect(data).toMatchObject({ spendMode: "INCREMENT", minPoints: 200, maxPoints: 1000, expiresInDays: 30 });

    expect(parseRuleForm(form({ ...valid, spendMode: "INCREMENT", minPoints: "150" })).errors.minPoints).toMatch(/multiple/);
    expect(parseRuleForm(form({ ...valid, spendMode: "INCREMENT", minPoints: "500", maxPoints: "200" })).errors.maxPoints).toBeDefined();
    // Percentage rewards always cost a fixed amount.
    expect(parseRuleForm(form({ ...valid, discountType: "PERCENTAGE", spendMode: "INCREMENT" })).data.spendMode).toBe("FIXED");
  });

  it("keeps collections for amount and percentage rewards only", () => {
    const collections = JSON.stringify([{ id: "gid://shopify/Collection/5", title: "Sale" }]);
    expect(parseRuleForm(form({ ...valid, collections })).data.collections).toEqual([{ id: "gid://shopify/Collection/5", title: "Sale" }]);
    expect(parseRuleForm(form({ ...valid, discountType: "FREE_SHIPPING", collections })).data.collections).toBe(Prisma.DbNull);
    expect(parseRuleForm(form({ ...valid, collections: "[{\"id\":\"gid://shopify/Product/1\"}]" })).errors.collections).toBeDefined();
  });

  it("requires the product of a free product reward, and keeps the shipping cap for free shipping", () => {
    expect(parseRuleForm(form({ ...valid, discountType: "FREE_PRODUCT" })).errors.product).toBeDefined();
    const product = JSON.stringify([{ id: "gid://shopify/Product/9", title: "Hat" }]);
    const { data, errors } = parseRuleForm(form({ ...valid, discountType: "FREE_PRODUCT", discountValue: "25", product }));
    expect(errors).toEqual({});
    expect(data.product).toEqual({ id: "gid://shopify/Product/9", title: "Hat" });

    const shipping = parseRuleForm(form({ ...valid, discountType: "FREE_SHIPPING", maxShippingFee: "12" }));
    expect(shipping.data.maxShippingFee).toBe("12.00");
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
