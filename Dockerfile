# syntax=docker/dockerfile:1
FROM oven/bun:1.4.2 AS bun

FROM node:24-bookworm-slim AS base
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

FROM base AS dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN bun run typecheck && NITRO_PRESET=node-server bun run build

FROM base AS production-dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# One-shot auth migration job; never invoked by the HTTP process.
FROM base AS migrate
ENV NODE_ENV=production
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY scripts/auth-migrate.ts ./scripts/auth-migrate.ts
COPY scripts/sync-access.ts ./scripts/sync-access.ts
COPY scripts/billing-reconcile.ts ./scripts/billing-reconcile.ts
COPY src/contracts ./src/contracts
COPY src/server/billing ./src/server/billing
COPY src/server/api ./src/server/api
COPY src/server/auth/config.ts src/server/auth/options.ts src/server/auth/desktop-client.ts src/server/auth/desktop-access.ts src/server/auth/desktop-session.ts ./src/server/auth/
COPY src/server/db/migrate.ts ./src/server/db/
COPY migrations ./migrations
USER node
CMD ["bun", "scripts/auth-migrate.ts", "--apply"]

# Final/default image also works as a Railway Dockerfile deployment.
FROM node:24-bookworm-slim AS service
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
