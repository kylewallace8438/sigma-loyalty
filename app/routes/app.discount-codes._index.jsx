import { useEffect } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { DISCOUNT_TYPES } from "../services/discount-types";
import { codeStatus, listCodes } from "../services/discount-codes.server";

const STATUS_TONE = { Active: "success", Scheduled: "info", Expired: "neutral" };

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const codes = await listCodes(session.shop);
  const day = (d) => (d ? d.toISOString().slice(0, 10) : null);

  return {
    codes: codes.map((code) => ({
      id: code.id,
      code: code.code,
      rule: code.rule.title,
      type: DISCOUNT_TYPES[code.discountType],
      customers: code.customers.length,
      products: code.products.length,
      startsAt: day(code.startsAt),
      endsAt: day(code.endsAt),
      status: codeStatus(code),
    })),
  };
};

export default function DiscountCodes() {
  const { codes } = useLoaderData();
  const [searchParams] = useSearchParams();
  const shopify = useAppBridge();

  const notice = searchParams.get("notice");
  useEffect(() => {
    if (notice === "saved") shopify.toast.show("Discount code saved");
    if (notice === "deleted") shopify.toast.show("Discount code deleted");
  }, [notice, shopify]);

  return (
    <s-page heading="Discount codes" inlineSize="large">
      <s-button slot="primary-action" variant="primary" href="/app/discount-codes/new">
        Create code
      </s-button>

      {codes.length === 0 ? (
        <s-section>
          <s-stack gap="base" alignItems="center" padding="large">
            <s-heading>Create your first discount code</s-heading>
            <s-paragraph>
              Issue a code from one of your discount rules, limited to the
              customers and products you choose, for the dates you set.
            </s-paragraph>
            <s-button variant="primary" href="/app/discount-codes/new">
              Create code
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section padding="none" accessibilityLabel="Discount codes table">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Code</s-table-header>
              <s-table-header listSlot="labeled">Rule</s-table-header>
              <s-table-header>Customers</s-table-header>
              <s-table-header>Products</s-table-header>
              <s-table-header listSlot="labeled">Valid</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {codes.map((code) => (
                <s-table-row key={code.id}>
                  <s-table-cell>
                    <s-link href={`/app/discount-codes/${code.id}`}>{code.code}</s-link>
                  </s-table-cell>
                  <s-table-cell>
                    {code.rule} ({code.type})
                  </s-table-cell>
                  <s-table-cell>{code.customers ? `${code.customers} selected` : "All customers"}</s-table-cell>
                  <s-table-cell>
                    {code.type === DISCOUNT_TYPES.FREE_SHIPPING
                      ? "Shipping"
                      : code.products
                        ? `${code.products} selected`
                        : "All products"}
                  </s-table-cell>
                  <s-table-cell>
                    {code.startsAt} → {code.endsAt ?? "no end date"}
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_TONE[code.status]}>{code.status}</s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}
