# Staging and PR previews

## Staging

`.github/workflows/staging.yml` tracks `main`. On every merge that touches the apps
it builds the backend and webapp images, pushes them to GHCR as `:staging` and
`:sha-<commit>`, copies `docker-compose.staging.yml` to the staging host and rolls
the stack on that exact SHA. The UI shows a *Staging* banner
(`NEXT_PUBLIC_ENV_LABEL`).

One-time setup in the `staging` GitHub environment:

| Kind | Name |
| --- | --- |
| Secret | `STAGING_SSH_HOST`, `STAGING_SSH_KEY` (user `deploy`) |
| Variable | `STAGING_API_URL` - public URL of the staging backend |

On the host, `~/lumenpulse-staging/.env` holds the database, Redis, JWT and Stellar
settings. If `STAGING_SSH_HOST` is unset the deploy job is skipped.

## Pull-request previews

`.github/workflows/preview.yml` gives every same-repository PR that touches
`apps/webapp/` its own webapp at `https://pr-<number>.<PREVIEW_DOMAIN>`, posts the
URL as a PR comment (updated on each push) and removes it when the PR closes. The
preview shows a *Preview - PR #n* banner and uses the shared staging backend.
Fork PRs get no preview because they cannot use environment secrets.

Setup in the `preview` environment: secrets `PREVIEW_SSH_HOST`, `PREVIEW_SSH_KEY`;
variables `PREVIEW_DOMAIN` (with a wildcard DNS record to the host), `STAGING_API_URL`,
optionally `PREVIEW_MAX_ACTIVE`. The host runs a Traefik instance on the Docker
network `preview-proxy` with a `letsencrypt` certificate resolver.

## Cost

Each preview is one container limited to 384 MB (about 256 MB in practice) and builds
reuse the GitHub Actions layer cache. At most `PREVIEW_MAX_ACTIVE` (default 5)
previews exist; starting another removes the oldest. Five previews therefore fit
in roughly 2 GB of RAM on the staging host, with no per-preview database or backend.
