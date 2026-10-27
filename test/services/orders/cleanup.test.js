import { describe, expect, it } from "vitest";
import { db } from "../../mocks/db";
import { deleteOldOrders } from "../../../app/services/orders/cleanup.server";

const now = new Date("2026-10-27T00:00:00Z");
const ids = (from, n) => Array.from({ length: n }, (_, i) => ({ id: from + i }));

describe("deleteOldOrders", () => {
  it("deletes orders created before the retention cutoff, across all shops", async () => {
    db.order.findMany.mockResolvedValueOnce(ids(1, 3));
    db.order.deleteMany.mockResolvedValue({ count: 3 });

    expect(await deleteOldOrders(30, now)).toBe(3);

    expect(db.order.findMany.mock.calls[0][0]).toMatchObject({
      where: { shopifyCreatedAt: { lt: new Date("2026-09-27T00:00:00Z") } },
      take: 5000,
    });
    expect(db.order.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [1, 2, 3] } } });
  });

  it("keeps deleting in batches of 5000 until a batch comes back short", async () => {
    db.order.findMany.mockResolvedValueOnce(ids(1, 5000)).mockResolvedValueOnce(ids(5001, 10));
    db.order.deleteMany.mockResolvedValueOnce({ count: 5000 }).mockResolvedValueOnce({ count: 10 });

    expect(await deleteOldOrders(30, now)).toBe(5010);
    expect(db.order.findMany).toHaveBeenCalledTimes(2);
  });

  it("does nothing when no order is old enough", async () => {
    db.order.findMany.mockResolvedValueOnce([]);

    expect(await deleteOldOrders(30, now)).toBe(0);
    expect(db.order.deleteMany).not.toHaveBeenCalled();
  });
});
