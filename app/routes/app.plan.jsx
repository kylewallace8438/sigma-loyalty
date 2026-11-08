import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../services/shops/shops.server";
import { planSummary } from "../services/billing/plan.server";

const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

// The shop's plan. Only the Free plan exists for now: every shop is on it and nothing is charged.
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const plan = await planSummary(shop.id);
  return {
    ...plan,
    since: DATE.format(plan.since),
    features: plan.features.map((f) => ({ ...f, remaining: Number.isFinite(f.remaining) ? f.remaining : null })),
  };
};

export default function Plan() {
  const plan = useLoaderData();
  return (
    <s-page heading="Plan" inlineSize="small">
      <s-section>
        <s-stack gap="small-200">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-heading>{plan.name}</s-heading>
            <s-badge tone="success">Current plan</s-badge>
          </s-stack>
          <s-text>{plan.price > 0 ? `$${plan.price.toFixed(2)}` : "Free"}</s-text>
          {plan.description && <s-paragraph color="subdued">{plan.description}</s-paragraph>}
          <s-text color="subdued">Since {plan.since}</s-text>
        </s-stack>
      </s-section>

      <s-section heading="Included" padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Feature</s-table-header>
            <s-table-header listSlot="inline">Included</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {plan.features.map((f) => (
              <s-table-row key={f.code}>
                <s-table-cell>{f.label}</s-table-cell>
                <s-table-cell>
                  {!f.on ? (
                    <s-badge tone="neutral">Not included</s-badge>
                  ) : f.limit ? (
                    <s-text>{`${f.remaining?.toLocaleString() ?? 0} of ${f.limit.toLocaleString()} left`}</s-text>
                  ) : (
                    <s-badge tone="success" icon="check">
                      {f.code === "orders.monthly_limit" ? "Unlimited" : "Included"}
                    </s-badge>
                  )}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}
