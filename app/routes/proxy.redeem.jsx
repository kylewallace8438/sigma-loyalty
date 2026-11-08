import { authenticate } from "../shopify.server";
import { ensureStorefrontCustomer } from "../services/customers/customers.server";
import { RedeemError, redeemReward } from "../services/discounts/redeem.server";

// POST /apps/sigma-loyalty/redeem with a JSON body { ruleId, points? } (points only for rewards where
// the customer chooses how many to spend). Used by the rewards widget. Returns the new discount code.
// Only for logged-in customers; the app proxy signature makes logged_in_customer_id trustworthy.
export const action = async ({ request }) => {
  await authenticate.public.appProxy(request);
  const params = new URL(request.url).searchParams;
  const customerId = params.get("logged_in_customer_id");
  const headers = { "Cache-Control": "no-store" };
  if (!customerId) return Response.json({ ok: false, error: "Sign in to redeem points." }, { status: 401, headers });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid request." }, { status: 400, headers });
  }

  const shop = params.get("shop");
  const customer = await ensureStorefrontCustomer(shop, customerId);
  try {
    const result = await redeemReward(shop, customer, body?.ruleId, { points: body?.points });
    return Response.json({ ok: true, ...result }, { headers });
  } catch (err) {
    if (err instanceof RedeemError) return Response.json({ ok: false, error: err.message }, { status: 422, headers });
    throw err;
  }
};
