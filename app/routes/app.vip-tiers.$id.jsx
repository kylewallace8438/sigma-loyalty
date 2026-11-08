import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import {
  deleteTier,
  ensureTiers,
  getProgram,
  getTier,
  parseTierForm,
  saveTier,
  toTierFormValues,
} from "../services/tiers/program.server";
import { resyncCustomers } from "../services/tiers/sync.server";
import { listRules } from "../services/discounts/rules.server";
import { formatDiscountValue } from "../services/discounts/types";
import { ensureShop } from "../services/shops/shops.server";
import { getSettings, pointsLabel } from "../services/settings/settings.server";
import { TIER_ICONS } from "../services/tiers/icons";

// /app/vip-tiers/new creates a tier; /app/vip-tiers/:id edits one.
function parseId(param) {
  if (param === "new") return null;
  const id = Number(param);
  if (!Number.isInteger(id) || id < 1) throw new Response("Not found", { status: 404 });
  return id;
}

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const id = parseId(params.id);
  const shop = await ensureShop(session.shop);
  await ensureTiers(shop.id);
  const tier = id ? await getTier(session.shop, id) : null;
  if (id && !tier) throw new Response("Not found", { status: 404 });
  const [program, rules, settings] = await Promise.all([getProgram(shop.id), listRules(session.shop), getSettings(session.shop)]);
  return {
    isNew: !tier,
    values: toTierFormValues(tier),
    money: program.entryMethod === "MONEY_SPENT",
    pointsName: pointsLabel(settings),
    rules: rules.map((r) => ({ id: String(r.id), title: r.title, value: formatDiscountValue(r), active: r.active })),
  };
};

export const action = async ({ request, params }) => {
  const { session, redirect } = await authenticate.admin(request);
  const id = parseId(params.id);
  const formData = await request.formData();
  const existing = id ? await getTier(session.shop, id) : null;

  if (formData.get("intent") === "delete" && existing) {
    const result = await deleteTier(session.shop, id);
    if (result.errors) return { errors: result.errors };
    // Customers of the deleted tier go to the best tier they still qualify for.
    await resyncCustomers(existing.shopId, result.customerIds);
    return redirect("/app/vip-tiers?notice=deleted");
  }

  const { data, rewardIds, values, errors } = parseTierForm(formData, { isDefault: existing?.isDefault });
  if (Object.keys(errors).length) return { values, errors };
  const result = await saveTier(session.shop, id, data, rewardIds);
  if (result.errors) return { values, errors: result.errors };
  return redirect("/app/vip-tiers?notice=saved");
};

export default function TierForm() {
  const { isNew, values: saved, money, pointsName, rules } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const values = actionData?.values ?? saved;
  const errors = actionData?.errors ?? {};
  const intent = navigation.formData?.get("intent");
  const saving = navigation.state === "submitting" && intent !== "delete";
  const deleting = navigation.state === "submitting" && intent === "delete";

  return (
    <s-page heading={isNew ? "Add tier" : values.title} inlineSize="small">
      <s-link slot="breadcrumb-actions" href="/app/vip-tiers">
        VIP tiers
      </s-link>

      <Form method="post" key={JSON.stringify(values)} data-save-bar data-discard-confirmation>
        <s-stack gap="base">
          {Object.keys(errors).length > 0 && (
            <s-banner tone="critical" heading="The tier wasn't saved">
              {errors.form ?? "Fix the highlighted fields and save again."}
            </s-banner>
          )}

          <s-section heading="Tier">
            <s-stack gap="base">
              <s-text-field label="Name" name="title" value={values.title} maxLength={100} error={errors.title} required></s-text-field>
              <s-select label="Icon" name="icon" value={values.icon} placeholder="No icon" error={errors.icon}>
                {Object.entries(TIER_ICONS).map(([value, { label, symbol }]) => (
                  <s-option key={value} value={value}>
                    {`${symbol} ${label}`}
                  </s-option>
                ))}
              </s-select>
              {values.isDefault ? (
                <s-paragraph color="subdued">This is the entry tier: every customer starts here.</s-paragraph>
              ) : money ? (
                <s-money-field
                  label="Amount spent to reach it"
                  name="threshold"
                  value={values.threshold}
                  min={0.01}
                  error={errors.threshold}
                  required
                ></s-money-field>
              ) : (
                <s-number-field
                  label={`${pointsName} earned to reach it`}
                  name="threshold"
                  value={values.threshold}
                  min={1}
                  step={1}
                  inputMode="numeric"
                  error={errors.threshold}
                  required
                ></s-number-field>
              )}
            </s-stack>
          </s-section>

          <s-section heading="Benefits">
            <s-stack gap="base">
              <s-number-field
                label={`Order ${pointsName.toLowerCase()} multiplier`}
                name="multiplier"
                value={values.multiplier}
                min={1.01}
                step={0.01}
                inputMode="decimal"
                suffix="×"
                details="Optional. For example 1.5 gives 50% extra on the Complete an order rule's points. Needs that rule to be on."
                error={errors.multiplier}
              ></s-number-field>
              <s-text-area
                label="Other benefits"
                name="perks"
                value={values.perks}
                rows={3}
                details="Optional, one per line. Shown to customers; you provide them outside the app."
                error={errors.perks}
              ></s-text-area>
              <s-checkbox
                label="Tag customers in this tier"
                name="tagEnabled"
                checked={values.tagEnabled || undefined}
                details={`Adds the tag "VIP: ${values.title || "tier name"}" in Shopify, and removes it when they leave the tier.`}
              ></s-checkbox>
            </s-stack>
          </s-section>

          <s-section heading="Entry rewards">
            <s-stack gap="small-200">
              <s-paragraph color="subdued">
                Customers get a code of each selected reward the first time they reach this tier. Rewards that are
                only for tiers can be inactive, so customers can&apos;t also redeem them with points.
              </s-paragraph>
              {rules.length === 0 ? (
                <s-text color="subdued">
                  No discount rules yet. <s-link href="/app/discount-rules/new">Create one</s-link>.
                </s-text>
              ) : (
                rules.map((rule) => (
                  <s-checkbox
                    key={rule.id}
                    label={`${rule.title} (${rule.value})${rule.active ? "" : ", inactive"}`}
                    name="rewardIds"
                    value={rule.id}
                    checked={values.rewardIds.includes(rule.id) || undefined}
                  ></s-checkbox>
                ))
              )}
            </s-stack>
          </s-section>

          <s-stack direction="inline" justifyContent="end">
            <s-button type="submit" variant="primary" loading={saving || undefined}>
              Save
            </s-button>
          </s-stack>
        </s-stack>
      </Form>

      {!isNew && !values.isDefault && (
        <s-section slot="aside" heading="Delete tier">
          <s-stack gap="base">
            <s-paragraph>Its customers move to the best tier they still qualify for.</s-paragraph>
            <Form method="post">
              <input type="hidden" name="intent" value="delete" />
              <s-button type="submit" tone="critical" loading={deleting || undefined}>
                Delete tier
              </s-button>
            </Form>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}
