import { authenticate } from "../shopify.server";
import { getStorefrontBalance } from "../services/points/points.server";

// GET /apps/sigma-loyalty/points on the storefront, proxied by Shopify to /proxy/points.
// Used by the rewards launcher app embed (extensions/loyalty-widget). The signature check proves the
// request came through Shopify, so logged_in_customer_id can be trusted.
export const loader = async ({ request }) => {
  await authenticate.public.appProxy(request);
  const params = new URL(request.url).searchParams;
  const shop = params.get("shop");
  const customerId = params.get("logged_in_customer_id");
  const headers = { "Cache-Control": "no-store" };

  if (!customerId) return Response.json({ loggedIn: false }, { headers });
  const balance = await getStorefrontBalance(shop, customerId);
  return Response.json({ loggedIn: true, ...balance }, { headers });
};
