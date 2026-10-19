# Reusable setup actions

Checkout, runtime setup, caching and install used to be copied into every job.
Eleven copies drifted: cache keys differed between workflows, `mobile-size` listed
two lockfiles while its siblings listed one, and bumping Node meant editing every
file. They now live in two composite actions.

| | |
|---|---|
| Issue | [#1721](https://github.com/Pulsefy/Lumenpulse/issues/1721) |
| Actions | [`setup-node-app`](../.github/actions/setup-node-app/action.yml), [`setup-python-app`](../.github/actions/setup-python-app/action.yml) |
| Version files | [`.nvmrc`](../.nvmrc) (`20`), [`.python-version`](../.python-version) (`3.9`) |

## Usage

```yaml
steps:
  - uses: actions/checkout@<sha> # vX.Y.Z
  - uses: ./.github/actions/setup-node-app
    with:
      working-directory: apps/backend
```

`setup-node-app` reads the Node version from `.nvmrc`, enables the npm cache keyed on
`<working-directory>/package-lock.json`, and runs `npm ci` there. Options:

| Input | Default | Use |
|---|---|---|
| `working-directory` | required | App directory, e.g. `apps/mobile` |
| `cache-dependency-path` | `<working-directory>/package-lock.json` | Extra lockfiles, e.g. the base branch in `mobile-size` |
| `install` | `true` | `false` to skip `npm ci` |
| `root-workspace` | `false` | Also `npm install` at the repo root (Metro needs it for `expo export` / `expo start --web`) |

`setup-python-app` does the same for pip: version from `.python-version`, cache keyed on
`<working-directory>/requirements.lock` (the file CI actually installs; the previous
default hashed `requirements.txt`, which is not what gets installed).

## Why checkout stays in the job

GitHub resolves a local action from the runner's disk, so the repository must already be
checked out when the job reaches `uses: ./.github/actions/...`. The checkout step is the one
line that cannot move into the action. `scripts/check-local-action-order.mjs` fails the
build when a job calls a local action before its checkout; that mistake had broken Mobile,
Data Processing and Onchain CI on `main`.

## Rust

Rust has no equivalent action. Only `onchain.yml` builds Rust, the compiler is already
pinned in one place (`apps/onchain/rust-toolchain.toml`, mirrored by the `toolchain:` input)
and `Swatinem/rust-cache` is a single step, so an action would wrap two lines in twenty.
Revisit if a second Rust workflow appears.

## Cache keys

Every Node job now derives its npm cache key from the lockfile of the app it installs, using
the same mechanism, and every Python job from `requirements.lock`. There is no per-workflow
variation left to drift.

## Changing the Node version

Edit `.nvmrc`. Nothing else: all Node jobs, including the ones that only run scripts,
read it. (`apps/*/Dockerfile` pin their own base image because they are built and released
independently of CI.)

## Workflow size

Line counts of the five original workflows (the new workflows in this change are not
counted, they are additions):

| Workflow | Before | After |
|---|---|---|
| `backend.yml` | 286 | 275 |
| `mobile.yml` | 360 | 337 |
| `data-processing.yml` | 82 | 85 |
| `onchain.yml` | 136 | 138 |
| `mobile-e2e-flake-check.yml` | 103 | 84 |
| **Total** | **967** | **919** |

The setup logic that used to be repeated now exists once, in about 75 lines across the two
actions. The path filters added by [#1723](ci-path-filters.md) are included in the "after"
column.
