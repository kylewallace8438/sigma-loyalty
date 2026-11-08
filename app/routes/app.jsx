import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        {/* rel="home": clicking the app name in the admin sidebar opens /app instead of the default "/" */}
        <s-link href="/app" rel="home">
          Home
        </s-link>
        <s-link href="/app/earning">Earning rules</s-link>
        <s-link href="/app/discount-rules">Discount rules</s-link>
        <s-link href="/app/vip-tiers">VIP tiers</s-link>
        <s-link href="/app/gacha">Gacha</s-link>
        <s-link href="/app/gacha-setup">Gacha setup</s-link>
        <s-link href="/app/customers">Customers</s-link>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/plan">Plan</s-link>
        <s-link href="/app/additional">Additional page</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
