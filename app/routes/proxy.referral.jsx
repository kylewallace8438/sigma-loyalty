import { authenticate } from "../shopify.server";
import { createReferralToken } from "../services/earning/referral.server";

// GET /apps/sigma-loyalty/referral?code=... when a visitor opens a referral link. Returns a signed,
// timestamped token the widget keeps until the visitor has an account and is logged in
// (then sent to /earn with action "referral"). See app/services/earning/referral.server.js.
export const loader = async ({ request }) => {
  await authenticate.public.appProxy(request);
  const params = new URL(request.url).searchParams;
  const token = await createReferralToken(params.get("shop"), params.get("code"));
  return Response.json({ token }, { headers: { "Cache-Control": "no-store" } });
};
