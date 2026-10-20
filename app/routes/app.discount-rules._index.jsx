import { useEffect, useRef } from "react";
import { Form, useLoaderData, useNavigation, useSearchParams, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { DISCOUNT_TYPES } from "../services/discount-types";
import { countRules, listRules, parseRuleFilters } from "../services/discount-rules.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const filters = parseRuleFilters(new URL(request.url).searchParams);
  const [rules, total] = await Promise.all([listRules(session.shop, filters), countRules(session.shop)]);

  return {
    filters,
    total,
    rules: rules.map((rule) => ({
      id: rule.id,
      title: rule.title,
      pointsCost: rule.pointsCost,
      type: DISCOUNT_TYPES[rule.discountType],
      value: formatValue(rule),
      active: rule.active,
    })),
  };
};

function formatValue(rule) {
  if (rule.discountType === "FREE_SHIPPING") return "Free shipping";
  if (rule.discountType === "PERCENTAGE") return `${Number(rule.discountValue)}% off`;
  return `${Number(rule.discountValue).toFixed(2)} off`;
}

const SEARCH_DEBOUNCE_MS = 300;

export default function DiscountRules() {
  const { rules, total, filters } = useLoaderData();
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();

  const formRef = useRef(null);
  const searchRef = useRef(null);
  const statusRef = useRef(null);
  const typeRef = useRef(null);

  const notice = searchParams.get("notice");
  useEffect(() => {
    if (notice === "saved") shopify.toast.show("Discount rule saved");
    if (notice === "deleted") shopify.toast.show("Discount rule deleted");
  }, [notice, shopify]);

  // React 18 doesn't wire onInput/onChange props on web components, so listen directly.
  // Search submits after typing pauses; the selects submit immediately.
  useEffect(() => {
    const apply = () => submit(formRef.current, { replace: true });
    let timer = 0;
    const onSearch = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(apply, SEARCH_DEBOUNCE_MS);
    };
    const search = searchRef.current;
    const selects = [statusRef.current, typeRef.current];
    search?.addEventListener("input", onSearch);
    selects.forEach((el) => el?.addEventListener("change", apply));
    return () => {
      window.clearTimeout(timer);
      search?.removeEventListener("input", onSearch);
      selects.forEach((el) => el?.removeEventListener("change", apply));
    };
  }, [submit, total]);

  const filtered = Boolean(filters.query || filters.status || filters.type);
  const loading = navigation.state === "loading" && navigation.location?.pathname === "/app/discount-rules";

  const clearFilters = () => {
    if (searchRef.current) searchRef.current.value = "";
    if (statusRef.current) statusRef.current.value = "";
    if (typeRef.current) typeRef.current.value = "";
    submit(formRef.current, { replace: true });
  };

  return (
    <s-page heading="Discount rules">
      <s-button slot="primary-action" variant="primary" href="/app/discount-rules/new">
        Create rule
      </s-button>

      {total === 0 ? (
        <s-section>
          <s-stack gap="base" alignItems="center" padding="large">
            <s-heading>Create your first discount rule</s-heading>
            <s-paragraph>
              Discount rules are the rewards customers can redeem with their
              points. Issue discount codes from a rule on the Discount codes page.
            </s-paragraph>
            <s-button variant="primary" href="/app/discount-rules/new">
              Create rule
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section padding="none" accessibilityLabel="Discount rules table">
          <s-table loading={loading || undefined}>
            <Form method="get" ref={formRef} slot="filters">
              <s-grid gridTemplateColumns="1fr auto auto auto" gap="small-200" alignItems="center">
                <s-text-field
                  ref={searchRef}
                  label="Search discount rules"
                  labelAccessibilityVisibility="exclusive"
                  name="q"
                  icon="search"
                  placeholder="Search by title"
                  value={filters.query}
                  autocomplete="off"
                ></s-text-field>
                <s-select
                  ref={statusRef}
                  label="Status"
                  labelAccessibilityVisibility="exclusive"
                  name="status"
                  value={filters.status}
                >
                  <s-option value="">All statuses</s-option>
                  <s-option value="active">Active</s-option>
                  <s-option value="inactive">Inactive</s-option>
                </s-select>
                <s-select
                  ref={typeRef}
                  label="Discount type"
                  labelAccessibilityVisibility="exclusive"
                  name="type"
                  value={filters.type}
                >
                  <s-option value="">All types</s-option>
                  {Object.entries(DISCOUNT_TYPES).map(([value, label]) => (
                    <s-option key={value} value={value}>
                      {String(label)}
                    </s-option>
                  ))}
                </s-select>
                <s-button variant="tertiary" onClick={clearFilters} disabled={!filtered || undefined}>
                  Clear
                </s-button>
              </s-grid>
            </Form>

            <s-table-header-row>
              <s-table-header listSlot="primary">Title</s-table-header>
              <s-table-header format="numeric">Points cost</s-table-header>
              <s-table-header listSlot="labeled">Discount</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rules.map((rule) => (
                <s-table-row key={rule.id}>
                  <s-table-cell>
                    <s-link href={`/app/discount-rules/${rule.id}`}>{rule.title}</s-link>
                  </s-table-cell>
                  <s-table-cell>{rule.pointsCost}</s-table-cell>
                  <s-table-cell>
                    {rule.value} ({rule.type})
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={rule.active ? "success" : "neutral"}>
                      {rule.active ? "Active" : "Inactive"}
                    </s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>

          {rules.length === 0 && (
            <s-box padding="large">
              <s-stack gap="small" alignItems="center">
                <s-heading>No discount rules found</s-heading>
                <s-paragraph color="subdued">Try changing the search or filters.</s-paragraph>
                <s-button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </s-button>
              </s-stack>
            </s-box>
          )}
        </s-section>
      )}
    </s-page>
  );
}
