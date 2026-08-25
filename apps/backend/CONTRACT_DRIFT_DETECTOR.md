# Contract drift detector

`npm run contract:drift` compares configured testnet contract IDs against the
canonical manifest at `apps/onchain/testnet-manifest.json`.

The detector checks:

- backend metadata in `apps/backend/.env.example`
- web metadata in `apps/webapp/.env.local.example`
- mobile metadata in `apps/mobile/.env.example`

The command prints a JSON report with `ok`, `summary`, `drift`, and `missing`
fields. Any populated value that differs from the manifest is reported in
`drift` and makes the command exit with status `1`. Blank placeholders are
reported in `missing`; pass `--fail-on-missing` when scheduled checks should
require every source to publish every mapped ID.

## Local usage

```bash
cd apps/backend
npm run contract:drift
npm run contract:drift -- --fail-on-missing
```

## CI usage

The `Contract Drift` workflow runs the detector on pull requests that touch the
manifest or shared environment metadata. It also runs daily and can be triggered
manually from GitHub Actions.

## Remediation

1. Treat `apps/onchain/testnet-manifest.json` as the source of truth for active
   testnet contract IDs.
2. For each `drift` entry, copy the `expected` value into the reported
   `path`/`variable`.
3. If the manifest is stale because a contract was redeployed, update the
   manifest first, then refresh the backend, web, and mobile metadata from it.
4. Re-run `npm run contract:drift` and confirm `ok` is `true` before merging.
