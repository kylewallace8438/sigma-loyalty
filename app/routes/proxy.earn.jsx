import { authenticate } from "../shopify.server";
import { runEarnAction } from "../services/earning/storefront.server";

// POST /apps/sigma-loyalty/earn with a JSON body { action, ... } (see runEarnAction). Used by the
// rewards widget for social actions, newsletter, complete profile, birthday and referrals.
// Only for logged-in customers; the app proxy signature makes logged_in_customer_id trustworthy.
export const action = async ({ request }) => {
  await authenticate.public.appProxy(request);
  const params = new URL(request.url).searchParams;
  const customerId = params.get("logged_in_customer_id");
  const headers = { "Cache-Control": "no-store" };
  if (!customerId) return Response.json({ ok: false, error: "Sign in to earn points." }, { status: 401, headers });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid request." }, { status: 400, headers });
  }
  const result = await runEarnAction(params.get("shop"), customerId, body);
  return Response.json(result, { status: result.ok ? 200 : 422, headers });
};
