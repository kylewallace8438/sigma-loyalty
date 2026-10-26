import { describe, expect, it } from "vitest";
import { codeStatus, parseCodeForm } from "../../../app/services/discounts/codes.server";

const form = (fields) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

const valid = { ruleId: "1", code: "save-10", startsAt: "2026-11-01", endsAt: "2026-11-30" };

describe("codeStatus", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  it("is Scheduled before the start, Expired after the end, otherwise Active", () => {
    expect(codeStatus({ startsAt: new Date("2026-11-11"), endsAt: null }, now)).toBe("Scheduled");
    expect(codeStatus({ startsAt: new Date("2026-11-01"), endsAt: new Date("2026-11-09") }, now)).toBe("Expired");
    expect(codeStatus({ startsAt: new Date("2026-11-01"), endsAt: null }, now)).toBe("Active");
  });
});

describe("parseCodeForm", () => {
  it("uppercases the code and spans whole UTC days", () => {
    const { data, errors } = parseCodeForm(form(valid), { isNew: true });
    expect(errors).toEqual({});
    expect(data).toMatchObject({
      ruleId: 1,
      code: "SAVE-10",
      startsAt: new Date("2026-11-01T00:00:00Z"),
      endsAt: new Date("2026-11-30T23:59:59Z"),
      customers: [],
      products: [],
    });
  });

  it("validates the code pattern and rule only for new codes", () => {
    const bad = { ...valid, ruleId: "", code: "no spaces!" };
    expect(Object.keys(parseCodeForm(form(bad), { isNew: true }).errors).sort()).toEqual(["code", "ruleId"]);
    expect(parseCodeForm(form(bad), { isNew: false }).errors).toEqual({});
  });

  it("rejects an end date before the start date", () => {
    const { errors } = parseCodeForm(form({ ...valid, endsAt: "2026-10-01" }), { isNew: true });
    expect(errors.endsAt).toBeDefined();
  });

  it("keeps only the expected fields of selected customers", () => {
    const customers = JSON.stringify([
      { id: "gid://shopify/Customer/1", displayName: "Ha Viet", email: "a@b.c", extra: "x" },
    ]);
    const { data, errors } = parseCodeForm(form({ ...valid, customers }), { isNew: true });
    expect(errors).toEqual({});
    expect(data.customers).toEqual([{ id: "gid://shopify/Customer/1", displayName: "Ha Viet", email: "a@b.c" }]);
  });

  it("rejects malformed, duplicate or wrong-type selections", () => {
    const dup = JSON.stringify([{ id: "gid://shopify/Customer/1" }, { id: "gid://shopify/Customer/1" }]);
    const wrongType = JSON.stringify([{ id: "gid://shopify/Product/1" }]);
    expect(parseCodeForm(form({ ...valid, customers: "not json" }), { isNew: true }).errors.customers).toBeDefined();
    expect(parseCodeForm(form({ ...valid, customers: dup }), { isNew: true }).errors.customers).toBeDefined();
    expect(parseCodeForm(form({ ...valid, customers: wrongType }), { isNew: true }).errors.customers).toBeDefined();
  });
});
