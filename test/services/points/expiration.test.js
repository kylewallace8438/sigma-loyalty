import { describe, expect, it } from "vitest";
import { db } from "../../mocks/db";
import { expireDuePoints } from "../../../app/services/points/expiration.server";

const now = new Date("2026-11-09T00:00:00Z");
const due = (over = {}) => ({ id: 3, shopId: 7, points: 120, pointsExpireAt: new Date("2026-11-01"), shop: { domain: "a.myshopify.com" }, ...over });

describe("expireDuePoints", () => {
  it("expires the whole balance with a ledger row and clears the date", async () => {
    db.customer.findMany.mockResolvedValue([due()]);
    db.storeSettings.findFirst.mockResolvedValue({ pointExpirationEnabled: true, pointExpirationMonths: 6 });
    db.customer.findFirst.mockResolvedValue(due());
    db.customer.updateMany.mockResolvedValue({ count: 1 });

    expect(await expireDuePoints(now)).toBe(1);
    expect(db.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 3, points: { gte: 120 } },
      data: { points: { increment: -120 }, pointsEarned: { increment: 0 }, pointsExpireAt: null },
    });
    expect(db.pointHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "EXPIRED", points: -120, reason: "Points expired" }),
    });
  });

  it("only clears the date when the shop turned expiration off or the balance is empty", async () => {
    db.customer.findMany.mockResolvedValue([due(), due({ id: 4, shopId: 8, points: 0, shop: { domain: "b" } })]);
    db.storeSettings.findFirst.mockImplementation(async ({ where }) =>
      where.shop.domain === "a.myshopify.com" ? { pointExpirationEnabled: false } : { pointExpirationEnabled: true },
    );
    db.customer.findFirst.mockImplementation(async ({ where }) => (where.id === 3 ? due() : due({ id: 4, points: 0 })));

    expect(await expireDuePoints(now)).toBe(0);
    expect(db.pointHistory.create).not.toHaveBeenCalled();
    expect(db.customer.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { pointsExpireAt: null } });
    expect(db.customer.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { pointsExpireAt: null } });
  });

  it("skips a customer who earned since the batch was read", async () => {
    db.customer.findMany.mockResolvedValue([due()]);
    db.storeSettings.findFirst.mockResolvedValue({ pointExpirationEnabled: true, pointExpirationMonths: 6 });
    db.customer.findFirst.mockResolvedValue(null);

    expect(await expireDuePoints(now)).toBe(0);
    expect(db.customer.updateMany).not.toHaveBeenCalled();
  });
});
