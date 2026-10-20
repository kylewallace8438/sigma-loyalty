import { useEffect, useRef, useState } from "react";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { DISCOUNT_TYPES } from "../services/discount-types";
import {
  createCode,
  deleteCode,
  getCode,
  listRuleOptions,
  parseCodeForm,
  toFormValues,
  updateCode,
} from "../services/discount-codes.server";

// /app/discount-codes/new creates a code; /app/discount-codes/:id edits one.
function parseId(param) {
  if (param === "new") return null;
  const id = Number(param);
  if (!Number.isInteger(id) || id < 1) throw new Response("Not found", { status: 404 });
  return id;
}

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const id = parseId(params.id);
  const code = id ? await getCode(session.shop, id) : null;
  if (id && !code) throw new Response("Not found", { status: 404 });

  return {
    isNew: !code,
    values: toFormValues(code),
    rules: code
      ? [{ id: code.rule.id, title: code.rule.title, discountType: code.discountType }]
      : await listRuleOptions(session.shop),
    shopifyDiscountId: code?.shopifyDiscountId ?? null,
  };
};

export const action = async ({ request, params }) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const id = parseId(params.id);
  const formData = await request.formData();

  if (formData.get("intent") === "delete" && id) {
    const result = await deleteCode(admin, session.shop, id);
    if (result.errors) return { errors: result.errors };
    return redirect("/app/discount-codes?notice=deleted");
  }

  const { data, values, errors } = parseCodeForm(formData, { isNew: !id });
  if (Object.keys(errors).length) return { values, errors };

  const result = id
    ? await updateCode(admin, session.shop, id, data)
    : await createCode(admin, session.shop, data);
  if (result.errors) return { values, errors: result.errors };

  return redirect("/app/discount-codes?notice=saved");
};

// Code prefix from the rule title, e.g. "$5 off birthday" -> "5OFFBIRT".
function codePrefix(title) {
  const prefix = (title ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return prefix.length >= 2 ? prefix : "SIGMA";
}

function randomSuffix() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export default function DiscountCodePage() {
  const { isNew, values: saved, rules, shopifyDiscountId } = useLoaderData();
  const actionData = useActionData();
  const values = actionData?.values ?? saved;
  const errors = actionData?.errors ?? {};
  // Remount the form after each server response so uncontrolled fields show the returned values.
  // Selected customers/products live in state and already match what was submitted.
  const formKey = JSON.stringify(values);

  const shopify = useAppBridge();
  const navigation = useNavigation();
  const customerFetcher = useFetcher();

  const [ruleId, setRuleId] = useState(values.ruleId || (rules[0] ? String(rules[0].id) : ""));
  const [customers, setCustomers] = useState(values.customers);
  const [products, setProducts] = useState(values.products);

  const ruleRef = useRef(null);
  const codeRef = useRef(null);
  const searchRef = useRef(null);

  const rule = rules.find((r) => String(r.id) === String(ruleId));
  const freeShipping = rule?.discountType === "FREE_SHIPPING";
  const intent = navigation.formData?.get("intent");
  const saving = navigation.state === "submitting" && intent !== "delete";
  const deleting = navigation.state === "submitting" && intent === "delete";

  // React 18 doesn't wire onChange/onInput on web components, so listen directly.
  useEffect(() => {
    const select = ruleRef.current;
    const search = searchRef.current;
    const onRule = (event) => setRuleId(event.currentTarget.value);
    let timer = 0;
    const onSearch = (event) => {
      const term = event.currentTarget.value;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (term.trim().length >= 2) customerFetcher.load(`/app/customer-search?q=${encodeURIComponent(term)}`);
      }, 300);
    };
    // Enter in the search box would otherwise submit the whole form.
    const onKeyDown = (event) => {
      if (event.key === "Enter") event.preventDefault();
    };
    select?.addEventListener("change", onRule);
    search?.addEventListener("input", onSearch);
    search?.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      select?.removeEventListener("change", onRule);
      search?.removeEventListener("input", onSearch);
      search?.removeEventListener("keydown", onKeyDown);
    };
    // customerFetcher.load is stable for the fetcher's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey]);

  const generateCode = () => {
    if (codeRef.current) codeRef.current.value = `${codePrefix(rule?.title)}-${randomSuffix()}`;
  };

  const addCustomer = (customer) => {
    setCustomers((list) => (list.some((c) => c.id === customer.id) ? list : [...list, customer]));
  };
  const removeCustomer = (id) => setCustomers((list) => list.filter((c) => c.id !== id));

  const pickProducts = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: true,
      filter: { variants: false },
      selectionIds: products.map((p) => ({ id: p.id })),
    });
    if (selected) setProducts(selected.map((p) => ({ id: p.id, title: p.title })));
  };
  const removeProduct = (id) => setProducts((list) => list.filter((p) => p.id !== id));

  const results = customerFetcher.data?.customers ?? [];
  const searchError = customerFetcher.data?.error;

  return (
    <s-page heading={isNew ? "Create discount code" : values.code} inlineSize="small">
      <s-link slot="breadcrumb-actions" href="/app/discount-codes">
        Discount codes
      </s-link>

      <Form method="post" key={formKey}>
        <input type="hidden" name="customers" value={JSON.stringify(customers)} />
        <input type="hidden" name="products" value={JSON.stringify(freeShipping ? [] : products)} />

        <s-stack gap="base">
          {errors.form && (
            <s-banner tone="critical" heading="The discount code wasn't saved">
              {errors.form}
            </s-banner>
          )}

          {isNew && rules.length === 0 && (
            <s-banner tone="warning" heading="No active discount rules">
              Create or activate a <s-link href="/app/discount-rules">discount rule</s-link> first.
            </s-banner>
          )}

          <s-section heading="Discount">
            <s-stack gap="base">
              <s-select
                ref={ruleRef}
                label="Discount rule"
                name="ruleId"
                value={ruleId}
                disabled={!isNew || undefined}
                details={isNew ? "Type, value, minimum and usage limits are copied from this rule." : "The rule can't be changed after the code is created."}
                error={errors.ruleId}
              >
                {rules.map((r) => (
                  <s-option key={r.id} value={String(r.id)}>
                    {`${r.title} (${DISCOUNT_TYPES[r.discountType]})`}
                  </s-option>
                ))}
              </s-select>
              <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="end">
                <s-text-field
                  ref={codeRef}
                  label="Discount code"
                  name="code"
                  value={values.code}
                  placeholder="VIP-7F3K9Q"
                  readOnly={!isNew || undefined}
                  details="Customers enter this at checkout."
                  error={errors.code}
                  required
                ></s-text-field>
                {isNew && (
                  <s-button onClick={generateCode} icon="wand">
                    Generate
                  </s-button>
                )}
              </s-grid>
            </s-stack>
          </s-section>

          <s-section heading="Valid dates">
            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-date-field
                label="Start date"
                name="startsAt"
                value={values.startsAt}
                error={errors.startsAt}
                required
              ></s-date-field>
              <s-date-field
                label="End date"
                name="endsAt"
                value={values.endsAt}
                details="Optional. Leave empty for no end date."
                error={errors.endsAt}
              ></s-date-field>
            </s-grid>
          </s-section>

          <s-section heading="Customers">
            <s-stack gap="base">
              <s-paragraph color="subdued">
                Only the selected customers can use this code. Leave empty to allow all customers.
              </s-paragraph>
              <s-search-field
                ref={searchRef}
                label="Search customers"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search customers by name or email"
              ></s-search-field>
              {searchError && <s-text tone="critical">{searchError}</s-text>}
              {results.length > 0 && (
                <s-box border="base" borderRadius="base" padding="small">
                  <s-stack gap="small">
                    {results.map((c) => {
                      const added = customers.some((s) => s.id === c.id);
                      return (
                        <s-grid key={c.id} gridTemplateColumns="1fr auto" gap="base" alignItems="center">
                          <s-text>
                            {c.displayName}
                            {c.email ? ` · ${c.email}` : ""}
                          </s-text>
                          <s-button
                            variant="tertiary"
                            icon={added ? "check" : "plus"}
                            disabled={added || undefined}
                            onClick={() => addCustomer(c)}
                          >
                            {added ? "Added" : "Add"}
                          </s-button>
                        </s-grid>
                      );
                    })}
                  </s-stack>
                </s-box>
              )}
              {customers.length > 0 ? (
                <s-stack gap="small">
                  <s-text type="strong">{customers.length} selected</s-text>
                  {customers.map((c) => (
                    <s-grid key={c.id} gridTemplateColumns="1fr auto" gap="base" alignItems="center">
                      <s-text>
                        {c.displayName}
                        {c.email ? ` · ${c.email}` : ""}
                      </s-text>
                      <s-button variant="tertiary" icon="x" onClick={() => removeCustomer(c.id)}>
                        Remove
                      </s-button>
                    </s-grid>
                  ))}
                </s-stack>
              ) : (
                <s-badge>All customers</s-badge>
              )}
              {errors.customers && <s-text tone="critical">{errors.customers}</s-text>}
            </s-stack>
          </s-section>

          <s-section heading="Products">
            {freeShipping ? (
              <s-paragraph color="subdued">
                This rule gives free shipping, which applies to the order&apos;s shipping
                rather than to specific products.
              </s-paragraph>
            ) : (
              <s-stack gap="base">
                <s-paragraph color="subdued">
                  The discount applies only to the selected products. Leave empty to apply to all products.
                </s-paragraph>
                <s-button onClick={pickProducts} icon="product">
                  {products.length ? "Change products" : "Select products"}
                </s-button>
                {products.length > 0 ? (
                  <s-stack gap="small">
                    <s-text type="strong">{products.length} selected</s-text>
                    {products.map((p) => (
                      <s-grid key={p.id} gridTemplateColumns="1fr auto" gap="base" alignItems="center">
                        <s-text>{p.title}</s-text>
                        <s-button variant="tertiary" icon="x" onClick={() => removeProduct(p.id)}>
                          Remove
                        </s-button>
                      </s-grid>
                    ))}
                  </s-stack>
                ) : (
                  <s-badge>All products</s-badge>
                )}
                {errors.products && <s-text tone="critical">{errors.products}</s-text>}
              </s-stack>
            )}
          </s-section>

          <s-stack direction="inline" gap="base" justifyContent="end">
            <s-button
              type="submit"
              variant="primary"
              loading={saving || undefined}
              disabled={(isNew && rules.length === 0) || undefined}
            >
              Save
            </s-button>
          </s-stack>
        </s-stack>
      </Form>

      {!isNew && (
        <s-section heading="Shopify discount">
          <s-stack gap="base">
            <s-paragraph>
              Synced as <s-text type="strong">{shopifyDiscountId}</s-text>
            </s-paragraph>
            <Form method="post">
              <input type="hidden" name="intent" value="delete" />
              <s-button type="submit" tone="critical" loading={deleting || undefined}>
                Delete code
              </s-button>
            </Form>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}
