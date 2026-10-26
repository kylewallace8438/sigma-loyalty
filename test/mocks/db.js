import { beforeEach, vi } from "vitest";

const MODELS = ["shop", "customer", "redeemHistory", "discountRule", "discountCode"];
const METHODS = ["findMany", "findFirst", "findUnique", "count", "create", "update", "upsert", "delete", "deleteMany", "updateMany"];

/** Prisma client stand-in: every model method is a vi.fn() (reset before each test). */
export const db = {};
for (const model of MODELS) {
  db[model] = Object.fromEntries(METHODS.map((m) => [m, vi.fn()]));
}
// Interactive transactions get the same fake client; array transactions resolve each promise.
db.$transaction = vi.fn((arg) => (typeof arg === "function" ? arg(db) : Promise.all(arg)));

beforeEach(() => {
  for (const model of MODELS) for (const m of METHODS) db[model][m].mockReset();
});
