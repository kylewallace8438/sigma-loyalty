# Multi-stage image for the Sigma Loyalty app.
#   dev  -> `react-router dev` with HMR; source is bind-mounted by docker-compose
#   prod -> compiled build served by `react-router-serve`
# See docker-compose.yml for how each target is run.

FROM node:22-alpine AS base
# openssl is required by the Prisma schema engine (migrations)
RUN apk add --no-cache openssl
WORKDIR /app
RUN chown node:node /app
USER node

# ---------- dependencies (dev + prod) ----------
FROM base AS deps
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node extensions ./extensions
RUN npm ci && npm cache clean --force

# ---------- dev: HMR ----------
FROM deps AS dev
ENV NODE_ENV=development
EXPOSE 3000
# Source code is bind-mounted at runtime; node_modules stays in the image/volume
CMD ["npm", "run", "docker:dev"]

# ---------- build ----------
FROM deps AS build
COPY --chown=node:node . .
RUN npx prisma generate && npm run build

# ---------- prod ----------
FROM base AS prod
ENV NODE_ENV=production
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node extensions ./extensions
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node prisma.config.ts ./
COPY --chown=node:node --from=build /app/build ./build
RUN npx prisma generate
EXPOSE 3000
CMD ["npm", "run", "docker-start"]
