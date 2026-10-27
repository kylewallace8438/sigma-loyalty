# Sigma Loyalty: Work Breakdown Structure

A map of what the app needs to become a working loyalty program, and how to build each piece in *this* codebase. Each work package (WP) states **what** it is, **how** to implement it (files, Shopify APIs, scopes), what it **depends on**, and when it's **done**.

**Legend**: ✅ done · 🟡 partly done / scaffolded · 🔲 to do — Size: **S** ≤ 1 day · **M** 2–3 days · **L** ≥ 1 week

---

## How the app fits together

```
                ┌──────────────────── Shopify ─────────────────────┐
                │ Admin (iframe)   Storefront (theme)   Customer    │
                │      │                 │              accounts    │
                └──────┼─────────────────┼──────────────────┼───────┘
     OAuth/session ────┤   App proxy ────┤   Session token ─┤   Webhooks (HMAC)
                       ▼                 ▼                  ▼        ▼
   ┌──────────────── app/ (React Router, Node) ─────────────────────────────┐
   │ routes/app.*        routes/proxy.*      routes/api.*     routes/webhooks.*│
   │      │                   │                  │                 │        │
   │      └──────────► app/services/*.server.js (business logic) ◄─┘        │
   │                        │                        │                       │
   │              app/db.server.js (Prisma)   admin.graphql() (Admin API)   │
   └────────────────────────┼────────────────────────┼──────────────────────┘
                            ▼                        ▼
                      MySQL (Docker)        Shopify Admin GraphQL API
```

Rules of thumb for this codebase:
- **Routes stay thin.** Authenticate, parse, call a service, return. Business logic goes in `app/services/*.server.js`; the `.server` suffix keeps it (and secrets) out of the browser bundle.
- **Points are a ledger, not a number.** Every change is an append-only row; the balance is derived (or cached and recomputed). That makes refunds, audits and GDPR exports straightforward.
- **Webhooks are retried and can arrive twice or out of order.** Every handler must be idempotent: a unique DB key on `(shopId, orderId, type)` stops a retried webhook from creating a second row.
- **Log with context**: `logger.info({ shop, orderId, customerId }, "…")` (see `app/logger.server.js`).

---

## WBS at a glance

```
1  Foundation & infrastructure
   1.1 ✅ Docker dev (HMR) / prod (build) + MySQL
   1.2 ✅ Prisma 7 + MySQL adapter, migrations
   1.3 ✅ Structured logging (pino, rotated files)
   1.4 ✅ Shopify app config: URLs, routes, webhooks, compliance topics
   1.5 🟡 Install flow & session storage (needs your domain + `shopify app deploy`)
   1.6 ✅ Shop record + post-install bootstrap
   1.7 🔲 Lint/test/CI pipeline
2  Data model
   2.1 🟡 Loyalty schema (✅ Shop, DiscountRule, Order · 🔲 Settings, Member, Ledger, Redemption)
   2.2 🔲 Webhook idempotency & event log
3  Earning points
   3.1 🟡 Award pending points on order (orders/create or orders/paid)
   3.2 🟡 Confirm points on fulfilment (orders/fulfilled)
   3.3 🔲 Reverse points on refund / cancellation
   3.4 🔲 Bonus rules (sign-up, birthday, manual campaigns)
   3.5 🔲 Points expiry job
4  Redeeming points
   4.1 ✅ Rewards catalogue = discount rules (app-only templates)
   4.1b ❌ Discount codes screen (removed: points are exchanged for Shopify discounts manually)
   4.2 🔲 Redeem → generate customer-specific discount code
   4.3 🔲 Track discount usage & expire unused codes
5  Customer-facing surfaces
   5.1 🔲 App proxy API (storefront → app)
   5.2 🔲 Theme app extension (points widget / app block)
   5.3 🔲 Customer account UI extension (balance + redeem on Profile)
   5.4 🔲 Sync balance to a customer metafield (optional)
6  Privacy & compliance
   6.1 🟡 customers/data_request
   6.2 🟡 customers/redact
   6.3 ✅ shop/redact + app/uninstalled cleanup
   6.4 🔲 Protected customer data request (Partner Dashboard)
7  Merchant admin UI
   7.1 🔲 Program settings page
   7.2 🔲 Members list & member detail (ledger, manual adjust)
   7.3 🔲 Dashboard metrics
8  Monetisation
   8.1 🔲 App pricing plans (managed pricing)
9  Operations & launch
   9.1 🔲 Background jobs / queue for heavy webhook work
   9.2 🔲 Backups, monitoring, alerting
   9.3 🔲 App Store review readiness
```

Suggested order: **1.6 → 2.1 → 2.2 → 3.1 → 3.2 → 7.1 → 7.2 → 4.1 → 4.2 → 5.1 → 5.2 → 3.3 → 6.x → the rest.** This gets a merchant earning and seeing points end to end before the customer-facing surfaces.

---

## 1. Foundation & infrastructure

### 1.1 ✅ Docker dev/prod + MySQL
- **What**: `docker-compose.yml` with `mysql`, `app-dev` (profile `dev`, HMR) and `app` (profile `prod`, built bundle). Multi-stage `Dockerfile` (`dev`, `build`, `prod` targets).
- **How to use**: see [SERVER.md](SERVER.md). `npm run compose:dev` / `npm run compose:prod`.

### 1.2 ✅ Prisma 7 + MySQL
- **What**: `prisma.config.ts` (CLI connection + migrations path), `app/db.server.js` (runtime client via `@prisma/adapter-mariadb`), schema in `prisma/schema.prisma`.
- **Workflow**: edit schema → `npx prisma migrate dev --name <change>` → commit the migration folder. Containers run `prisma migrate deploy` at start.

### 1.3 ✅ Logging
- `import logger from "~/logger.server"` (or a relative path). Files in `logs/`, rotated daily, 14 kept.

### 1.4 ✅ Shopify app configuration
- `shopify.app.toml`: `application_url`, `redirect_urls`, webhook subscriptions (incl. compliance topics), `api_version = "2026-07"` (must match `ApiVersion.July26` in `app/shopify.server.js`).
- Validate with `shopify app config validate --json`; publish with `shopify app deploy`.

### 1.5 🟡 Install flow & session storage — **S**
- **Already works**: OAuth/token exchange via `@shopify/shopify-app-react-router`; offline sessions saved to the `Session` table by `PrismaSessionStorage`.
- **Remaining**: set your domain in `.env` + toml, `shopify app deploy`, install on a dev store, confirm a row in `Session`.
- **Done when**: opening the app in the admin renders `/app` and `SELECT shop FROM Session` shows the store.

### 1.6 ✅ Shop record + post-install bootstrap — **S**
- **Done**: `afterAuth` hook in `app/shopify.server.js` → `ensureShop()` in `app/services/shops.server.js`. Remaining nice-to-have: store shop name/currency/timezone.
- **What**: a `Shop` row per installed store (created on first auth), with default program settings.
- **How**: add an `afterAuth` hook in `shopifyApp({ hooks: { afterAuth: async ({ session, admin }) => { … } } })` in `app/shopify.server.js` → `shopService.ensureShop(session.shop)` (upsert). Optionally query `shop { name currencyCode ianaTimezone }` via `admin.graphql` and store it; the currency is needed for "points per currency unit".
- **Depends on**: 2.1. **Done when**: reinstalling doesn't duplicate rows and settings default sensibly.

### 1.7 🔲 Lint / tests / CI — **M**
- `npm run lint`, `npm run typecheck`; add **Vitest** for `app/services/*` (pure functions such as points calculation are easy to unit test).
- CI: lint + test + `docker build --target prod`.

---

## 2. Data model

### 2.1 🔲 Loyalty schema — **M**
Proposed starting point for `prisma/schema.prisma` (Shopify IDs as `BigInt`; money as `Decimal`):

```prisma
model Shop {
  id          Int       @id @default(autoincrement())
  domain      String    @unique            // xxx.myshopify.com
  currency    String    @default("USD")
  installedAt DateTime  @default(now())
  uninstalledAt DateTime?
  settings    ProgramSettings?
  members     Member[]
  rewards     Reward[]
}

model ProgramSettings {
  shopId            Int     @id
  shop              Shop    @relation(fields: [shopId], references: [id], onDelete: Cascade)
  enabled           Boolean @default(true)
  pointsPerCurrency Decimal @default(1) @db.Decimal(10, 2)  // e.g. 1 point per $1
  confirmOn         String  @default("FULFILLED")           // PAID | FULFILLED
  expiryDays        Int?                                    // null = never expire
  signupBonus       Int     @default(0)
}

model Member {
  id                Int      @id @default(autoincrement())
  shopId            Int
  shop              Shop     @relation(fields: [shopId], references: [id], onDelete: Cascade)
  shopifyCustomerId BigInt
  email             String?
  balance           Int      @default(0)   // cached AVAILABLE points; ledger is the source of truth
  pending           Int      @default(0)
  createdAt         DateTime @default(now())
  ledger            LedgerEntry[]
  @@unique([shopId, shopifyCustomerId])
}

model LedgerEntry {
  id             Int      @id @default(autoincrement())
  memberId       Int
  member         Member   @relation(fields: [memberId], references: [id], onDelete: Cascade)
  type           String   // EARN | REDEEM | REVERSE | EXPIRE | ADJUST | BONUS
  status         String   // PENDING | AVAILABLE | VOID
  points         Int      // signed: +earn, -redeem
  shopifyOrderId BigInt?
  reason         String?
  createdAt      DateTime @default(now())
  expiresAt      DateTime?
  @@unique([memberId, shopifyOrderId, type])   // idempotency for order-driven entries
  @@index([memberId, createdAt])
}

model Reward {
  id        Int     @id @default(autoincrement())
  shopId    Int
  shop      Shop    @relation(fields: [shopId], references: [id], onDelete: Cascade)
  title     String
  cost      Int                       // points
  kind      String                    // AMOUNT_OFF | PERCENT_OFF | FREE_SHIPPING
  value     Decimal @db.Decimal(10, 2)
  active    Boolean @default(true)
}

model Redemption {
  id               Int      @id @default(autoincrement())
  memberId         Int
  rewardId         Int
  ledgerEntryId    Int      @unique
  discountNodeId   String                // gid://shopify/DiscountCodeNode/…
  code             String
  status           String   @default("ISSUED") // ISSUED | USED | EXPIRED
  createdAt        DateTime @default(now())
}
```
- **Done when**: migration applied, and `app/services/` has `members.server.js` / `ledger.server.js` with `credit()`, `debit()`, `confirm()`, `reverse()`. All of these run inside `db.$transaction` and update `Member.balance` in the same transaction.

### 2.2 🔲 Webhook idempotency & event log — **S**
- **What**: a `WebhookEvent` table (`webhookId @unique`, `topic`, `shop`, `receivedAt`, `processedAt`, `error`). `authenticate.webhook()` exposes the delivery id (`webhookId`).
- **How**: insert first; on a duplicate-key error, return `200` immediately. The ledger's unique keys are the second line of defence.

---

## 3. Earning points

### 3.1 🟡 Award pending points on order — **M**
- **Scaffold**: `app/routes/webhooks.app.order_created.jsx` (`orders/create`) logs the order.
- **How**:
  1. `const { shop, payload } = await authenticate.webhook(request)`.
  2. Skip if `!payload.customer` (guest checkout) or the program is disabled.
  3. `points = floor(subtotal_price × pointsPerCurrency)`. Decide whether tax and shipping count (usually not: use `subtotal_price`, or `current_subtotal_price` to account for edits).
  4. `ledger.credit({ shop, customerId, orderId, points, status: "PENDING" })`, which upserts the `Member`.
- **Consider** switching to (or adding) **`orders/paid`**: `orders/create` also fires for unpaid orders (bank transfer/COD). Add the topic in `shopify.app.toml` plus a route `webhooks.app.order_paid.jsx`.
- **Scopes**: `read_orders` ✅ (+ protected customer data, see 6.4).
- **Done when**: placing a test order creates one PENDING ledger row; re-sending the webhook doesn't create a second.

### 3.2 🟡 Confirm points on fulfilment — **S**
- **Scaffold**: `webhooks.app.order_fulfilled.jsx` (`orders/fulfilled`).
- **How**: `ledger.confirm({ shop, orderId })` flips PENDING → AVAILABLE and moves the amount from `pending` to `balance`. If `confirmOn = PAID`, confirm in 3.1 directly instead.

### 3.3 🔲 Reverse on refund / cancellation — **M**
- **Topics**: `refunds/create` (partial: reverse proportionally to the refunded subtotal) and `orders/cancelled` (reverse all).
- **How**: write a `REVERSE` entry with negative points referencing the order. If the member has already spent the points, allow a negative balance or cap it (product decision, so document it).

### 3.4 🔲 Bonus rules — **M**
- Sign-up bonus: `customers/create` webhook → `BONUS` entry (needs `read_customers`).
- Birthday or campaign bonuses: a scheduled job (9.1) or manual adjust (7.2).

### 3.5 🔲 Points expiry — **S**
- A nightly job finds AVAILABLE entries past `expiresAt` that haven't been consumed and writes `EXPIRE` entries. FIFO consumption makes this accurate; a simpler version expires the whole balance after N days of inactivity.

---

## 4. Redeeming points

### 4.1 ✅ Rewards catalogue (discount rules) — **S**
- **Pages**: `/app/discount-rules` (list with search by title, status and type filters) and `/app/discount-rules/new` or `/:id`.
- **Model**: `DiscountRule` is a reward template stored **only in the app**: title, points cost, type (fixed / percentage / free shipping), value, minimum subtotal, usage limit, once per customer, active. It has no code or dates and creates nothing in Shopify.
- **Flow**: route action → `parseRuleForm()` → `saveRule()` / `deleteRule()` in `app/services/discounts/rules.server.js`. Inactive rules are kept but retired.
- Points are exchanged for Shopify discounts manually; the app creates no discounts.

### 4.1b ❌ Discount codes (removed)
- The `/app/discount-codes` pages, the `DiscountCode` table and the app's Shopify discount mutations were removed: merchants exchange points for discounts manually in Shopify, so the app doesn't duplicate Shopify's discount management. See git history for the old implementation.

### 4.2 🔲 Redeem → discount code — **M**
- **Flow**: customer picks a reward (5.1/5.3) → server checks `balance ≥ cost` → in a DB transaction write a `REDEEM` ledger entry (−cost) → create a single-use, customer-locked discount code via the Admin API → save a `Redemption` → return the code.
- **Admin API** (validated against `2026-07`; requires **`write_discounts`**, **`read_discounts`**):
  ```graphql
  mutation RedeemReward($customerId: ID!, $code: String!, $title: String!, $startsAt: DateTime!, $amount: Decimal!) {
    discountCodeBasicCreate(
      basicCodeDiscount: {
        title: $title
        code: $code
        startsAt: $startsAt
        context: { customers: { add: [$customerId] } }
        customerGets: {
          value: { discountAmount: { amount: $amount, appliesOnEachItem: false } }
          items: { all: true }
        }
        usageLimit: 1
        appliesOncePerCustomer: true
      }
    ) {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            codes(first: 1) { nodes { code } }
          }
        }
      }
      userErrors { field message }
    }
  }
  ```
  Docs: https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/discountCodeBasicCreate
- **Calling it from a non-admin request** (app proxy, customer account): there's no admin request to authenticate, so use `const { admin } = await unauthenticated.admin(shop)` from `app/shopify.server.js` (uses the stored offline session).
- **Failure handling**: if `userErrors` is non-empty, roll back the ledger entry (create the code first, then commit the DB transaction, or write a compensating entry).

### 4.3 🔲 Track usage & expire codes — **S**
- On `orders/paid`, read `payload.discount_codes[].code` → mark matching `Redemption` as USED.
- Optional: give codes an `endsAt`, and refund points for codes that expire unused.

---

## 5. Customer-facing surfaces

### 5.1 🔲 App proxy API — **M**
- **What**: storefront JS calls `https://<store>/apps/loyalty/...`; Shopify forwards the request to your app with a signature.
- **How**: add to `shopify.app.toml`:
  ```toml
  [app_proxy]
  url = "https://<your-domain>/proxy"
  subpath = "loyalty"
  prefix = "apps"
  ```
  Routes: `app/routes/proxy.balance.jsx`, `proxy.redeem.jsx`, each starting with `const { session, liquid } = await authenticate.public.appProxy(request)`. The logged-in customer's id arrives as the `logged_in_customer_id` query param, which is empty for guests.
- **Done when**: `/apps/loyalty/balance` on the storefront returns the logged-in customer's balance.

### 5.2 🔲 Theme app extension — **M**
- `shopify app generate extension --template theme_app_extension --name loyalty-widget` → creates `extensions/loyalty-widget/` (Liquid blocks + assets).
- An **app embed** (floating "My points" launcher) and/or an **app block** (balance on the product or cart page) that fetches from 5.1.

### 5.3 🔲 Customer account UI extension — **M**
- `shopify app generate extension` → *Customer account UI* → target e.g. `customer-account.profile.block.render`.
- It calls your backend with a session token; the server route uses `authenticate.public.customerAccount(request)`. Shows balance, history and a "Redeem" button (4.2).

### 5.4 🔲 Balance in a customer metafield (optional) — **S**
- Declare an app-owned metafield in the toml (like the existing `product.metafields.app.demo_info`) with storefront read access, and write it with `metafieldsSet` after every ledger change. Liquid can then read it without an API call. Needs `write_customers`.

---

## 6. Privacy & compliance (required for App Store)

All three routes exist and return `200`; an invalid HMAC gets `401` automatically.

| WP | Route | Remaining work |
|---|---|---|
| 6.1 🟡 `customers/data_request` | `webhooks.customers.data_request.jsx` | Export the member's ledger and redemptions and deliver them to the merchant (e.g. email or an admin download) within 30 days |
| 6.2 🟡 `customers/redact` | `webhooks.customers.redact.jsx` | Delete or anonymise the `Member` (and email) for `payload.customer.id` |
| 6.3 ✅ `shop/redact` | `webhooks.shop.redact.jsx` | Deletes sessions and the `Shop` row (cascades to discount rules and future tables) |
| 6.3 ✅ `app/uninstalled` | `webhooks.app.uninstalled.jsx` | Deletes sessions and sets `Shop.uninstalledAt` (data kept until `shop/redact`) |
| 6.4 🔲 Protected customer data | Partner Dashboard → API access | Request Level 1 (customer data in orders); Level 2 if you store email/name. **Blocks `orders/*` webhooks** |

---

## 7. Merchant admin UI

Admin pages are routes under `app/routes/app.*.jsx`, rendered inside the admin with Polaris web components (`<s-page>`, `<s-section>`, `<s-text-field>`, …). Add each to `<s-app-nav>` in `app/routes/app.jsx`.

Pattern:
```jsx
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { settings: await settingsService.get(session.shop) };
};
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  await settingsService.update(session.shop, Object.fromEntries(await request.formData()));
  return { ok: true };
};
```

| WP | Route | Size | Content |
|---|---|---|---|
| 7.1 🔲 Settings | `app.settings.jsx` | S | enable, points per currency, confirm on paid/fulfilled, expiry, sign-up bonus, rewards |
| 7.2 🔲 Members | `app.members.jsx`, `app.members.$id.jsx` | M | search by email, balance, ledger history, manual adjust (`ADJUST` entry + reason) |
| 7.3 🔲 Dashboard | `app._index.jsx` (replace the template demo) | M | members, points issued/redeemed (30 days), redemption rate |

Remove the template demo once 7.3 exists: `app.additional.jsx`, the product-creation action in `app._index.jsx`, and the `demo_info` / `example` metafield/metaobject in the toml.

---

## 8. Monetisation

### 8.1 🔲 App pricing — **M**
- Prefer **managed pricing** (plans configured in the Partner Dashboard; Shopify hosts the plan picker). Gate features with the active plan, e.g. member limits on a free tier.

---

## 9. Operations & launch

### 9.1 🔲 Background work — **M**
- Shopify expects a webhook response within about 5 s. Simple ledger writes are fine inline; anything slow (discount creation, metafield sync, bulk recalculation) should go to a queue (e.g. a `Job` table polled by a worker container, or BullMQ + Redis added to `docker-compose.yml`).
- Scheduled jobs (3.5 expiry, 4.3 code expiry): a `worker` service in compose running `node scripts/worker.js` with a cron library.

### 9.2 🔲 Backups & monitoring — **S**
- Nightly `mysqldump` from the `mysql` container; ship `logs/` to your log stack; alert on `/healthz` failing.

### 9.3 🔲 App Store readiness — **M**
- `shopify app security check --yes`; compliance webhooks (6.x); privacy policy URL; app listing; Built for Shopify performance (admin pages fast, no layout shift).

---

## Scope changes this roadmap will need

| Scope | Needed by | Status |
|---|---|---|
| `read_orders` | 3.1–3.3, 4.3 | ✅ present |
| `read_customers` | 2.x customer sync, 3.4, 7.2 | ✅ added (needs `shopify app deploy` + approval) |
| `write_discounts`, `read_discounts` | 4.1, 4.2 | ✅ added (needs `shopify app deploy` + merchant approval) |
| `write_customers` | 5.4 (metafield sync) | 🔲 add if used |
| `write_products`, `write_metaobjects`, `write_metaobject_definitions` | template demo only | remove with the demo |

Update `scopes` in `shopify.app.toml` **and** `SCOPES` in `.env`, then `shopify app deploy`. Merchants are asked to approve the new scopes the next time they open the app.
