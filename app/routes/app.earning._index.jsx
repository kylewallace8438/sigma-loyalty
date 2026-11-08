import { useEffect } from "react";
import { useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { listEarningRules } from "../services/earning/rules.server";
import { getSettings, pointsLabel } from "../services/settings/settings.server";
import { EARNING_TYPE, describeEarning, earningSlug } from "../services/earning/types";

// The ways customers earn points. Every rule exists (off by default); the merchant edits and turns them on.
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const [groups, settings] = await Promise.all([listEarningRules(session.shop), getSettings(session.shop)]);
  return { groups, programEnabled: settings.programEnabled, pointsName: pointsLabel(settings) };
};

const formatMoney = (value) => Number(value).toFixed(2);

export default function EarningRules() {
  const { groups, programEnabled, pointsName } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const shopify = useAppBridge();

  // The edit page redirects back here with ?notice=saved.
  useEffect(() => {
    if (searchParams.get("notice") !== "saved") return;
    shopify.toast.show("Earning rule saved");
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, shopify]);

  return (
    <s-page heading="Earning rules">
      {!programEnabled && (
        <s-banner tone="warning" heading="The program is off">
          Customers don&apos;t earn anything until you turn the program on in{" "}
          <s-link href="/app/settings">Settings</s-link>.
        </s-banner>
      )}

      {groups.map((group) => (
        <s-section key={group.key} heading={group.heading} padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Rule</s-table-header>
              <s-table-header listSlot="secondary">Reward</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {group.rules.map((rule) => (
                <s-table-row key={rule.type} clickDelegate={`rule-${rule.type}`}>
                  <s-table-cell>
                    <s-stack gap="small-500">
                      <s-link id={`rule-${rule.type}`} href={`/app/earning/${earningSlug(rule.type)}`}>
                        {rule.name}
                      </s-link>
                      <s-text color="subdued">{EARNING_TYPE[rule.type].description}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{describeEarning(rule, { pointsName, formatMoney })}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={rule.active ? "success" : "neutral"}>{rule.active ? "Active" : "Off"}</s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      ))}
    </s-page>
  );
}
