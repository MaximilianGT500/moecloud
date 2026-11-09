ARG NODE_VERSION=26

FROM mwader/static-ffmpeg:9.0.2-1 AS ffmpeg

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-slim AS web
WORKDIR /build
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY vite.config.ts ./
COPY web ./web
RUN npx vite build

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-slim AS deps
ARG TARGETARCH
WORKDIR /deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  case "${TARGETARCH:-$(uname -m)}" in \
    amd64 | x86_64) cpu=x64 ;; \
    arm64 | aarch64) cpu=arm64 ;; \
    *) echo "Für ${TARGETARCH} gibt es kein Image" >&2 && exit 1 ;; \
  esac \
  && npm ci --omit=dev --no-audit --no-fund --os=linux --cpu="$cpu" --libc=glibc \
  && rm -rf node_modules/@img/sharp-wasm32 node_modules/@img/*musl* \
  && find node_modules/argon2/prebuilds -mindepth 1 -maxdepth 1 ! -name "linux-$cpu" -exec rm -rf {} + \
  && find node_modules/argon2/prebuilds -name '*.musl.node' -delete \
  && find node_modules -type f \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.map' -o -iname '*.md' \) -delete

FROM node:${NODE_VERSION}-slim
ARG VERSION=dev
LABEL org.opencontainers.image.title="MoeCloud" \
  org.opencontainers.image.description="Selbst gehostete Cloud für deine Dateien mit Weboberfläche, Freigaben, WebDAV und Virenscan" \
  org.opencontainers.image.source="https://github.com/MaximilianGT500/moecloud" \
  org.opencontainers.image.url="https://moecloud.moestudio.net" \
  org.opencontainers.image.documentation="https://github.com/MaximilianGT500/moecloud#readme" \
  org.opencontainers.image.vendor="MoeStudio" \
  org.opencontainers.image.version="${VERSION}" \
  org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
  PORT=3000 \
  DATA_DIR=/data \
  MOECLOUD_INSTALL=docker \
  NODE_OPTIONS=--disable-warning=ExperimentalWarning
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  rm -f /etc/apt/apt.conf.d/docker-clean \
  && apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends tini poppler-utils \
  && rm -rf /usr/share/doc/* /usr/share/man/* /usr/share/info/* /usr/share/lintian/*
COPY --from=ffmpeg /ffmpeg /ffprobe /usr/local/bin/
WORKDIR /opt/moecloud
COPY --from=deps /deps/node_modules ./node_modules
COPY --from=web /build/dist/web ./dist/web
COPY package.json cli.ts ./
COPY src ./src
COPY public ./public
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/moecloud-entrypoint
COPY --chmod=755 docker/moecloud /usr/local/bin/moecloud
RUN chmod -R a+rX package.json cli.ts src public dist \
  && mkdir -p /data
EXPOSE 3000
VOLUME ["/data"]
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/healthz`).then((res) => process.exit(res.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["tini", "--", "moecloud-entrypoint"]
CMD ["node", "src/server.ts"]
