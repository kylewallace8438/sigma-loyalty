import { useCallback, useEffect, useRef, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { DISCOUNT_TYPES, SPEND_MODES } from "../services/discounts/types";
import {
  deleteRule,
  getRule,
  parseRuleForm,
  saveRule,
  toFormValues,
} from "../services/discounts/rules.server";
import { ResourceSelection, pickResources } from "../components/ResourceSelection";

// /app/discount-rules/new creates a rule; /app/discount-rules/:id edits one.
// A rule is a reward customers redeem points for; each redemption creates a one-customer Shopify code.
function parseId(param) {
  if (param === "new") return null;
  const id = Number(param);
  if (!Number.isInteger(id) || id < 1) throw new Response("Not found", { status: 404 });
  return id;
}

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const id = parseId(params.id);
  const rule = id ? await getRule(session.shop, id) : null;
  if (id && !rule) throw new Response("Not found", { status: 404 });

  return {
    isNew: !rule,
    values: toFormValues(rule),
  };
};

export const action = async ({ request, params }) => {
  const { session, redirect } = await authenticate.admin(request);
  const id = parseId(params.id);
  const formData = await request.formData();

  if (formData.get("intent") === "delete" && id) {
    const result = await deleteRule(session.shop, id);
    if (result.errors) return { errors: result.errors };
    return redirect("/app/discount-rules?notice=deleted");
  }

  const { data, values, errors } = parseRuleForm(formData);
  if (Object.keys(errors).length) return { values, errors };

  const result = await saveRule(session.shop, id, data);
  if (result.errors) return { values, errors: result.errors };

  return redirect("/app/discount-rules?notice=saved");
};

// The form's fields as one string, to tell whether anything changed since it was loaded.
const snapshot = (form) => JSON.stringify([...new FormData(form).entries()]);

const VALUE_LABELS = {
  FIXED_AMOUNT: "Amount off",
  PERCENTAGE: "Percentage off",
  FREE_PRODUCT: "Amount off the product",
};
const VALUE_DETAILS = {
  FIXED_AMOUNT: "In store currency.",
  PERCENTAGE: "From 1 to 100.",
  FREE_PRODUCT: "Usually the product's price. Taken off once, however many the customer buys.",
};

export default function DiscountRuleForm() {
  const { isNew, values: saved } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const formRef = useRef(null);

  // After a failed submit, start from what the merchant sent rather than the stored values.
  const initial = actionData?.values ?? saved;
  const errors = actionData?.errors ?? {};
  const [discountType, setDiscountType] = useState(initial.discountType);
  const [spendMode, setSpendMode] = useState(initial.spendMode);
  const [collections, setCollections] = useState(initial.collections);
  const [product, setProduct] = useState(initial.product);
  // Bumped to remount the form (discard), so its uncontrolled fields show `initial` again.
  const [formVersion, setFormVersion] = useState(0);
  const [baseline, setBaseline] = useState(null);
  const [current, setCurrent] = useState(null);

  const reset = useCallback(() => {
    setDiscountType(initial.discountType);
    setSpendMode(initial.spendMode);
    setCollections(initial.collections);
    setProduct(initial.product);
    setBaseline(null);
    setFormVersion((v) => v + 1);
  }, [initial]);
  useEffect(reset, [reset]);

  // React 18 doesn't wire onChange props on web components; listen on the form instead.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const onChange = () => {
      const data = new FormData(form);
      setDiscountType(String(data.get("discountType") ?? ""));
      setSpendMode(String(data.get("spendMode") ?? SPEND_MODES.FIXED));
      setCurrent(snapshot(form));
    };
    for (const event of ["change", "input"]) form.addEventListener(event, onChange, true);
    return () => {
      for (const event of ["change", "input"]) form.removeEventListener(event, onChange, true);
    };
  }, [formVersion]);

  // The hidden selection fields change with state, not events: re-read the form after each render.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const now = snapshot(form);
    setCurrent(now);
    setBaseline((b) => b ?? now);
  }, [formVersion, collections, product, discountType, spendMode]);

  const dirty = isNew || (baseline !== null && current !== null && current !== baseline);
  const intent = navigation.formData?.get("intent");
  const saving = navigation.state === "submitting" && intent !== "delete";
  const deleting = navigation.state === "submitting" && intent === "delete";
  const save = () => submit(formRef.current, { method: "post" });

  const isFixed = discountType === "FIXED_AMOUNT";
  const scoped = isFixed || discountType === "PERCENTAGE";
  const increment = isFixed && spendMode === SPEND_MODES.INCREMENT;

  return (
    <s-page heading={isNew ? "Create discount rule" : initial.title} inlineSize="small">
      <s-link slot="breadcrumb-actions" href="/app/discount-rules">
        Discount rules
      </s-link>
      <SaveBar id="discount-rule-save-bar" open={dirty || Boolean(actionData?.errors)}>
        <button variant="primary" onClick={save} loading={saving ? "" : undefined}>
          Save
        </button>
        <button onClick={reset}>Discard</button>
      </SaveBar>

      <form
        ref={formRef}
        key={formVersion}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <s-stack gap="base">
          {Object.keys(errors).length > 0 && (
            <s-banner tone="critical" heading="The rule wasn't saved">
              {errors.form ?? "Fix the highlighted fields and save again."}
            </s-banner>
          )}

          <s-section heading="Reward">
            <s-stack gap="base">
              <s-text-field
                label="Title"
                name="title"
                value={initial.title}
                placeholder="$5 off your next order"
                details="Shown to customers in the rewards widget."
                error={errors.title}
                required
              ></s-text-field>
              <s-select label="Discount type" name="discountType" value={initial.discountType} error={errors.discountType}>
                {Object.entries(DISCOUNT_TYPES).map(([value, label]) => (
                  <s-option key={value} value={value}>
                    {String(label)}
                  </s-option>
                ))}
              </s-select>
              {discountType !== "FREE_SHIPPING" && (
                <s-number-field
                  label={VALUE_LABELS[discountType] ?? "Discount value"}
                  name="discountValue"
                  value={initial.discountValue}
                  min={0}
                  max={discountType === "PERCENTAGE" ? 100 : undefined}
                  step={0.01}
                  inputMode="decimal"
                  suffix={discountType === "PERCENTAGE" ? "%" : undefined}
                  details={increment ? "For each points cost spent." : VALUE_DETAILS[discountType]}
                  error={errors.discountValue}
                  required
                ></s-number-field>
              )}
              {discountType === "FREE_PRODUCT" && (
                <>
                  <ResourceSelection
                    label="Product"
                    items={product ? [product] : []}
                    onPick={async () => {
                      const picked = await pickResources(shopify, "product", product ? [product] : [], { multiple: false });
                      if (picked) setProduct(picked[0] ?? null);
                    }}
                    onRemove={() => setProduct(null)}
                    error={errors.product}
                  />
                </>
              )}
              <input type="hidden" name="product" value={JSON.stringify(product ? [product] : [])} />
              {discountType === "FREE_SHIPPING" && (
                <s-money-field
                  label="Maximum shipping rate"
                  name="maxShippingFee"
                  value={initial.maxShippingFee}
                  min={0}
                  details="Optional. Only shipping rates up to this amount are free."
                  error={errors.maxShippingFee}
                ></s-money-field>
              )}
            </s-stack>
          </s-section>

          <s-section heading="Points">
            <s-stack gap="base">
              <s-number-field
                label="Points cost"
                name="pointsCost"
                value={initial.pointsCost}
                min={1}
                step={1}
                inputMode="numeric"
                suffix="points"
                details={increment ? "Customers spend this many points (or a multiple) for each discount value." : "Points a customer spends to redeem this reward."}
                error={errors.pointsCost}
                required
              ></s-number-field>
              {isFixed && (
                <s-choice-list name="spendMode" label="How customers spend points" values={[initial.spendMode]} error={errors.spendMode}>
                  <s-choice value={SPEND_MODES.FIXED}>A fixed cost for a fixed amount off</s-choice>
                  <s-choice value={SPEND_MODES.INCREMENT}>Customers choose how many points to spend</s-choice>
                </s-choice-list>
              )}
              {increment && (
                <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                  <s-number-field
                    label="Minimum points"
                    name="minPoints"
                    value={initial.minPoints}
                    min={1}
                    step={1}
                    inputMode="numeric"
                    details="Optional."
                    error={errors.minPoints}
                  ></s-number-field>
                  <s-number-field
                    label="Maximum points"
                    name="maxPoints"
                    value={initial.maxPoints}
                    min={1}
                    step={1}
                    inputMode="numeric"
                    details="Optional."
                    error={errors.maxPoints}
                  ></s-number-field>
                </s-grid>
              )}
            </s-stack>
          </s-section>

          <s-section heading="Conditions">
            <s-stack gap="base">
              <s-money-field
                label="Minimum order subtotal"
                name="minimumSubtotal"
                value={initial.minimumSubtotal}
                min={0}
                details="Optional. Leave empty for no minimum."
                error={errors.minimumSubtotal}
              ></s-money-field>
              {scoped && (
                <ResourceSelection
                  label="Only for these collections (optional, empty = whole order)"
                  items={collections}
                  onPick={async () => {
                    const picked = await pickResources(shopify, "collection", collections);
                    if (picked) setCollections(picked);
                  }}
                  onRemove={(id) => setCollections((list) => list.filter((c) => c.id !== id))}
                  error={errors.collections}
                />
              )}
              <input type="hidden" name="collections" value={JSON.stringify(collections)} />
              <s-number-field
                label="Code expires after"
                name="expiresInDays"
                value={initial.expiresInDays}
                min={1}
                max={3650}
                step={1}
                inputMode="numeric"
                suffix="days"
                details="Optional. Leave empty for codes that never expire."
                error={errors.expiresInDays}
              ></s-number-field>
            </s-stack>
          </s-section>

          <s-section heading="Combinations">
            <s-stack gap="small-200">
              <s-paragraph color="subdued">The customer&apos;s code can be combined with:</s-paragraph>
              <s-checkbox label="Order discounts" name="combinesWithOrder" checked={initial.combinesWithOrder || undefined}></s-checkbox>
              <s-checkbox label="Product discounts" name="combinesWithProduct" checked={initial.combinesWithProduct || undefined}></s-checkbox>
              {discountType !== "FREE_SHIPPING" && (
                <s-checkbox
                  label="Shipping discounts"
                  name="combinesWithShipping"
                  checked={initial.combinesWithShipping || undefined}
                ></s-checkbox>
              )}
            </s-stack>
          </s-section>

          <s-section heading="Limits">
            <s-stack gap="base">
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-number-field
                  label="Total redemptions"
                  name="usageLimit"
                  value={initial.usageLimit}
                  min={1}
                  step={1}
                  inputMode="numeric"
                  details="Optional, across all customers."
                  error={errors.usageLimit}
                ></s-number-field>
                <s-number-field
                  label="Redemptions per customer"
                  name="perCustomerLimit"
                  value={initial.perCustomerLimit}
                  min={1}
                  step={1}
                  inputMode="numeric"
                  details="Optional."
                  error={errors.perCustomerLimit}
                ></s-number-field>
              </s-grid>
              <s-checkbox
                label="Limit each code to one use per customer"
                name="appliesOncePerCustomer"
                checked={initial.appliesOncePerCustomer || undefined}
              ></s-checkbox>
              <s-checkbox
                label="Active"
                name="active"
                details="Customers can only redeem active rules. Turn off to retire a reward without deleting it."
                checked={initial.active || undefined}
              ></s-checkbox>
            </s-stack>
          </s-section>
        </s-stack>
      </form>

      <s-section slot="aside" heading="How rewards work">
        <s-stack gap="base">
          <s-paragraph>
            Customers redeem points for this reward in the rewards widget. Each redemption creates a discount
            code in Shopify that only that customer can use, once. If the order is refunded or cancelled, the
            points are given back.
          </s-paragraph>
          {!isNew && (
            <Form method="post">
              <input type="hidden" name="intent" value="delete" />
              <s-button type="submit" tone="critical" loading={deleting || undefined}>
                Delete rule
              </s-button>
            </Form>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
