import { useEffect, useMemo, useRef, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { GachaPreview, TierSwatch } from "../components/GachaPreview";
import { GACHA_TIERS, buildPool, effectiveOdds } from "../services/gacha/tiers";
import { listGachaRules, parseTierForm, saveTiers } from "../services/gacha/gacha.server";

// Gacha setup: put discount rules into rarity tiers and try the spin in a preview.
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { rules: await listGachaRules(session.shop) };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  await saveTiers(session.shop, parseTierForm(await request.formData()));
  return { savedAt: Date.now() };
};

const formatOdds = (percent) => `${Number(percent.toFixed(1))}%`;

export default function Gacha() {
  const { rules } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const formRef = useRef(null);

  const saved = useMemo(() => Object.fromEntries(rules.map((r) => [r.id, r.tier])), [rules]);
  // Tiers as currently picked in the form (saved or not), so the preview follows the selects.
  const [tiers, setTiers] = useState(saved);
  useEffect(() => setTiers(saved), [saved]);

  useEffect(() => {
    if (actionData?.savedAt) shopify.toast.show("Gacha tiers saved");
  }, [actionData, shopify]);

  // React 18 doesn't wire onChange props on web components; listen on the form instead
  // (capture phase, in case the selects' change events don't bubble).
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const onChange = () => {
      const data = new FormData(form);
      setTiers(Object.fromEntries(rules.map((r) => [r.id, String(data.get(`tier-${r.id}`) ?? "")])));
    };
    form.addEventListener("change", onChange, true);
    return () => form.removeEventListener("change", onChange, true);
  }, [rules, actionData]);

  const pool = useMemo(
    () => buildPool(rules.filter((r) => r.active).map((r) => ({ ...r, tier: tiers[r.id] }))),
    [rules, tiers],
  );
  const odds = effectiveOdds(pool);
  const saving = navigation.state === "submitting";

  // Remount after each save so the uncontrolled selects (and the save bar) start from the saved values.
  const formKey = `${JSON.stringify(saved)}-${actionData?.savedAt ?? ""}`;

  return (
    <s-page heading="Gacha" inlineSize="large">
      <s-section heading="Preview">
        <s-stack gap="base">
          <s-paragraph color="subdued">
            Try the spin with the tiers picked below, including unsaved changes. Only active rules
            are in the pool. Nothing is given to anyone.
          </s-paragraph>
          <GachaPreview pool={pool} />
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
            {Object.entries(GACHA_TIERS).map(([tier, { label }]) => (
              <s-box key={tier} padding="base" borderWidth="base" borderRadius="base">
                <s-stack gap="small-200">
                  <s-text>
                    <TierSwatch tier={tier} /> <s-text type="strong">{label}</s-text>
                  </s-text>
                  <s-heading>{pool[tier].length ? formatOdds(odds[tier]) : "—"}</s-heading>
                  <s-text color="subdued">
                    {pool[tier].length
                      ? `${pool[tier].length} active ${pool[tier].length === 1 ? "rule" : "rules"}`
                      : "No active rules, skipped"}
                  </s-text>
                </s-stack>
              </s-box>
            ))}
          </s-grid>
        </s-stack>
      </s-section>

      {rules.length === 0 ? (
        <s-section>
          <s-stack gap="base" alignItems="center" padding="large">
            <s-heading>No discount rules yet</s-heading>
            <s-paragraph>Create discount rules first, then put them into gacha tiers here.</s-paragraph>
            <s-button variant="primary" href="/app/discount-rules/new">
              Create rule
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <Form method="post" ref={formRef} key={formKey} data-save-bar data-discard-confirmation>
          <s-section heading="Rewards by tier" padding="none">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Discount rule</s-table-header>
                <s-table-header listSlot="labeled">Discount</s-table-header>
                <s-table-header format="numeric">Points cost</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header>Tier</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {rules.map((rule) => (
                  <s-table-row key={rule.id}>
                    <s-table-cell>
                      <s-link href={`/app/discount-rules/${rule.id}`}>{rule.title}</s-link>
                    </s-table-cell>
                    <s-table-cell>{rule.value}</s-table-cell>
                    <s-table-cell>{rule.pointsCost}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={rule.active ? "success" : "neutral"}>
                        {rule.active ? "Active" : "Inactive"}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <s-select
                        label={`Tier for ${rule.title}`}
                        labelAccessibilityVisibility="exclusive"
                        name={`tier-${rule.id}`}
                        value={rule.tier}
                      >
                        <s-option value="">Not in gacha</s-option>
                        {Object.entries(GACHA_TIERS).map(([tier, { label }]) => (
                          <s-option key={tier} value={tier}>
                            {label}
                          </s-option>
                        ))}
                      </s-select>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>
          <s-box paddingBlockStart="base">
            <s-stack direction="inline" justifyContent="end">
              <s-button type="submit" variant="primary" loading={saving || undefined}>
                Save
              </s-button>
            </s-stack>
          </s-box>
        </Form>
      )}
    </s-page>
  );
}
