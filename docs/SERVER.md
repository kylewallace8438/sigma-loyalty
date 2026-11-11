# Running Sigma Loyalty as a server

The app runs in Docker behind your own Cloudflare tunnel, without Shopify CLI's temporary tunnel. The same `docker-compose.yml` runs it in two modes:

| Mode | Command | What runs |
|---|---|---|
| **dev (HMR)** | `npm run compose:dev` | `react-router dev`; source is bind-mounted, so edits hot-reload |
| **prod (build)** | `npm run compose:prod` | `npm run build`, then `react-router-serve` (detached) |
| stop | `npm run compose:down` | stops both app profiles (MySQL and Redis keep running) |
| DB only | `docker compose up -d mysql redis` | MySQL on `127.0.0.1:3308` and Redis on `127.0.0.1:6380`, for running the app on the host |

Both modes publish the app on **`http://localhost:${APP_PORT:-3000}`**. Only one mode can run at a time because they share that port.

```
Shopify admin / storefront
        │  https://<your-domain>
        ▼
Cloudflare tunnel  ──►  http://localhost:3000  ──►  app container (dev or prod)
                                                        │
                                     ┌──────────────────┴──────────────────┐
                                     ▼                                     ▼
                         mysql container (mysql:3306)          redis container (redis:6379)
                                                                 webhook job queue
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

Every webhook route only verifies the HMAC and queues the webhook in Redis (BullMQ queue `webhooks`, job id = Shopify's `X-Shopify-Webhook-Id`), then answers 200. A worker started with the app (`app/services/webhooks/queue.server.js`) runs the per-topic handler from `app/services/webhooks/handlers.server.js`, retrying failures 8 times with exponential backoff (10s, 20s, … about 21 min in total). If Redis can't be reached within 3s the route answers 500 and Shopify re-sends the webhook. Handlers must be idempotent: a job can run more than once. To handle a new topic, add its route (copy an existing one) and a handler keyed by the topic as `authenticate.webhook()` returns it, e.g. `ORDERS_PAID`.

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
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_TLS` | yes | webhook queue; compose overrides host/port to `redis:6379` inside the network. `REDIS_URL` overrides them all |
| `WEBHOOK_CONCURRENCY` | no | webhook jobs processed at the same time, default `5` |
| `ORDER_RETENTION_DAYS` | no | stored orders older than this are deleted daily, default `30` |

## 4. Day-to-day

- **Logs**: `tail -f logs/current.log | npx pino-pretty`, or `docker logs -f sigma-loyalty-app-dev` / `sigma-loyalty-app`.
- **New migration** (dev): edit `prisma/schema.prisma`, then on the host run `npx prisma migrate dev --name <change>` (DB on `127.0.0.1:3308`), then `docker restart sigma-loyalty-app-dev`. Both containers run `prisma generate` and `prisma migrate deploy` on start; until the dev container restarts, its Prisma Client doesn't know the new models (`db.<model>` is `undefined`).
- **Added an npm dependency**: dev keeps `node_modules` in the `app-node-modules` volume, so a host `npm install` doesn't reach it (`Cannot find module '<pkg>'`). Install from the lockfile inside the container and restart:
  `docker exec sigma-loyalty-app-dev npm ci && docker restart sigma-loyalty-app-dev`.
  If the container isn't running, rebuild the volume instead:
  `docker compose --profile dev down && docker volume rm sigma-loyalty_app-node-modules && npm run compose:dev`.
- **Changed `docker-compose.yml`, `.env` or the `Dockerfile`**: a container keeps the environment and image it was created with, so `docker restart` isn't enough. Recreate it with `docker compose --profile dev up -d --build app-dev` (this also runs any pending migrations).
- **Test a webhook** without placing an order:
  ```bash
  shopify app webhook trigger --topic orders/create --api-version 2026-07 \
    --address http://localhost:3000/webhooks/app/order_created --client-secret "$SHOPIFY_API_SECRET"
  ```
- **Inspect the webhook queue**: `docker exec sigma-loyalty-redis redis-cli zrange bull:webhooks:failed 0 -1` lists failed job ids; `redis-cli hgetall bull:webhooks:<job id>` shows a job's data and `failedReason`. Failed jobs are kept 7 days, completed ones 1 day.
- **Changed `shopify.app.toml`** (scopes, webhooks, URLs): run `shopify app deploy` again. Changing scopes asks merchants to re-approve.
