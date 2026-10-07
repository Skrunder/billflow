# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# SKR's Bill Calendar — frontend image
# Builds the React PWA and serves it with an unprivileged nginx that also
# reverse-proxies /api to the backend container. Runs as uid 101, port 8080.
# ─────────────────────────────────────────────────────────────────────────────
ARG NODE_VERSION=22-alpine
ARG NGINX_VERSION=1.27-alpine

FROM node:${NODE_VERSION} AS build
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:${NGINX_VERSION} AS runtime
ARG APP_VERSION=1.0.0
ENV BACKEND_URL=http://backend:4000 \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/conf.d

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

LABEL org.opencontainers.image.title="SKR's Bill Calendar Web" \
      org.opencontainers.image.description="Self-hosted bill & event calendar — web frontend (PWA)" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${APP_VERSION}"
