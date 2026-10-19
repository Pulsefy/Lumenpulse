# Releasing

Releases are cut on demand from `main` with the **Release** workflow
(`.github/workflows/release.yml`).

```bash
gh workflow run release.yml -f bump=patch          # v1.2.3 -> v1.2.4
gh workflow run release.yml -f bump=minor -f dry-run=true
```

## Versioning

Tags are `vMAJOR.MINOR.PATCH`. The next version is derived from the latest tag
and the chosen bump (`scripts/release/next-version.mjs`); the first release is
`v0.1.0`.

## What a release produces

| Output | Where |
| --- | --- |
| Contract WASM files and their SHA-256 hashes (`wasm-hashes.json`) | GitHub release assets |
| Container images `lumenpulse-backend`, `-webapp`, `-data-processing` tagged with the version | `ghcr.io/<owner>/` |
| SBOM (SPDX) | GitHub release assets |
| Changelog grouped by app (`scripts/release/changelog.mjs`, built from merged PRs and the files they touch) | Release notes |
| Release manifest (`release-manifest.json`) tying version, commit, images and WASM hashes together | GitHub release assets |

A `dry-run` runs every build and check but does not push images, tag or publish.

## Identifying what is running

Every image carries `APP_VERSION` and `GIT_SHA` as environment variables and as
`org.opencontainers.image.version` / `.revision` labels. The backend reports them
in `GET /health` under `release`:

```json
{ "release": { "version": "v1.2.4", "gitSha": "3f2c1ab..." } }
```

Locally built images report `dev` / `unknown`. Contract deployments are identified
by the WASM hash recorded in the deployment record (see `DEPLOYMENT.md`).
