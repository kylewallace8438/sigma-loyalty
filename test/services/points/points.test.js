import { describe, expect, it } from "vitest";
import { db } from "../../mocks/db";
import {
  InsufficientPointsError,
  adjustPoints,
  applyPoints,
  listPointHistory,
  parseAdjustForm,
} from "../../../app/services/points/points.server";

const form = (entries) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.append(k, v);
  return data;
};
const customer = { id: 3, shopId: 7, points: 40 };

describe("applyPoints", () => {
  it("adds points, counts them as earned and logs a ledger row", async () => {
    db.customer.updateMany.mockResolvedValue({ count: 1 });
    db.pointHistory.create.mockResolvedValue({ id: 1 });

    await applyPoints(db, { shopId: 7, customerId: 3, type: "EARN", points: 25, reason: "Complete an order" });

    expect(db.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { points: { increment: 25 }, pointsEarned: { increment: 25 } },
    });
    expect(db.pointHistory.create).toHaveBeenCalledWith({
      data: { shopId: 7, customerId: 3, type: "EARN", points: 25, reason: "Complete an order", earningType: null, shopifyOrderId: null, dedupeKey: null },
    });
  });

  it("only takes points from a balance that covers them, without lowering pointsEarned", async () => {
    db.customer.updateMany.mockResolvedValue({ count: 1 });

    await applyPoints(db, { shopId: 7, customerId: 3, type: "REDEEM", points: -30, reason: "Redeemed" });

    expect(db.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 3, points: { gte: 30 } },
      data: { points: { increment: -30 }, pointsEarned: { increment: 0 } },
    });
  });

  it("can lower pointsEarned when told to (refunds)", async () => {
    db.customer.updateMany.mockResolvedValue({ count: 1 });

    await applyPoints(db, { shopId: 7, customerId: 3, type: "REFUND", points: -10, reason: "Refund", earned: -10 });

    expect(db.customer.updateMany.mock.calls[0][0].data.pointsEarned).toEqual({ increment: -10 });
  });

  it("throws InsufficientPointsError and logs nothing when the balance is too low", async () => {
    db.customer.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      applyPoints(db, { shopId: 7, customerId: 3, type: "REDEEM", points: -500, reason: "Redeemed" }),
    ).rejects.toBeInstanceOf(InsufficientPointsError);
    expect(db.pointHistory.create).not.toHaveBeenCalled();
  });
});

describe("parseAdjustForm", () => {
  it("reads a signed whole number and a reason", () => {
    expect(parseAdjustForm(form({ points: "-50", reason: " Goodwill " }))).toEqual({
      data: { points: -50, reason: "Goodwill" },
      values: { points: "-50", reason: "Goodwill" },
      errors: {},
    });
  });

  it("rejects zero, fractions, huge numbers and a missing reason", () => {
    for (const points of ["0", "1.5", "abc", "", "1000001"]) {
      expect(parseAdjustForm(form({ points, reason: "x" })).errors.points).toBeDefined();
    }
    expect(parseAdjustForm(form({ points: "5", reason: "" })).errors.reason).toMatch(/reason/);
    expect(parseAdjustForm(form({ points: "5", reason: "x".repeat(256) })).errors.reason).toMatch(/255/);
  });
});

describe("adjustPoints", () => {
  it("logs an ADJUST row in a transaction", async () => {
    db.customer.updateMany.mockResolvedValue({ count: 1 });

    expect(await adjustPoints(customer, { points: 10, reason: "Gift" })).toEqual({});
    expect(db.pointHistory.create).toHaveBeenCalledWith({
      data: { shopId: 7, customerId: 3, type: "ADJUST", points: 10, reason: "Gift", earningType: null, shopifyOrderId: null, dedupeKey: null },
    });
  });

  it("returns a field error when removing more than the balance", async () => {
    db.customer.updateMany.mockResolvedValue({ count: 0 });

    const result = await adjustPoints(customer, { points: -100, reason: "Oops" });

    expect(result.errors.points).toMatch(/only 40 points/);
  });
});

describe("listPointHistory", () => {
  it("returns a page of the customer's rows, newest first, and the total", async () => {
    db.pointHistory.findMany.mockResolvedValue([{ id: 9 }]);
    db.pointHistory.count.mockResolvedValue(51);

    expect(await listPointHistory(3, { skip: 50, take: 50 })).toEqual({ rows: [{ id: 9 }], total: 51 });
    expect(db.pointHistory.findMany).toHaveBeenCalledWith({
      where: { customerId: 3 },
      orderBy: { id: "desc" },
      skip: 50,
      take: 50,
    });
  });
});
