# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# BillFlow — backend API image
# Build context: the REPOSITORY ROOT (the API depends on packages/core).
#   docker build -f backend/Dockerfile .
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

# Workspace manifests only, so dependency layers stay cached between code changes.
FROM base AS manifests
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

# ── build ────────────────────────────────────────────────────────────────────
FROM manifests AS build
RUN npm ci -w @skr/core -w backend --no-audit --no-fund
COPY packages/core packages/core
COPY backend backend
# "prebuild" compiles @skr/core first; "build" runs prisma generate + tsc.
RUN npm run build -w backend

# ── production dependencies ──────────────────────────────────────────────────
FROM manifests AS prod-deps
COPY backend/prisma backend/prisma
RUN npm ci -w backend --omit=dev --no-audit --no-fund \
 && cd backend && npx prisma generate \
 && npm cache clean --force

# ── runtime ──────────────────────────────────────────────────────────────────
FROM base AS runtime
# Optional override; the version normally comes from package.json.
ARG APP_VERSION=
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    DATA_DIR=/app/data \
    APP_VERSION=${APP_VERSION}

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/core/package.json ./packages/core/package.json
COPY --from=build --chown=node:node /app/packages/core/dist ./packages/core/dist
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --chown=node:node backend/prisma ./backend/prisma
COPY --chown=node:node backend/package.json backend/docker-entrypoint.sh ./backend/
RUN chmod 0755 backend/docker-entrypoint.sh \
 && mkdir -p /app/data \
 && chown node:node /app/data

WORKDIR /app/backend
USER node
EXPOSE 4000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health/ready >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--", "./docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]

LABEL org.opencontainers.image.title="BillFlow API" \
      org.opencontainers.image.description="Self-hosted bill & event calendar — backend API" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${APP_VERSION}"
