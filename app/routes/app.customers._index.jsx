import { useEffect, useRef, useState } from "react";
import { Form, useFetcher, useLoaderData, useNavigation, useRevalidator, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../services/shops.server";
import {
  CUSTOMERS_PER_PAGE,
  countCustomers,
  listCustomers,
  parseCustomerFilters,
} from "../services/customers.server";
import { getCustomerSyncProgress, startCustomerSync } from "../services/customer-sync.server";

// While a sync runs, the page reloads its data this often to show progress and new rows.
const POLL_MS = 1500;
const SEARCH_DEBOUNCE_MS = 300;

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const filters = parseCustomerFilters(new URL(request.url).searchParams);
  const [{ customers, total }, shopTotal] = await Promise.all([
    listCustomers(session.shop, filters),
    countCustomers(session.shop),
  ]);
  const sync = getCustomerSyncProgress(session.shop);

  return {
    query: filters.query,
    page: filters.page,
    shopTotal,
    pages: Math.max(1, Math.ceil(total / CUSTOMERS_PER_PAGE)),
    total,
    customers: customers.map((c) => ({
      id: c.id,
      name: [c.firstName, c.lastName].filter(Boolean).join(" ") || "—",
      email: c.email ?? "—",
      points: c.points,
    })),
    sync: sync && {
      status: sync.status,
      synced: sync.synced,
      total: sync.total,
      startedAt: sync.startedAt.toISOString(),
      error: sync.error,
    },
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  startCustomerSync(admin, shop);
  // The sync this request started (or the one already running), so the page can follow it.
  return { startedAt: getCustomerSyncProgress(session.shop).startedAt.toISOString() };
};

// Banner content for the latest sync: running shows live progress, finished ones can be dismissed.
function syncBanner(sync) {
  const count = sync.total == null ? `${sync.synced}` : `${sync.synced} of ${sync.total}`;
  if (sync.status === "running") {
    return {
      tone: "info",
      heading: "Syncing customers from Shopify",
      body: (
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-spinner size="base" accessibilityLabel="Syncing" />
          <s-text>{count} customers synced…</s-text>
        </s-stack>
      ),
    };
  }
  if (sync.status === "failed") {
    return {
      tone: "critical",
      heading: "Customer sync failed",
      body: `${count} customers were synced before the error: ${sync.error}`,
    };
  }
  return { tone: "success", heading: "Customer sync complete", body: `${sync.synced} customers synced from Shopify.` };
}

export default function Customers() {
  const { customers, total, shopTotal, query, page, pages, sync } = useLoaderData();
  const fetcher = useFetcher();
  const navigation = useNavigation();
  const submit = useSubmit();
  const formRef = useRef(null);
  const searchRef = useRef(null);
  const revalidator = useRevalidator();
  // The banner only follows syncs this page visit has seen: one started with the button, or one
  // seen running. Its result stays until dismissed or the user leaves the page (state resets).
  const [seenRunning, setSeenRunning] = useState(null);
  const [dismissed, setDismissed] = useState(null);

  const starting = fetcher.state !== "idle";
  const running = sync?.status === "running";

  useEffect(() => {
    if (running) setSeenRunning(sync.startedAt);
  }, [running, sync?.startedAt]);

  const bannerRef = useRef(null);

  useEffect(() => {
    if (!running || revalidator.state !== "idle") return;
    const timer = window.setTimeout(() => revalidator.revalidate(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [running, revalidator]);

  const followed = sync && (running || [seenRunning, fetcher.data?.startedAt].includes(sync.startedAt));
  const showBanner = followed && dismissed !== sync.startedAt;
  const banner = showBanner && syncBanner(sync);

  // React 18 doesn't wire custom-event props on web components, so listen directly.
  useEffect(() => {
    const el = bannerRef.current;
    if (!el || running) return;
    const onDismiss = () => setDismissed(sync.startedAt);
    el.addEventListener("dismiss", onDismiss);
    return () => el.removeEventListener("dismiss", onDismiss);
  }, [showBanner, running, sync?.startedAt]);

  // React 18 doesn't wire onInput on web components; search submits after typing pauses.
  useEffect(() => {
    const search = searchRef.current;
    let timer = 0;
    const onSearch = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => submit(formRef.current, { replace: true }), SEARCH_DEBOUNCE_MS);
    };
    search?.addEventListener("input", onSearch);
    return () => {
      window.clearTimeout(timer);
      search?.removeEventListener("input", onSearch);
    };
  }, [submit, shopTotal]);

  const startSync = () => fetcher.submit({}, { method: "post" });
  const clearSearch = () => {
    if (searchRef.current) searchRef.current.value = "";
    submit(formRef.current, { replace: true });
  };
  const pageHref = (n) => `?${new URLSearchParams({ ...(query && { q: query }), page: String(n) })}`;
  const loading = navigation.state === "loading" && navigation.location?.pathname === "/app/customers";

  return (
    <s-page heading="Customers" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={startSync}
        loading={starting || undefined}
        disabled={running || undefined}
      >
        Sync customers
      </s-button>

      {banner && (
        <s-banner ref={bannerRef} tone={banner.tone} heading={banner.heading} dismissible={!running || undefined}>
          {banner.body}
        </s-banner>
      )}

      {shopTotal === 0 ? (
        <s-section>
          <s-stack gap="base" alignItems="center" padding="large">
            <s-heading>No customers yet</s-heading>
            <s-paragraph>
              Sync your Shopify customers to start tracking their loyalty points.
            </s-paragraph>
            <s-button variant="primary" onClick={startSync} disabled={running || undefined}>
              Sync customers
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section padding="none" accessibilityLabel="Customers table">
          <s-table loading={loading || undefined}>
            <Form method="get" ref={formRef} slot="filters">
              <s-grid gridTemplateColumns="1fr auto" gap="small-200" alignItems="center">
                <s-text-field
                  ref={searchRef}
                  label="Search customers"
                  labelAccessibilityVisibility="exclusive"
                  name="q"
                  icon="search"
                  placeholder="Search by name or email"
                  value={query}
                  autocomplete="off"
                ></s-text-field>
                <s-button variant="tertiary" onClick={clearSearch} disabled={!query || undefined}>
                  Clear
                </s-button>
              </s-grid>
            </Form>

            <s-table-header-row>
              <s-table-header listSlot="primary">Name</s-table-header>
              <s-table-header listSlot="labeled">Email</s-table-header>
              <s-table-header listSlot="inline" format="numeric">Points</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {customers.map((c) => (
                <s-table-row key={c.id}>
                  <s-table-cell>
                    <s-link href={`/app/customers/${c.id}`}>{c.name}</s-link>
                  </s-table-cell>
                  <s-table-cell>{c.email}</s-table-cell>
                  <s-table-cell>{c.points}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>

          {customers.length === 0 ? (
            <s-box padding="large">
              <s-stack gap="small" alignItems="center">
                <s-heading>No customers found</s-heading>
                <s-paragraph color="subdued">Try a different name or email.</s-paragraph>
                <s-button variant="secondary" onClick={clearSearch}>
                  Clear search
                </s-button>
              </s-stack>
            </s-box>
          ) : (
            <s-box padding="base">
              <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                <s-text color="subdued">
                  Page {page} of {pages} · {total} {query ? "matching " : ""}customers
                </s-text>
                <s-button-group>
                  <s-button slot="secondary-actions" href={pageHref(page - 1)} disabled={page <= 1 || undefined}>
                    Previous
                  </s-button>
                  <s-button slot="secondary-actions" href={pageHref(page + 1)} disabled={page >= pages || undefined}>
                    Next
                  </s-button>
                </s-button-group>
              </s-stack>
            </s-box>
          )}
        </s-section>
      )}
    </s-page>
  );
}
