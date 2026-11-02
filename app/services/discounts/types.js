// Shared by server code and route components (no `.server` suffix so it can reach the browser bundle).
export const DISCOUNT_TYPES = {
  FIXED_AMOUNT: "Fixed amount off",
  PERCENTAGE: "Percentage off",
  FREE_SHIPPING: "Free shipping",
};

/** "10% off", "5.00 off" or "Free shipping" for a rule (discountValue may be a Prisma Decimal). */
export function formatDiscountValue({ discountType, discountValue }) {
  if (discountType === "FREE_SHIPPING") return "Free shipping";
  if (discountType === "PERCENTAGE") return `${Number(discountValue)}% off`;
  return `${Number(discountValue).toFixed(2)} off`;
}
