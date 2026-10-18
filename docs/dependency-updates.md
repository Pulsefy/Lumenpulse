# Automated dependency updates

`.github/dependabot.yml` keeps dependencies current across all five dependency
trees in the repository. This document explains the configuration and, more
importantly, the exclusions.

| | |
|---|---|
| Issue | [#1716](https://github.com/Pulsefy/Lumenpulse/issues/1716) |
| Config | `.github/dependabot.yml` |
| Introduced | 2026-10-18 |

> **Read this before removing an `ignore` entry.** Every one of them exists
> because an unattended bump of that dependency produced a merge that passed
> review and failed in production. They are not timidity.

---

## What is configured

| Ecosystem | Directory | Manifest it updates | What CI installs |
|---|---|---|---|
| npm | `/apps/backend` | `package-lock.json` | `npm ci` in `backend.yml` |
| npm | `/apps/webapp` | `package-lock.json` | `npm ci` in `backend.yml` (api-types check) |
| npm | `/apps/mobile` | `package-lock.json` | `npm ci` in `mobile.yml` |
| npm | `/scripts` | `package-lock.json` | `npm ci --prefix ../../scripts` in `onchain.yml` |
| pip | `/apps/data-processing` | `requirements.txt` | `pip install --require-hashes -r requirements.lock` |
| cargo | `/apps/onchain` | `Cargo.toml` + `Cargo.lock` | `cargo build/test` in `onchain.yml` |
| github-actions | `/` | workflow `uses:` refs | itself |

## Cadence

**Weekly, Monday 07:00 UTC.** Dependabot is a backlog, not an alarm. A daily
schedule on a repository with this many contributors produces a PR on almost
every weekday, and a PR nobody reads trains the team to close bot PRs without
looking — which is exactly the failure mode [#1593](https://github.com/Pulsefy/Lumenpulse/issues/1593)
(vulnerability scanning) is trying to prevent.

`open-pull-requests-limit` is capped at 3-5 per ecosystem. The cap is a
backpressure valve: when the queue is full, Dependabot stops opening new PRs
rather than burying the existing ones.

**Security updates ignore all of the above.** They are raised immediately,
whatever the weekly schedule says, and they land in their own `*-security`
group so a routine patch batch is never holding them up. Nothing in the
`ignore` blocks applies to security updates unless it names the dependency
outright — an ignored package with a known CVE will not be raised
automatically, which is the intended trade.

## Grouping

Three groups per ecosystem:

| Group | Scope | Why |
|---|---|---|
| `<eco>-patch` | patch only | Same major, no API surface change. Twenty of these is one review, not twenty. |
| `<eco>-minor` | minor only | Inside one major line. Real changes, but routine — still a human reads it. |
| `<eco>-security` | security updates, minor + patch | Urgent, so never batched behind routine work. |

**Majors are never grouped.** A major bump is a decision, not maintenance.
Folding one into a patch batch is how a breaking change gets approved by
someone who was reading about an unrelated typo fix.

---

## Exclusions

### The root `pnpm-lock.yaml` is not updated at all

There is no Dependabot entry for `/`. That is deliberate.

`pnpm-lock.yaml` at the root is a full workspace lockfile covering `.`,
`apps/backend`, `apps/mobile`, `apps/webapp` and `scripts`. But no CI job
installs it — every workflow runs `npm ci` against a **per-app**
`package-lock.json`. An npm entry at `/` would regenerate the workspace
lockfile and open a PR touching 800 kB of resolutions that changes nothing
about what CI builds or runs, while competing with the per-app entries for the
same updates.

The root `package.json` holds four devDependencies (`turbo`, `ts-node`,
`tsconfig-paths`, `@types/node`) used only by `scripts/lint.mjs` and the root
task orchestration. If these need to move, move them by hand in the same PR
that needs them.

### The data-processing lockfiles are outside Dependabot's reach

`requirements.lock` is installed with `--require-hashes` in both
`data-processing.yml` and the Dockerfile: every transitive package must match a
pinned sha256 or the build fails. Dependabot cannot regenerate those hashes, so
an automated edit would produce a lockfile that installs nowhere.

It is safe to leave alone because Dependabot's pip updater discovers
`requirements.txt` and `requirements/*.txt` — not `requirements.lock` or
`requirements-docker.in`. The lockfiles are simply invisible to it.

#### Refreshing the lockfiles

When a Dependabot PR changes `requirements.txt` and the lockfile needs to match:

```bash
cd apps/data-processing
pip install --require-hashes --generate-hashes -r requirements.txt -r requirements-docker.in
# commit requirements.lock alongside the Dependabot PR, or as a follow-up
```

The hashes are the point of the file. Do not regenerate it casually; a lockfile
that drifts from `requirements.txt` means CI is no longer testing what the
manifest says.

### `apps/webapp` and Vercel

The webapp deploys on Vercel. That deployment path is invisible to CI and to
Dependabot alike, so a major `next` bump would pass every check in this
repository and fail only in the Vercel build. Next majors, and React majors
alongside them, are held back for a hand-run migration PR. The
`@next/swc-wasm-nodejs` pin is held at its exact version for the same reason —
it must track the app's Next version exactly.

See [MOBILE_RELEASE_AND_OTA.md](MOBILE_RELEASE_AND_OTA.md) for the equivalent
mobile process.

### `apps/mobile` and the size budget

`mobile.yml` enforces a payload size budget against `expo export` output.
Expo SDK and React Native releases change the native project layout, the config
plugin API and the bundle format — and therefore the payload size. An
unattended Expo bump that crosses the budget fails CI for a reason that has
nothing to do with the change under review, which is how real regressions get
lost in noise. Those releases go through the OTA runbook by hand.

`react-native-reanimated` is held even at minor: it ships native code, so a
minor can change the worklet runtime and break the UI on device while every JS
test still passes.

### `apps/onchain` and the WASM manifest

`soroban-sdk` majors change the host-function ABI and the guest/host
serialisation format. The compiled WASM is hash-pinned in a manifest that CI
verifies, so a bump rewrites every contract hash simultaneously — and any
contract already deployed with the old format is not upgrade-compatible with
one built against the new SDK. That is a coordinated release, not a dependency
bump.

`soroban-sdk` minors are excluded for the same reason: within v23 the SDK still
moves host interfaces.

`zeroize_derive` is held because the whole reason `rust-toolchain.toml` pins
1.85.0 is that `soroban-sdk` 23 pulls in a `zeroize_derive` using Cargo
edition 2024. A transitive bump that needs a newer compiler breaks the contract
build for every contributor at once, on every branch.

### `scripts/binaryen` and the deploy artefact

`binaryen` is pinned to an exact version (`132.0.0`) because
`wasm:optimize` runs in `onchain.yml` and its output is the WASM that
`deploy.ts` uploads. A different binaryen produces different bytes for the same
input, which changes every hash in the contract manifest for no functional
reason.

### Stellar SDK majors, everywhere

The SDK is a dependency in `apps/backend`, `apps/webapp`, `apps/mobile` and
`scripts`, and majors are excluded in all four. Transaction envelope encoding
and signing semantics both move across a major. Every hash and signature the
platform produces depends on them staying put across a release; bump by hand,
with a testnet rehearsal, following
[SOROBAN_MIGRATION_NOTES.md](SOROBAN_MIGRATION_NOTES.md).

### Authentication and image-processing majors

`bcrypt` majors change hashing parameters and cost factors, silently
invalidating every stored password hash at deploy time. `speakeasy` majors
change TOTP derivation, which does the same to every active 2FA enrolment.
`sharp` majors move libvips underneath it, changing image output encoding
without changing any API. None of these fail a test suite; all of them are
user-visible immediately.

---

## Reviewing a Dependabot PR

A bot PR is not exempt from this repository's review rules. Specifically:

- **Read the changelog for the version being bumped**, not just the diff. Per
  §8 of the [contributor review guide](contributor-pr-review-guide.md), a
  dependency bump requires a changelog link and green CI on the branch.
- **A PR that is larger than expected is a signal.** A "patch" group that
  touches fifty packages usually means a minor was grouped with it, or a
  transitive resolution moved. Check before approving.
- **Never batch a major into a patch PR** by editing the grouping. Open it
  separately with its own issue.
- **For onchain, check the manifest diff.** Any change to
  `contracts/manifest.json` or the recorded WASM hashes is release engineering
  and needs the corresponding review, not a routine approval.

## Operational notes

- Dependabot runs with a service account, so its PRs are authored by
  `dependabot[bot]`. CODEOWNERS still applies to them — the owner is still
  requested, which is the point of the mapping in `.github/CODEOWNERS`.
- `Dependabot security updates` are enabled automatically by the presence of
  this file; no separate toggle is needed. They cannot be grouped with
  non-security updates, which is why the `*-security` groups use
  `applies-to: security-updates`.
- If Dependabot opens a PR that CI cannot possibly pass for a known reason,
  the right fix is an `ignore` entry with that reason written next to it — not
  `continue-on-error` in the workflow.
- Pull requests in `apps/backend` run `npm run audit:ci` in CI (#1593). Un-allowlisted
  or expired high and critical vulnerabilities fail the build. Unavoidable findings
  are tracked in `audit-allowlist.json` with an explicit reason and expiration date.
  Extending scanning to webapp, mobile, data-processing, and onchain is tracked in #1759.