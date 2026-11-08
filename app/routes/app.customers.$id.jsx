import { useEffect, useRef } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getCustomer, setExcluded } from "../services/customers/customers.server";
import { adjustPoints, listPointHistory, parseAdjustForm } from "../services/points/points.server";
import { getSettings, pointsLabel } from "../services/settings/settings.server";
import { StatusBadge, customerStatus } from "../components/CustomerStatus";
import { changeCustomerTier, syncTierSafely, tierStatus } from "../services/tiers/sync.server";
import { describeThreshold } from "../services/tiers/icons";

// Formatted on the server in UTC so server and client render the same text.
const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const DATE_TIME = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const HISTORY_PER_PAGE = 50;

const numericId = (gid) => gid.split("/").pop();

const HISTORY_TYPES = {
  EARN: "Earned",
  REDEEM: "Redeemed",
  ADJUST: "Adjusted",
  REFUND: "Refund",
  RETURN_CODE: "Returned",
  EXPIRED: "Expired",
};

// A redeemed code: used (by an order), expired, or still available.
function codeStatus(redemption, now = new Date()) {
  if (redemption.usedAt) return { label: "Used", tone: "success" };
  if (redemption.expiresAt && redemption.expiresAt <= now) {
    return { label: `Expired ${DATE.format(redemption.expiresAt)}`, tone: "neutral" };
  }
  if (redemption.expiresAt) return { label: `Expires ${DATE.format(redemption.expiresAt)}`, tone: "info" };
  return { label: "Available", tone: "info" };
}

async function loadCustomer(request, params) {
  const { session } = await authenticate.admin(request);
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) throw new Response("Not found", { status: 404 });
  const customer = await getCustomer(session.shop, id);
  if (!customer) throw new Response("Not found", { status: 404 });
  return { session, customer };
}

export const loader = async ({ request, params }) => {
  const { session, customer } = await loadCustomer(request, params);
  const historyPage = Math.max(1, Number(new URL(request.url).searchParams.get("history")) || 1);
  const [{ rows, total }, settings, tiers] = await Promise.all([
    listPointHistory(customer.id, { skip: (historyPage - 1) * HISTORY_PER_PAGE, take: HISTORY_PER_PAGE }),
    getSettings(session.shop),
    tierStatus(customer),
  ]);
  const pointsName = pointsLabel(settings);

  const redemptions = customer.redeemHistories;
  return {
    pointsName,
    tier: tiers && {
      current: tiers.current?.title ?? null,
      value: describeThreshold(tiers.value, tiers.program.entryMethod, pointsName),
      next: tiers.next && { title: tiers.next.title, needed: describeThreshold(tiers.needed, tiers.program.entryMethod, pointsName) },
      // "Change tier" only moves customers up, as in the original app.
      above: tiers.tiers
        .filter((t) => !tiers.current || Number(t.threshold) > Number(tiers.current.threshold))
        .map((t) => ({ id: String(t.id), title: t.title })),
    },
    name: [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Unnamed customer",
    email: customer.email,
    status: customerStatus(customer),
    excluded: customer.excluded,
    points: customer.points,
    pointsEarned: customer.pointsEarned,
    customerSince: customer.shopifyCreatedAt ? DATE.format(customer.shopifyCreatedAt) : null,
    shopifyCustomerId: numericId(customer.shopifyCustomerId),
    history: rows.map((r) => ({
      id: r.id,
      date: `${DATE_TIME.format(r.createdAt)} UTC`,
      type: HISTORY_TYPES[r.type],
      points: r.points,
      reason: r.reason,
    })),
    historyPage,
    historyPages: Math.max(1, Math.ceil(total / HISTORY_PER_PAGE)),
    redemptions: redemptions.map((r) => ({
      id: r.id,
      date: `${DATE_TIME.format(r.createdAt)} UTC`,
      points: r.points,
      shopifyDiscountId: numericId(r.shopifyDiscountId),
      code: r.code,
      title: r.title,
      status: codeStatus(r),
    })),
  };
};

export const action = async ({ request, params }) => {
  const { customer } = await loadCustomer(request, params);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "exclude" || intent === "include") {
    await setExcluded(customer, intent === "exclude");
    return { intent, done: true };
  }
  if (intent === "adjust") {
    const { data, values, errors } = parseAdjustForm(formData);
    if (Object.keys(errors).length) return { intent, values, errors };
    const result = await adjustPoints(customer, data);
    if (result.errors) return { intent, values, errors: result.errors };
    // Added points count toward VIP tiers.
    if (data.points > 0) await syncTierSafely(customer.shopId, customer.id);
    return { intent, done: true };
  }
  if (intent === "tier") {
    const result = await changeCustomerTier(customer, Number(formData.get("tierId")));
    if (result.error) return { intent, error: result.error };
    return { intent, done: true };
  }
  throw new Response("Bad request", { status: 400 });
};

const signed = (n) => (n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString());

export default function CustomerDetail() {
  const c = useLoaderData();
  const shopify = useAppBridge();
  const adjust = useFetcher();
  const exclusion = useFetcher();
  const tierChange = useFetcher();
  const tierFormRef = useRef(null);
  const adjustFormRef = useRef(null);
  const modalRef = useRef(null);

  useEffect(() => {
    if (adjust.state !== "idle" || !adjust.data?.done) return;
    modalRef.current?.hideOverlay();
    adjustFormRef.current?.reset();
    shopify.toast.show(`${c.pointsName} adjusted`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjust.state, adjust.data]);

  useEffect(() => {
    if (exclusion.state === "idle" && exclusion.data?.done) {
      shopify.toast.show(exclusion.data.intent === "exclude" ? "Customer excluded" : "Customer included");
    }
  }, [exclusion.state, exclusion.data, shopify]);

  useEffect(() => {
    if (tierChange.state === "idle" && tierChange.data?.done) shopify.toast.show("Tier changed");
  }, [tierChange.state, tierChange.data, shopify]);

  const adjustErrors = adjust.data?.errors ?? {};
  const submitAdjust = () => adjust.submit(adjustFormRef.current, { method: "post" });
  const toggleExcluded = () => exclusion.submit({ intent: c.excluded ? "include" : "exclude" }, { method: "post" });

  const metrics = [
    { label: `${c.pointsName} balance`, value: c.points.toLocaleString() },
    { label: `${c.pointsName} earned (lifetime)`, value: c.pointsEarned.toLocaleString() },
    { label: "Redemptions", value: c.redemptions.length.toLocaleString() },
    { label: "Customer since", value: c.customerSince ?? "—" },
  ];
  const historyHref = (n) => (n > 1 ? `?history=${n}` : "?");

  return (
    <s-page heading={c.name} inlineSize="large">
      <s-link slot="breadcrumb-actions" href="/app/customers">
        Customers
      </s-link>
      <s-button slot="primary-action" variant="primary" commandFor="adjust-points-modal" command="--show">
        Adjust {c.pointsName.toLowerCase()}
      </s-button>
      <s-button slot="secondary-actions" onClick={toggleExcluded} loading={exclusion.state !== "idle" || undefined}>
        {c.excluded ? "Include in program" : "Exclude from program"}
      </s-button>
      <s-button slot="secondary-actions" href={`shopify://admin/customers/${c.shopifyCustomerId}`} target="_top">
        View in Shopify
      </s-button>

      {c.excluded && (
        <s-banner tone="warning" heading="This customer is excluded">
          They don&apos;t earn or redeem {c.pointsName.toLowerCase()} until you include them again.
        </s-banner>
      )}

      <s-section accessibilityLabel="Customer summary">
        <s-stack gap="base">
          <s-stack direction="inline" gap="small-200">
            <StatusBadge status={c.status} />
          </s-stack>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(140px, 1fr))" gap="base">
            {metrics.map((m) => (
              <s-stack key={m.label} gap="small-300">
                <s-text color="subdued">{m.label}</s-text>
                <s-heading>{m.value}</s-heading>
              </s-stack>
            ))}
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading={`${c.pointsName} history`} padding={c.history.length ? "none" : undefined}>
        {c.history.length === 0 ? (
          <s-paragraph color="subdued">No {c.pointsName.toLowerCase()} activity yet.</s-paragraph>
        ) : (
          <>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Reason</s-table-header>
                <s-table-header listSlot="inline">Type</s-table-header>
                <s-table-header format="numeric">{c.pointsName}</s-table-header>
                <s-table-header listSlot="labeled">Date</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {c.history.map((h) => (
                  <s-table-row key={h.id}>
                    <s-table-cell>{h.reason}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={h.points > 0 ? "success" : "neutral"}>{h.type}</s-badge>
                    </s-table-cell>
                    <s-table-cell>{signed(h.points)}</s-table-cell>
                    <s-table-cell>{h.date}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            {c.historyPages > 1 && (
              <s-box padding="base">
                <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                  <s-text color="subdued">
                    Page {c.historyPage} of {c.historyPages}
                  </s-text>
                  <s-button-group>
                    <s-button
                      slot="secondary-actions"
                      href={historyHref(c.historyPage - 1)}
                      disabled={c.historyPage <= 1 || undefined}
                    >
                      Newer
                    </s-button>
                    <s-button
                      slot="secondary-actions"
                      href={historyHref(c.historyPage + 1)}
                      disabled={c.historyPage >= c.historyPages || undefined}
                    >
                      Older
                    </s-button>
                  </s-button-group>
                </s-stack>
              </s-box>
            )}
          </>
        )}
      </s-section>

      <s-section heading="Redeem history" padding={c.redemptions.length ? "none" : undefined}>
        {c.redemptions.length === 0 ? (
          <s-paragraph color="subdued">This customer hasn&apos;t redeemed any {c.pointsName.toLowerCase()} yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Discount</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header listSlot="labeled" format="numeric">
                {c.pointsName} used
              </s-table-header>
              <s-table-header listSlot="labeled">Date</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {c.redemptions.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    <s-stack gap="small-500">
                      <s-link href={`shopify://admin/discounts/${r.shopifyDiscountId}`} target="_top">
                        {r.code ?? `Discount ${r.shopifyDiscountId}`}
                      </s-link>
                      {r.title && <s-text color="subdued">{r.title}</s-text>}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={r.status.tone}>{r.status.label}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{r.points.toLocaleString()}</s-table-cell>
                  <s-table-cell>{r.date}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      {c.tier && (
        <s-section slot="aside" heading="VIP tier">
          <s-stack gap="base">
            <s-text type="strong">{c.tier.current ?? "Not placed yet"}</s-text>
            <s-text color="subdued">
              {c.tier.value} this period
              {c.tier.next ? `, ${c.tier.next.needed} more for ${c.tier.next.title}` : ""}
            </s-text>
            {c.tier.above.length > 0 && (
              <tierChange.Form method="post" ref={tierFormRef}>
                <input type="hidden" name="intent" value="tier" />
                <s-stack gap="small-200">
                  <s-select label="Move up to" name="tierId" error={tierChange.data?.error}>
                    {c.tier.above.map((t) => (
                      <s-option key={t.id} value={t.id}>
                        {t.title}
                      </s-option>
                    ))}
                  </s-select>
                  <s-button type="submit" loading={tierChange.state !== "idle" || undefined}>
                    Change tier
                  </s-button>
                </s-stack>
              </tierChange.Form>
            )}
          </s-stack>
        </s-section>
      )}

      <s-section slot="aside" heading="Contact information">
        {c.email ? (
          <s-link href={`mailto:${c.email}`}>{c.email}</s-link>
        ) : (
          <s-text color="subdued">No email address</s-text>
        )}
      </s-section>

      <s-modal id="adjust-points-modal" ref={modalRef} heading={`Adjust ${c.pointsName.toLowerCase()}`}>
        <adjust.Form method="post" ref={adjustFormRef}>
          <input type="hidden" name="intent" value="adjust" />
          <s-stack gap="base">
            <s-paragraph>
              Current balance: <s-text type="strong">{c.points.toLocaleString()}</s-text>
            </s-paragraph>
            <s-number-field
              label={c.pointsName}
              name="points"
              step={1}
              details="Use a minus sign to remove, for example -50."
              error={adjustErrors.points}
            ></s-number-field>
            <s-text-field
              label="Reason"
              name="reason"
              maxLength={255}
              details="Shown in the customer's history."
              error={adjustErrors.reason}
            ></s-text-field>
          </s-stack>
        </adjust.Form>
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={submitAdjust}
          loading={adjust.state !== "idle" || undefined}
        >
          Save
        </s-button>
        <s-button slot="secondary-actions" commandFor="adjust-points-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}
