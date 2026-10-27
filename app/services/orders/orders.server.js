import db from "../../db.server";

// Discount allocated to a line item by every discount on the order (line-level and order-level).
function lineDiscount(lineItem) {
  return (lineItem.discount_allocations ?? []).reduce((sum, a) => sum + Number(a.amount), 0).toFixed(2);
}

// Maps an orders/* webhook payload (REST shape) to Order columns. Line items keep only what
// points need; prices stay strings so they aren't rounded as floats.
export function orderFromPayload(payload) {
  const fulfilled = payload.fulfillment_status === "fulfilled";
  const lastFulfillment = (payload.fulfillments ?? []).map((f) => f.created_at).sort().at(-1);
  return {
    shopifyOrderId: BigInt(payload.id),
    shopifyCustomerId: BigInt(payload.customer.id),
    name: payload.name,
    currency: payload.currency,
    subtotalPrice: payload.subtotal_price,
    totalDiscounts: payload.total_discounts,
    totalPrice: payload.total_price,
    financialStatus: payload.financial_status ?? null,
    fulfillmentStatus: payload.fulfillment_status ?? null,
    discountCodes: (payload.discount_codes ?? []).map((d) => d.code),
    lineItems: (payload.line_items ?? []).map((li) => ({
      id: li.id,
      productId: li.product_id ?? null,
      variantId: li.variant_id ?? null,
      quantity: li.quantity,
      price: li.price,
      discount: lineDiscount(li),
      giftCard: Boolean(li.gift_card),
    })),
    cancelledAt: payload.cancelled_at ? new Date(payload.cancelled_at) : null,
    fulfilledAt: fulfilled ? new Date(lastFulfillment ?? payload.updated_at) : null,
    shopifyCreatedAt: new Date(payload.created_at),
    shopifyUpdatedAt: new Date(payload.updated_at),
  };
}

// Overwrites the stored order unless it already holds a newer version of it.
function updateIfNewer(shopDomain, data) {
  return db.order.updateMany({
    where: {
      shop: { domain: shopDomain },
      shopifyOrderId: data.shopifyOrderId,
      shopifyUpdatedAt: { lte: data.shopifyUpdatedAt },
    },
    data,
  });
}

/**
 * Creates or updates the order from an orders/* webhook payload. Webhooks can be retried or arrive
 * out of order, so a payload older than the stored row is ignored. Guest orders can't earn points
 * and are not stored.
 * Returns "created", "updated", "stale" or "skipped".
 */
export async function saveOrder(shopDomain, payload) {
  if (!payload.customer) return "skipped";
  const data = orderFromPayload(payload);
  if ((await updateIfNewer(shopDomain, data)).count) return "updated";
  try {
    await db.order.create({
      data: {
        ...data,
        shop: { connectOrCreate: { where: { domain: shopDomain }, create: { domain: shopDomain } } },
      },
    });
    return "created";
  } catch (err) {
    if (err.code !== "P2002") throw err;
    // The row exists: either it is newer than this payload, or a concurrent webhook created it first.
    return (await updateIfNewer(shopDomain, data)).count ? "updated" : "stale";
  }
}
