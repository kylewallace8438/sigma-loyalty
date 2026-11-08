// Shared by server code and route components (no `.server` suffix so it can reach the browser bundle).
export const DISCOUNT_TYPES = {
  FIXED_AMOUNT: "Fixed amount off",
  PERCENTAGE: "Percentage off",
  FREE_SHIPPING: "Free shipping",
  FREE_PRODUCT: "Free product",
};

// How customers pay for a reward (see RedeemSpendMode in the Prisma schema).
export const SPEND_MODES = {
  FIXED: "FIXED", // the points cost, once
  INCREMENT: "INCREMENT", // any multiple of the points cost (fixed amount off only)
};

/** "10% off", "5.00 off", "Free shipping" or "Free Hat" for a rule (discountValue may be a Prisma Decimal). */
export function formatDiscountValue({ discountType, discountValue, product }) {
  if (discountType === "FREE_SHIPPING") return "Free shipping";
  if (discountType === "PERCENTAGE") return `${Number(discountValue)}% off`;
  if (discountType === "FREE_PRODUCT") return product?.title ? `Free ${product.title}` : "Free product";
  return `${Number(discountValue).toFixed(2)} off`;
}
