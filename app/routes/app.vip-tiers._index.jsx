import { useEffect } from "react";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { loadTierProgram, parseProgramForm, saveProgram } from "../services/tiers/program.server";
import { getSettings, pointsLabel } from "../services/settings/settings.server";
import { ENTRY_METHODS, MILESTONES, TIER_ICONS, describeThreshold } from "../services/tiers/icons";

// VIP tiers: program settings and the tier list (always ordered by threshold, as in the original app).
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const [{ program, tiers }, settings] = await Promise.all([loadTierProgram(session.shop), getSettings(session.shop)]);
  return {
    program: {
      enabled: program.enabled,
      entryMethod: program.entryMethod,
      milestone: program.milestone,
      startDate: (program.startDate ?? new Date()).toISOString().slice(0, 10),
    },
    pointsName: pointsLabel(settings),
    tiers: tiers.map((t) => ({
      id: t.id,
      title: t.title,
      icon: t.icon ? TIER_ICONS[t.icon]?.symbol : null,
      threshold: describeThreshold(t.threshold, program.entryMethod, pointsLabel(settings)),
      multiplier: t.multiplier ? Number(t.multiplier) : null,
      isDefault: t.isDefault,
      members: t.members,
    })),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { data, values, errors } = parseProgramForm(await request.formData());
  if (Object.keys(errors).length) return { values, errors };
  await saveProgram(session.shop, data);
  return { savedAt: Date.now() };
};

export default function VipTiers() {
  const { program, tiers, pointsName } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();

  const values = actionData?.values ?? program;
  const errors = actionData?.errors ?? {};
  const saving = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.savedAt) shopify.toast.show("VIP program saved");
  }, [actionData, shopify]);

  useEffect(() => {
    const notice = searchParams.get("notice");
    if (!notice) return;
    shopify.toast.show(notice === "deleted" ? "Tier deleted" : "Tier saved");
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, shopify]);

  return (
    <s-page heading="VIP tiers">
      <s-button slot="primary-action" variant="primary" href="/app/vip-tiers/new">
        Add tier
      </s-button>

      <Form method="post" key={`${JSON.stringify(values)}-${actionData?.savedAt ?? ""}`} data-save-bar data-discard-confirmation>
        <s-section heading="Program">
          <s-stack gap="base">
            {!values.enabled && (
              <s-banner tone="info">The VIP program is off: customers aren&apos;t placed in tiers.</s-banner>
            )}
            <s-switch label="VIP program is on" name="enabled" checked={values.enabled || undefined}></s-switch>
            <s-select
              label="Customers qualify by"
              name="entryMethod"
              value={values.entryMethod}
              details="Changing this deletes every tier except the entry tier and resets everyone's tier."
              error={errors.entryMethod}
            >
              {Object.entries(ENTRY_METHODS).map(([value, label]) => (
                <s-option key={value} value={value}>
                  {label === "Points earned" ? `${pointsName} earned` : label}
                </s-option>
              ))}
            </s-select>
            <s-select label="Counted over" name="milestone" value={values.milestone} error={errors.milestone}>
              {Object.entries(MILESTONES).map(([value, label]) => (
                <s-option key={value} value={value}>
                  {label}
                </s-option>
              ))}
            </s-select>
            <s-date-field
              label="Start date"
              name="startDate"
              value={values.startDate}
              details="Customers are placed in tiers from this date."
              error={errors.startDate}
            ></s-date-field>
            <s-stack direction="inline" justifyContent="end">
              <s-button type="submit" variant="primary" loading={saving || undefined}>
                Save
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      </Form>

      <s-section heading="Tiers" padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Tier</s-table-header>
            <s-table-header listSlot="secondary">Starts at</s-table-header>
            <s-table-header listSlot="inline">Bonus</s-table-header>
            <s-table-header listSlot="labeled" format="numeric">
              Customers
            </s-table-header>
          </s-table-header-row>
          <s-table-body>
            {tiers.map((tier) => (
              <s-table-row key={tier.id} clickDelegate={`tier-${tier.id}`}>
                <s-table-cell>
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    {tier.icon && <s-text>{tier.icon}</s-text>}
                    <s-link id={`tier-${tier.id}`} href={`/app/vip-tiers/${tier.id}`}>
                      {tier.title}
                    </s-link>
                    {tier.isDefault && <s-badge tone="neutral">Entry tier</s-badge>}
                  </s-stack>
                </s-table-cell>
                <s-table-cell>{tier.threshold}</s-table-cell>
                <s-table-cell>{tier.multiplier ? `${tier.multiplier}× order ${pointsName.toLowerCase()}` : "—"}</s-table-cell>
                <s-table-cell>{tier.members.toLocaleString()}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section slot="aside" heading="How tiers work">
        <s-paragraph>
          Customers move up as soon as they reach a tier, and get its entry rewards the first time. They only
          move down after a refund or cancellation, when their tier is deleted, or, for calendar-year programs,
          when the year resets on Dec 31.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
