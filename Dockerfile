ARG NODE_VERSION=26

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-slim AS web
WORKDIR /build
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY vite.config.ts ./
COPY web ./web
RUN npx vite build

FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

FROM node:${NODE_VERSION}-slim
LABEL org.opencontainers.image.title="MoeCloud" \
  org.opencontainers.image.description="Selbst gehostete Cloud für deine Dateien mit Weboberfläche, Freigaben, WebDAV und Virenscan" \
  org.opencontainers.image.source="https://github.com/MaximilianGT500/moecloud" \
  org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
  PORT=3000 \
  DATA_DIR=/data \
  MOECLOUD_INSTALL=docker \
  NODE_OPTIONS=--disable-warning=ExperimentalWarning
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends tini ffmpeg poppler-utils \
  && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/*
WORKDIR /opt/moecloud
COPY --from=deps /deps/node_modules ./node_modules
COPY --from=web /build/dist/web ./dist/web
COPY package.json cli.ts ./
COPY src ./src
COPY public ./public
COPY docker/entrypoint.sh /usr/local/bin/moecloud-entrypoint
COPY docker/moecloud /usr/local/bin/moecloud
RUN chmod -R a+rX package.json cli.ts src public dist \
  && chmod 755 /usr/local/bin/moecloud-entrypoint /usr/local/bin/moecloud \
  && mkdir -p /data
EXPOSE 3000
VOLUME ["/data"]
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/healthz`).then((res) => process.exit(res.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["tini", "--", "moecloud-entrypoint"]
CMD ["node", "src/server.ts"]
