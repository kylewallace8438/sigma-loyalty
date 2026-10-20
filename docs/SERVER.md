# Running Sigma Loyalty as a server

The app runs in Docker behind your own Cloudflare tunnel, without Shopify CLI's temporary tunnel. The same `docker-compose.yml` runs it in two modes:

| Mode | Command | What runs |
|---|---|---|
| **dev (HMR)** | `npm run compose:dev` | `react-router dev`; source is bind-mounted, so edits hot-reload |
| **prod (build)** | `npm run compose:prod` | `npm run build`, then `react-router-serve` (detached) |
| stop | `npm run compose:down` | stops both app profiles (MySQL keeps running) |
| DB only | `docker compose up -d mysql` | MySQL on `127.0.0.1:3308`, for running the app on the host |

Both modes publish the app on **`http://localhost:${APP_PORT:-3000}`**. Only one mode can run at a time because they share that port.

```
Shopify admin / storefront
        │  https://<your-domain>
        ▼
Cloudflare tunnel  ──►  http://localhost:3000  ──►  app container (dev or prod)
                                                        │
                                                        ▼
                                                  mysql container (mysql:3306)
```

## 1. One-time setup

1. **Pick the public hostname** for the tunnel, e.g. `loyalty.yourdomain.com`.
2. **`.env`** (copy from `.env.example` if missing):
   - `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`: from `shopify app env show`
   - `SHOPIFY_APP_URL="https://loyalty.yourdomain.com"`
   - `SCOPES`: same value as `scopes` in `shopify.app.toml`
3. **`shopify.app.toml`**: replace every `https://loyalty.example.com` with your hostname (`application_url` and the three `redirect_urls`).
4. **Cloudflare tunnel**: map the hostname to `http://localhost:3000`. WebSockets must stay enabled (they are by default), because dev-mode HMR uses `wss://<your-domain>` on the same port.
5. **Protected customer data**: the `orders/*` webhooks contain customer data. In the Partner Dashboard, open your app's **API access** page, request access to protected customer data (Level 1 is enough for now), and select the reasons. Without this, `shopify app deploy` rejects the order webhook subscriptions.
6. **Push the config to Shopify**:
   ```bash
   shopify app config validate --json   # should report "valid": true
   shopify app deploy                   # releases URLs, scopes and webhooks as a new app version
   ```
7. **Start the server**: `npm run compose:prod` (or `compose:dev`), then check `https://<your-domain>/healthz` returns `{"status":"ok","db":"ok"}`.
8. **Install**: Partner Dashboard → your app → **Test your app** / select a dev store, or open `https://<your-domain>/auth/login` and enter `your-store.myshopify.com`. When the install finishes, the offline session is saved to MySQL; check the `Session` table.

> `automatically_update_urls_on_dev = false` in `shopify.app.toml` stops `shopify app dev` from overwriting your URLs with a trycloudflare one. To use the CLI's own tunnel again temporarily, run `shopify app dev --tunnel-url https://<your-domain>:443` instead.

## 2. Routes

Declare these in `shopify.app.toml` (they're already filled in; only the domain changes):

| Route | File | Purpose | Where it's declared |
|---|---|---|---|
| `/` | `routes/_index/route.jsx` | Landing page; redirects to `/app` when `?shop=` is present | `application_url` |
| `/app` | `routes/app.jsx` + `routes/app._index.jsx` | Embedded admin UI (layout + home) | `application_url` (Shopify loads `/app` in the admin iframe) |
| `/app/additional` | `routes/app.additional.jsx` | Example admin page | `<s-app-nav>` in `app.jsx` |
| `/auth/login` | `routes/auth.login/route.jsx` | Manual "enter your shop domain" login | — |
| `/auth/*` | `routes/auth.$.jsx` | OAuth start + callback (`/auth/callback`, …) | `[auth] redirect_urls` |
| `/webhooks/app/uninstalled` | `routes/webhooks.app.uninstalled.jsx` | `app/uninstalled` | `[[webhooks.subscriptions]]` |
| `/webhooks/app/scopes_update` | `routes/webhooks.app.scopes_update.jsx` | `app/scopes_update` | `[[webhooks.subscriptions]]` |
| `/webhooks/app/order_created` | `routes/webhooks.app.order_created.jsx` | `orders/create` | `[[webhooks.subscriptions]]` |
| `/webhooks/app/order_fulfilled` | `routes/webhooks.app.order_fulfilled.jsx` | `orders/fulfilled` | `[[webhooks.subscriptions]]` |
| `/webhooks/customers/data_request` | `routes/webhooks.customers.data_request.jsx` | GDPR: customer data request | `compliance_topics` |
| `/webhooks/customers/redact` | `routes/webhooks.customers.redact.jsx` | GDPR: erase customer data | `compliance_topics` |
| `/webhooks/shop/redact` | `routes/webhooks.shop.redact.jsx` | GDPR: erase shop data | `compliance_topics` |
| `/healthz` | `routes/healthz.jsx` | Health probe (app + DB) for Docker/tunnel | not a Shopify setting |

Webhook URIs in the toml are relative; Shopify prefixes them with `application_url`.

To print the live route table: `npx react-router routes`.

## 3. Environment variables

| Variable | Required | Notes |
|---|---|---|
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | yes | `shopify app env show` |
| `SHOPIFY_APP_URL` | yes | your tunnel origin, `https://…`, no trailing slash |
| `SCOPES` | yes | keep in sync with `shopify.app.toml` |
| `APP_PORT` | no | host port, default `3000` |
| `DATABASE_*` | yes | see `.env.example`; compose overrides host/port to `mysql:3306` inside the network |
| `LOG_LEVEL`, `LOG_DIR`, `LOG_FILE` | no | logs go to `./logs/current.log` in both modes |

## 4. Day-to-day

- **Logs**: `tail -f logs/current.log | npx pino-pretty`, or `docker logs -f sigma-loyalty-app-dev` / `sigma-loyalty-app`.
- **New migration** (dev): edit `prisma/schema.prisma`, then on the host run `npx prisma migrate dev --name <change>` (DB on `127.0.0.1:3308`). Both containers run `prisma migrate deploy` on start.
- **Added an npm dependency**: dev keeps `node_modules` in the `app-node-modules` volume, so rebuild it with
  `docker compose --profile dev down && docker volume rm sigma-loyalty_app-node-modules && npm run compose:dev`.
- **Test a webhook** without placing an order:
  ```bash
  shopify app webhook trigger --topic orders/create --api-version 2026-07 \
    --address http://localhost:3000/webhooks/app/order_created --client-secret "$SHOPIFY_API_SECRET"
  ```
- **Changed `shopify.app.toml`** (scopes, webhooks, URLs): run `shopify app deploy` again. Changing scopes asks merchants to re-approve.
