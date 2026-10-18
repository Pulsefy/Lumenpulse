# syntax=docker/dockerfile:1

# Multi-stage image for the NestJS backend.
#
# Stage 1 (`builder`)  full toolchain + dev dependencies, compiles TypeScript.
# Stage 2 (`migrate`)  the builder output kept runnable, used only by the one-shot
#                      migration step in docker-compose. Carries dev dependencies
#                      on purpose -- see the note above that stage.
# Stage 3 (`runtime`)  the deployable image. No compiler, no dev dependencies.
#
# The default target is `runtime`; CI and the compose `migrate` service name the
# others explicitly.

###############################################################################
# Stage 1 - builder
###############################################################################
FROM node:20-bookworm-slim AS builder

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# Build toolchain only. bcrypt, speakeasy and sharp have native parts that
# compile from source when no prebuilt binary matches the platform. This layer
# never reaches the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# package.json and the lockfile first, so the dependency layer is only rebuilt
# when a dependency actually changes rather than on every source edit.
COPY package.json package-lock.json ./

# `npm ci` is the same command CI uses, so the image cannot drift from the lockfile
# the tests were run against.
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
COPY scripts ./scripts
# `npm run build` is `nest build && npm run openapi:generate`, and the second half
# needs the compiled dist/ to exist. Both are in package.json already.
RUN npm run build

# `nest build` emits into dist/. The runtime stage needs dist/, package.json and a
# production-only node_modules; everything else above is build input.

###############################################################################
# Stage 2 - migrate
###############################################################################
# The migration toolchain is a devDependency: `migration:run` is
# `typeorm-ts-node-commonjs -d src/database/data-source.ts`, which needs
# `typeorm`, `ts-node` and `tsconfig-paths` -- none of which are in `dependencies`.
#
# Rather than shipping those three packages inside the long-running service image,
# the migration runner gets its own stage. It is built from `builder`, so it has
# the full node_modules and the compiled dist/, and it is used only by a container
# that runs migrations and exits. Nothing deployed serves traffic from it.
#
# If the backend ever stops needing ts-node to migrate, this stage collapses into
# `runtime` and the compose file loses its `target:` line.
FROM builder AS migrate

WORKDIR /app
CMD ["npm", "run", "migration:run"]

###############################################################################
# Stage 3 - runtime
###############################################################################
FROM node:20-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="lumenpulse-backend" \
      org.opencontainers.image.description="Lumenpulse NestJS API (production, non-root)" \
      org.opencontainers.image.source="https://github.com/Pulsefy/Lumenpulse"

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# No build-essential and no python3: nothing in this image compiles anything.
# `tini` is the only addition -- PID 1 signal forwarding, so SIGTERM from
# `docker stop` reaches Nest's shutdown hooks and in-flight requests drain
# instead of being severed. Without it the container always takes the full
# grace period to stop.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

# Unprivileged user, uid/gid 10001, matching apps/data-processing.
RUN groupadd --gid 10001 appuser \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin appuser

WORKDIR /app

# Production dependency tree only. Copied from the builder so the versions are
# identical to the ones the build and the test suite were run against, while the
# devDependencies (~600 MB of TypeScript, Jest and ESLint) stay behind.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# openapi.json is committed to the repository and verified by backend.yml. It is
# not read at runtime (the spec is generated in-process by createOpenApiDocument),
# but it is copied so the container can be inspected against the same artefact CI
# checks.
COPY openapi.json ./openapi.json

# NODE_ENV=production above makes @nestjs/config skip the .env file entirely --
# config.ts only loads .env.local, and only when NODE_ENV is development. All
# configuration reaches the container as real environment variables, so no .env
# file is copied in and none can leak into the image.
USER appuser

EXPOSE 3000

# /health/live answers as soon as the HTTP server is bound and never touches a
# dependency, which is the right thing for a liveness probe: Postgres being slow
# must not make Docker restart the process.
#
# /health (the readiness endpoint) checks Postgres, Redis, Horizon, Soroban and
# data-processing. It is deliberately NOT used here -- the service would be
# marked unhealthy whenever an upstream is briefly unavailable, and the stack's
# own dependency wiring (depends_on: service_healthy) already covers that case.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/health/live',timeout:4000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# `-tini` as PID 1, `--enable-source-maps` so a production stack trace points at
# the original TypeScript line.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/main.js"]