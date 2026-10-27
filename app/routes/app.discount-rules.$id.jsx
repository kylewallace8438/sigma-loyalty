import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { DISCOUNT_TYPES } from "../services/discounts/types";
import {
  deleteRule,
  getRule,
  parseRuleForm,
  saveRule,
  toFormValues,
} from "../services/discounts/rules.server";

// /app/discount-rules/new creates a rule; /app/discount-rules/:id edits one.
// Rules are stored only in the app; nothing is created in Shopify.
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

export default function DiscountRuleForm() {
  const { isNew, values: saved } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();

  // After a failed submit, show what the merchant typed rather than the stored values.
  const values = actionData?.values ?? saved;
  const errors = actionData?.errors ?? {};
  const intent = navigation.formData?.get("intent");
  const saving = navigation.state === "submitting" && intent !== "delete";
  const deleting = navigation.state === "submitting" && intent === "delete";

  // Remount the form after each server response so uncontrolled fields pick up the returned values.
  const formKey = JSON.stringify(values);

  return (
    <s-page heading={isNew ? "Create discount rule" : values.title} inlineSize="small">
      <s-link slot="breadcrumb-actions" href="/app/discount-rules">
        Discount rules
      </s-link>

      <Form method="post" key={formKey} data-save-bar data-discard-confirmation>
        <s-stack gap="base">
          {errors.form && (
            <s-banner tone="critical" heading="The rule wasn't saved">
              {errors.form}
            </s-banner>
          )}

          <s-section heading="Reward">
            <s-stack gap="base">
              <s-text-field
                label="Title"
                name="title"
                value={values.title}
                placeholder="$5 off your next order"
                details="Shown to customers."
                error={errors.title}
                required
              ></s-text-field>
              <s-number-field
                label="Points cost"
                name="pointsCost"
                value={values.pointsCost}
                min={1}
                step={1}
                inputMode="numeric"
                suffix="points"
                details="Points a customer spends to redeem this reward."
                error={errors.pointsCost}
                required
              ></s-number-field>
            </s-stack>
          </s-section>

          <s-section heading="Discount">
            <s-stack gap="base">
              <s-select
                label="Discount type"
                name="discountType"
                value={values.discountType}
                error={errors.discountType}
              >
                {Object.entries(DISCOUNT_TYPES).map(([value, label]) => (
                  <s-option key={value} value={value}>
                    {String(label)}
                  </s-option>
                ))}
              </s-select>
              <s-number-field
                label="Discount value"
                name="discountValue"
                value={values.discountValue}
                min={0}
                step={0.01}
                inputMode="decimal"
                details="Amount in store currency for fixed amount, 1–100 for percentage. Ignored for free shipping."
                error={errors.discountValue}
              ></s-number-field>
              <s-money-field
                label="Minimum order subtotal"
                name="minimumSubtotal"
                value={values.minimumSubtotal}
                min={0}
                details="Optional. Leave empty for no minimum."
                error={errors.minimumSubtotal}
              ></s-money-field>
            </s-stack>
          </s-section>

          <s-section heading="Limits">
            <s-stack gap="base">
              <s-number-field
                label="Total usage limit"
                name="usageLimit"
                value={values.usageLimit}
                min={1}
                step={1}
                inputMode="numeric"
                details="Optional. How many times the discount can be used in total."
                error={errors.usageLimit}
              ></s-number-field>
              <s-checkbox
                label="Limit to one use per customer"
                name="appliesOncePerCustomer"
                value="true"
                checked={values.appliesOncePerCustomer || undefined}
              ></s-checkbox>
              <s-checkbox
                label="Active"
                name="active"
                value="true"
                details="Turn off to retire this reward without deleting it."
                checked={values.active || undefined}
              ></s-checkbox>
            </s-stack>
          </s-section>

          <s-stack direction="inline" gap="base" justifyContent="end">
            <s-button type="submit" variant="primary" loading={saving || undefined}>
              Save
            </s-button>
          </s-stack>
        </s-stack>
      </Form>

      <s-section slot="aside" heading="How rules work">
        <s-stack gap="base">
          <s-paragraph>
            A rule is a reward template: what a customer gets and what it costs in points.
            It doesn&apos;t create anything in Shopify. Exchange points for a discount manually.
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
