import { useEffect } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getSettings, parseSettingsForm, saveSettings, toSettingsValues } from "../services/settings/settings.server";

// Program settings (the settings the original app shows the merchant).
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { values: toSettingsValues(await getSettings(session.shop)) };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { data, values, errors } = parseSettingsForm(await request.formData());
  if (Object.keys(errors).length) return { values, errors };
  await saveSettings(session.shop, data);
  return { savedAt: Date.now() };
};

export default function Settings() {
  const { values: saved } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  // After a failed submit, show what the merchant typed rather than the stored values.
  const values = actionData?.values ?? saved;
  const errors = actionData?.errors ?? {};
  const saving = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.savedAt) shopify.toast.show("Settings saved");
  }, [actionData, shopify]);

  // Remount after each server response so the uncontrolled fields pick up the returned values.
  const formKey = `${JSON.stringify(values)}-${actionData?.savedAt ?? ""}`;

  return (
    <s-page heading="Settings" inlineSize="small">
      <Form method="post" key={formKey} data-save-bar data-discard-confirmation>
        <s-stack gap="base">
          <s-section heading="Program status">
            <s-stack gap="base">
              {!values.programEnabled && (
                <s-banner tone="warning">
                  The program is off: customers don&apos;t earn or redeem anything until you turn it on.
                </s-banner>
              )}
              <s-switch
                label="Loyalty program is on"
                name="programEnabled"
                checked={values.programEnabled || undefined}
                details="When off, no points are earned or redeemed, and nothing is recorded."
              ></s-switch>
            </s-stack>
          </s-section>

          <s-section heading="Points">
            <s-stack gap="base">
              <s-text-field
                label="Points name"
                name="pointsName"
                value={values.pointsName}
                placeholder="Points"
                maxLength={50}
                details="What customers see, for example Coins or Stars. Leave empty for Points."
                error={errors.pointsName}
              ></s-text-field>
              <s-checkbox
                label="Only reward customers when their orders are fulfilled"
                name="rewardFulfilled"
                checked={values.rewardFulfilled || undefined}
                details="Otherwise order points are given when the order is placed."
              ></s-checkbox>
              <s-checkbox
                label="Include tax in order amounts"
                name="includeTax"
                checked={values.includeTax || undefined}
                details="Used for points per amount spent and for VIP tiers based on spending."
              ></s-checkbox>
            </s-stack>
          </s-section>

          <s-section heading="Point expiration">
            <s-stack gap="base">
              <s-checkbox
                label="Expire points after a period of inactivity"
                name="pointExpirationEnabled"
                checked={values.pointExpirationEnabled || undefined}
                details="Each time a customer earns or redeems, the period starts again. When it runs out, their whole balance expires."
              ></s-checkbox>
              <s-number-field
                label="Inactivity period"
                name="pointExpirationMonths"
                value={values.pointExpirationMonths}
                min={1}
                max={120}
                step={1}
                suffix="months"
                details="Only used when expiration is on."
                error={errors.pointExpirationMonths}
              ></s-number-field>
            </s-stack>
          </s-section>

          <s-stack direction="inline" justifyContent="end">
            <s-button type="submit" variant="primary" loading={saving || undefined}>
              Save
            </s-button>
          </s-stack>
        </s-stack>
      </Form>
    </s-page>
  );
}
