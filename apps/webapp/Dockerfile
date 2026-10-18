# syntax=docker/dockerfile:1

# Multi-stage production image for the Next.js webapp.
#
# Stage 1 (`builder`)  installs all dependencies and runs `next build`.
# Stage 2 (`runtime`)  production dependencies only, plus the built output.
#
# The default target is `runtime`.

###############################################################################
# Stage 1 - builder
###############################################################################
FROM node:20-bookworm-slim AS builder

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# ── Build-time (baked into the client bundle, immutable afterwards) ──────────
# Next.js inlines every NEXT_PUBLIC_* variable into the JavaScript bundle at
# build time. Changing one after the build has no effect on the client, so they
# are declared as build ARGs rather than runtime environment variables. Passing
# them at `docker build` time, or at `docker compose build`, is the only point at
# which they still matter.
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ARG NEXT_PUBLIC_STELLAR_EXPLORER_URL=https://stellar.expert/explorer

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_STELLAR_EXPLORER_URL=$NEXT_PUBLIC_STELLAR_EXPLORER_URL

# ── Runtime-only (read by server components and API routes, never bundled) ────
# BACKEND_API_URL is read at request time from the server's environment, so it
# can be changed on a running container without a rebuild. It is set here too so
# the build does not fail on a missing-variable check with a localhost default.
ARG BACKEND_API_URL=http://backend:3000
ENV BACKEND_API_URL=$BACKEND_API_URL

# Dependencies first, so a source-only change does not re-run `npm ci`.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# `next build` is the same command Vercel runs, so the image and the hosted
# deployment are built by one process. next.config.js sets
# `eslint.ignoreDuringBuilds`, so lint is a separate step in CI, not a build gate.
RUN npm run build

###############################################################################
# Stage 2 - runtime
###############################################################################
FROM node:20-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="lumenpulse-webapp" \
      org.opencontainers.image.description="Lumenpulse Next.js webapp (production, non-root)" \
      org.opencontainers.image.source="https://github.com/Pulsefy/Lumenpulse"

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# tini is PID 1 so SIGTERM from `docker stop` reaches Next's shutdown handler
# instead of the container being killed after the grace period.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

# Matches the uid/gid used by apps/backend and apps/data-processing, so a shared
# volume between services does not need chowning per service.
RUN groupadd --gid 10001 appuser \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin appuser

WORKDIR /app

# Production dependency tree only. Next.js is in `dependencies`, so
# `npm ci --omit=dev` keeps everything `next start` needs and drops the test
# runner, the linter and the type tooling.
RUN npm ci --omit=dev && npm cache clean --force

# The build output. `.next` holds the server bundle, the route manifests and the
# static chunks; `public/` is served verbatim at the site root; `next.config.js`
# is read at boot for the `headers()` configuration.
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/package.json ./package.json

# Written as uid 10001: Next.js writes incremental build caches into `.next/cache`
# at runtime, and a read-only root-owned directory makes it warn on every request.
RUN chown -R appuser:appuser /app/.next

USER appuser

EXPOSE 3000

# Hits a static asset rather than a page that renders on the server. A health
# check that fetches `/` would report unhealthy whenever the API route it depends
# on is slow, which is a dependency problem, not a webapp problem.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/manifest.json',timeout:4000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
# The binary is invoked directly rather than through `npx`, so start-up does not
# depend on npx resolving (or, on a cold cache, fetching) the package.
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]