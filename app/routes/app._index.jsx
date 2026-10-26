import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getOverview } from "../services/overview/overview.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return getOverview(session.shop);
};

// Badge for a week-over-week change: green up, red down, neutral when flat or no data last week.
function trendBadge({ thisWeek, change }) {
  if (change === null) {
    return <s-badge tone="neutral">{thisWeek > 0 ? "New" : "—"}</s-badge>;
  }
  if (change === 0) return <s-badge tone="neutral">0%</s-badge>;
  return change > 0 ? (
    <s-badge tone="success" icon="arrow-up">{change}%</s-badge>
  ) : (
    <s-badge tone="critical" icon="arrow-down">{Math.abs(change)}%</s-badge>
  );
}

function metricCard({ label, value, badge, detail, href }) {
  const body = (
    <s-stack gap="small-200">
      <s-text color="subdued">{label}</s-text>
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-heading>{value}</s-heading>
        {badge}
      </s-stack>
      <s-text color="subdued">{detail}</s-text>
    </s-stack>
  );
  return (
    <s-box key={label} padding="base" borderWidth="base" borderRadius="base">
      {href ? <s-clickable href={href}>{body}</s-clickable> : body}
    </s-box>
  );
}

export default function Index() {
  const { customers, codesUsed, newCustomers } = useLoaderData();

  const cards = [
    {
      label: "Customers",
      value: customers.toLocaleString(),
      detail: "Synced from Shopify",
      href: "/app/customers",
    },
    {
      label: "Codes used this week",
      value: codesUsed.thisWeek.toLocaleString(),
      badge: trendBadge(codesUsed),
      detail: `vs ${codesUsed.lastWeek.toLocaleString()} last week`,
    },
    {
      label: "New customers this week",
      value: newCustomers.thisWeek.toLocaleString(),
      badge: trendBadge(newCustomers),
      detail: `vs ${newCustomers.lastWeek.toLocaleString()} last week`,
    },
    // TODO: placeholder until the fourth metric is decided.
    {
      label: "Points issued this week",
      value: "1,250",
      badge: <s-badge tone="neutral">Sample</s-badge>,
      detail: "Placeholder data",
    },
  ];

  return (
    <s-page heading="Sigma Loyalty">
      <s-section heading="Overview">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
          {cards.map(metricCard)}
        </s-grid>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
