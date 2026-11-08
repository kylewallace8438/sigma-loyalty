import { authenticate } from "../shopify.server";
import { getWidgetData } from "../services/earning/storefront.server";

// GET /apps/sigma-loyalty/points on the storefront, proxied by Shopify to /proxy/points.
// Used by the rewards launcher app embed (extensions/loyalty-widget): the balance, the active ways to
// earn and what the customer has already done. The signature check proves the request came through
// Shopify, so logged_in_customer_id can be trusted (it is empty for visitors who aren't logged in).
export const loader = async ({ request }) => {
  await authenticate.public.appProxy(request);
  const params = new URL(request.url).searchParams;
  const data = await getWidgetData(params.get("shop"), params.get("logged_in_customer_id") || null);
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
};
