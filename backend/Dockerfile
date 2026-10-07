# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# SKR's Bill Calendar — backend API image
# Multi-stage: build with dev dependencies, ship only production deps + dist.
# Runs as the unprivileged "node" user (uid 1000).
# ─────────────────────────────────────────────────────────────────────────────
ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
# openssl: required by Prisma engines · tini: proper PID 1 signal handling
RUN apk add --no-cache openssl tini
WORKDIR /app
ENV CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# ── build ────────────────────────────────────────────────────────────────────
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate && npx tsc -p tsconfig.build.json

# ── production dependencies ──────────────────────────────────────────────────
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --no-audit --no-fund \
 && npx prisma generate \
 && npm cache clean --force

# ── runtime ──────────────────────────────────────────────────────────────────
FROM base AS runtime
ARG APP_VERSION=1.0.0
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    DATA_DIR=/app/data \
    APP_VERSION=${APP_VERSION}

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node package.json docker-entrypoint.sh ./
RUN chmod 0755 docker-entrypoint.sh \
 && mkdir -p /app/data \
 && chown node:node /app/data

USER node
EXPOSE 4000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health/ready >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--", "./docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]

LABEL org.opencontainers.image.title="SKR's Bill Calendar API" \
      org.opencontainers.image.description="Self-hosted bill & event calendar — backend API" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${APP_VERSION}"
