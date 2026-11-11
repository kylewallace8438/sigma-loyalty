---
name: dev-container-sync
description: Required steps to bring the sigma-loyalty-app-dev container up to date after adding, removing or upgrading an npm dependency (package.json / package-lock.json), or after changing docker-compose.yml, .env or the Dockerfile. Also use when the dev container reports "Cannot find module '<pkg>'", is missing an environment variable, or is unhealthy right after such a change.
---

# Dependency or container config change → sync the dev container

The dev container (`sigma-loyalty-app-dev`, compose profile `dev`) does not pick these changes up by itself:

- **npm dependencies**: `node_modules` lives in the `app-node-modules` named volume (Alpine/musl
  builds), not the host's. `npm install` on the host never reaches it, and rebuilding the image
  doesn't refresh an existing volume. Symptom: `Cannot find module '<pkg>' imported from '/app/...'`,
  and an unhealthy container if the import is in `app/entry.server.jsx` (every request fails,
  including `/healthz`).
- **docker-compose.yml / .env / Dockerfile**: a container keeps the environment and image it was
  created with. `docker restart` reuses both; only recreating the container applies the change.

## A. npm dependency added, removed or upgraded

1. Install on the host as usual (`npm install <pkg>`), so `package.json` and `package-lock.json` change.
2. Install into the container's volume from the lockfile, then restart:
   ```bash
   docker exec sigma-loyalty-app-dev npm ci --no-audit --no-fund
   docker restart sigma-loyalty-app-dev
   ```
   Use `npm ci`, not `npm install`: it installs exactly what the lockfile says, builds native
   modules for Alpine, and never rewrites `package-lock.json` (which is bind-mounted from the host).
3. If the container isn't running (so `docker exec` fails), rebuild the volume instead:
   ```bash
   docker compose --profile dev down && docker volume rm sigma-loyalty_app-node-modules && npm run compose:dev
   ```
   `down` also stops MySQL and Redis; their data volumes are kept.

## B. docker-compose.yml, .env or Dockerfile changed

1. **Check for pending migrations first.** The container runs `prisma migrate deploy` on start, so
   recreating it applies every migration in `prisma/migrations` that the dev DB hasn't run yet:
   ```bash
   ls prisma/migrations
   docker exec sigma-loyalty-mysql mysql -usigma -psigma sigma_loyalty -e 'SELECT migration_name FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5' 2>/dev/null
   ```
   If a pending one drops tables or columns that hold data, ask the user before continuing.
2. Recreate the container (the build can take several minutes, so run it in the background):
   ```bash
   docker compose --profile dev up -d --build app-dev
   ```
   It also starts `mysql` and `redis` if they aren't running.

## Verify (A and B)

```bash
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' sigma-loyalty-app-dev); [ "$s" = healthy ] && break; sleep 3; done; echo "health: $s"
curl -s -o /dev/null -w 'healthz: %{http_code}\n' http://127.0.0.1:3000/healthz
docker logs --since 5m sigma-loyalty-app-dev 2>&1 | grep -i -E 'error|cannot find' | head
```
- A: the package exists in the volume: `docker exec sigma-loyalty-app-dev ls -d node_modules/<pkg>`.
- B: the container was recreated (`docker ps --format '{{.Names}} {{.CreatedAt}}' | grep app-dev`)
  and has the new values (`docker exec sigma-loyalty-app-dev sh -c 'env | grep <VAR>'`).
- If the change involves Redis/BullMQ: the worker is connected, i.e.
  `docker exec sigma-loyalty-redis redis-cli client list` shows a `bull:` client and
  `redis-cli --scan --pattern 'bull:webhooks:*'` returns keys.

Tell the user what was synced and what you verified. Don't start, stop or recreate the production
container (`sigma-loyalty-app`, profile `prod`) without asking.
