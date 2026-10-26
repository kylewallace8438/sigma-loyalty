import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getCustomer } from "../services/customers/customers.server";

// Formatted on the server in UTC so server and client render the same text.
const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const DATE_TIME = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

const numericId = (gid) => gid.split("/").pop();

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) throw new Response("Not found", { status: 404 });
  const customer = await getCustomer(session.shop, id);
  if (!customer) throw new Response("Not found", { status: 404 });

  const history = customer.redeemHistories;
  return {
    name: [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Unnamed customer",
    email: customer.email,
    points: customer.points,
    pointsRedeemed: history.reduce((sum, r) => sum + r.points, 0),
    redemptions: history.length,
    customerSince: customer.shopifyCreatedAt ? DATE.format(customer.shopifyCreatedAt) : null,
    shopifyCustomerId: numericId(customer.shopifyCustomerId),
    history: history.map((r) => ({
      id: r.id,
      date: `${DATE_TIME.format(r.createdAt)} UTC`,
      points: r.points,
      code: r.discountCode,
      shopifyDiscountId: numericId(r.shopifyDiscountId),
    })),
  };
};

export default function CustomerDetail() {
  const c = useLoaderData();

  const metrics = [
    { label: "Points balance", value: c.points.toLocaleString() },
    { label: "Points redeemed", value: c.pointsRedeemed.toLocaleString() },
    { label: "Redemptions", value: c.redemptions.toLocaleString() },
    { label: "Customer since", value: c.customerSince ?? "—" },
  ];

  return (
    <s-page heading={c.name} inlineSize="large">
      <s-link slot="breadcrumb-actions" href="/app/customers">
        Customers
      </s-link>
      <s-button slot="secondary-actions" href={`shopify://admin/customers/${c.shopifyCustomerId}`} target="_top">
        View in Shopify
      </s-button>

      <s-section accessibilityLabel="Customer summary">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(140px, 1fr))" gap="base">
          {metrics.map((m) => (
            <s-stack key={m.label} gap="small-300">
              <s-text color="subdued">{m.label}</s-text>
              <s-heading>{m.value}</s-heading>
            </s-stack>
          ))}
        </s-grid>
      </s-section>

      <s-section heading="Redeem history" padding={c.history.length ? "none" : undefined}>
        {c.history.length === 0 ? (
          <s-paragraph color="subdued">This customer hasn&apos;t redeemed any points yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Discount</s-table-header>
              <s-table-header listSlot="inline" format="numeric">Points used</s-table-header>
              <s-table-header listSlot="labeled">Date</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {c.history.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    {r.code ? (
                      <s-link href={`/app/discount-codes/${r.code.id}`}>{r.code.code}</s-link>
                    ) : (
                      <s-link href={`shopify://admin/discounts/${r.shopifyDiscountId}`} target="_top">
                        Discount {r.shopifyDiscountId}
                      </s-link>
                    )}
                  </s-table-cell>
                  <s-table-cell>{r.points.toLocaleString()}</s-table-cell>
                  <s-table-cell>{r.date}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Contact information">
        {c.email ? (
          <s-link href={`mailto:${c.email}`}>{c.email}</s-link>
        ) : (
          <s-text color="subdued">No email address</s-text>
        )}
      </s-section>
    </s-page>
  );
}
