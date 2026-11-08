import db from "../../db.server";
import logger from "../../logger.server";

// Every change to a balance goes through applyPoints, so Customer.points always equals the sum of
// the customer's PointHistory rows.

export const MAX_ADJUSTMENT = 1_000_000;

export class InsufficientPointsError extends Error {
  constructor() {
    super("The customer doesn't have enough points.");
  }
}

/**
 * Changes a customer's balance by `points` (signed) and logs it in the ledger. Must run inside a
 * transaction: pass the transaction client as `tx`. `earned` is added to the lifetime pointsEarned
 * (default: the points when positive, so spending never lowers it). A deduction larger than the
 * balance throws InsufficientPointsError.
 * Optional: `earningType` and `shopifyOrderId` are stored on the row; `dedupeKey` makes a second row
 * with the same key for this customer fail with Prisma's P2002 (rolling back the transaction);
 * `expiresAt` sets Customer.pointsExpireAt (a Date, or null to clear it; undefined leaves it).
 * Returns the ledger row.
 */
export async function applyPoints(
  tx,
  {
    shopId,
    customerId,
    type,
    points,
    reason,
    earned = Math.max(points, 0),
    earningType = null,
    shopifyOrderId = null,
    dedupeKey = null,
    expiresAt,
  },
) {
  // Conditional update, so two deductions running at once can't take the balance below zero.
  const { count } = await tx.customer.updateMany({
    where: { id: customerId, ...(points < 0 && { points: { gte: -points } }) },
    data: {
      points: { increment: points },
      pointsEarned: { increment: earned },
      ...(expiresAt !== undefined && { pointsExpireAt: expiresAt }),
    },
  });
  if (!count) throw new InsufficientPointsError();
  return tx.pointHistory.create({
    data: { shopId, customerId, type, points, reason: reason.slice(0, 255), earningType, shopifyOrderId, dedupeKey },
  });
}

/**
 * When a balance touched now should expire, per the shop's settings: a Date, or undefined when
 * expiration is off (the stored date is left alone).
 */
export function expiryFrom(settings, now = new Date()) {
  if (!settings.pointExpirationEnabled || !settings.pointExpirationMonths) return undefined;
  const date = new Date(now);
  date.setMonth(date.getMonth() + settings.pointExpirationMonths);
  return date;
}

/** Reads the "Adjust points" form: { points (signed whole number), reason }. Returns { data, values, errors }. */
export function parseAdjustForm(formData) {
  const values = {
    points: String(formData.get("points") ?? "").trim(),
    reason: String(formData.get("reason") ?? "").trim(),
  };
  const errors = {};
  const points = Number(values.points);
  if (!Number.isInteger(points) || points === 0 || Math.abs(points) > MAX_ADJUSTMENT) {
    errors.points = `Enter a whole number other than 0, up to ${MAX_ADJUSTMENT.toLocaleString("en-US")} either way. Use a minus sign to remove points.`;
  }
  if (!values.reason) errors.reason = "Enter a reason. The customer may see it in their history.";
  else if (values.reason.length > 255) errors.reason = "Use 255 characters or fewer.";
  return { data: { points, reason: values.reason }, values, errors };
}

/**
 * Adds or removes points by hand (merchant "Adjust points"). `customer` is the shop's customer row.
 * Returns {} or { errors } when removing more than the balance.
 */
export async function adjustPoints(customer, { points, reason }) {
  try {
    await db.$transaction((tx) =>
      applyPoints(tx, { shopId: customer.shopId, customerId: customer.id, type: "ADJUST", points, reason }),
    );
  } catch (err) {
    if (!(err instanceof InsufficientPointsError)) throw err;
    return { errors: { points: `This customer has only ${customer.points.toLocaleString("en-US")} points to remove.` } };
  }
  logger.info({ shopId: customer.shopId, customerId: customer.id, points }, "Points adjusted");
  return {};
}

/** The customer's ledger, newest first, `take` rows from `skip`, plus the total row count. */
export async function listPointHistory(customerId, { skip = 0, take = 50 } = {}) {
  const [rows, total] = await Promise.all([
    db.pointHistory.findMany({ where: { customerId }, orderBy: { id: "desc" }, skip, take }),
    db.pointHistory.count({ where: { customerId } }),
  ]);
  return { rows, total };
}
