---
name: prisma-migration
description: Required steps after any change to prisma/schema.prisma in this repo (new table/model, new or changed column, index, relation). Creates and applies the migration, then restarts the dev app container so it regenerates the Prisma Client. Use whenever you edit the Prisma schema, before testing webhooks or routes that touch the new model.
---

# Prisma schema change → migrate → restart

The `sigma-loyalty-app-dev` container generates the Prisma Client only when it starts
(`npm run docker:dev` = `prisma generate && prisma migrate deploy && react-router dev`), and
`app/db.server.js` caches one client on `global.prismaGlobal` across hot reloads. Until the
container restarts, new models are `undefined` (e.g. `db.order.updateMany` → `TypeError: Cannot
read properties of undefined`), and webhook handlers fail with a 500 that only shows in
`docker logs`, not `logs/app.*.log`.

After editing `prisma/schema.prisma`, always do all of these steps:

1. **Create and apply the migration** (on the host; the dev DB is the `sigma-loyalty-mysql` container on `127.0.0.1:3308`):
   ```bash
   npx prisma migrate dev --name <snake_case_change>
   npx prisma generate
   ```
   Read the generated `prisma/migrations/<timestamp>_<name>/migration.sql` and check that it is what you intended.

2. **Restart the dev app container and wait until it is healthy**:
   ```bash
   docker restart sigma-loyalty-app-dev
   for i in $(seq 1 30); do s=$(docker inspect -f '{{.State.Health.Status}}' sigma-loyalty-app-dev); [ "$s" = healthy ] && break; sleep 3; done; echo "health: $s"
   ```

3. **Verify**:
   - `docker logs --since 3m sigma-loyalty-app-dev 2>&1 | grep -E 'Generated Prisma Client|migrat|Error'` shows the client was regenerated and no migration errors.
   - The table exists: `docker exec sigma-loyalty-mysql mysql -usigma -psigma sigma_loyalty -e 'SHOW TABLES'`.

4. **Tests**: if the new model is used in code under test, add it to `MODELS` in `test/mocks/db.js`, then run `npm test`.

Tell the user that the migration was applied and the container restarted. The production
container (`sigma-loyalty-app`) runs `prisma migrate deploy` on its next start/deploy; don't
restart it without asking.
