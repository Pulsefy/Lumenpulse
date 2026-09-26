# Mobile E2E smoke suite (issue #1402)

Runs against the app's Expo **web** build via [Playwright](https://playwright.dev/) — the one
Expo platform that runs headlessly in CI with no emulator/simulator. All backend calls are
stubbed (see `mocks.ts`), so the suite needs no live backend.

## Running locally

```bash
cd apps/mobile
npm install
npx playwright install --with-deps chromium   # one-time browser download
npm run e2e
```

`npm run e2e` starts `expo start --web` on port 8081 (via Playwright's `webServer` config in
`playwright.config.ts`) and runs every spec in this directory against it, then shuts the server
down. Pass `--headed` or `--ui` to `npm run e2e` for an interactive run:

```bash
npm run e2e -- --ui
```

## What's covered

- `launch.spec.ts` — the app boots and renders without a crash screen.
- `login.spec.ts` — signing in with valid credentials navigates away from the login screen.
- `tab-navigation.spec.ts` — switching tabs (Projects, Settings) navigates correctly.
- `project-detail.spec.ts` — opening a project from the list shows its detail screen.
- `contribution-modal.spec.ts` — the Contribute button opens the contribution modal.

## Flake rate

Measured by running the suite 10 consecutive times via the `mobile-e2e-flake-check` workflow
(`.github/workflows/mobile-e2e-flake-check.yml`, `workflow_dispatch` only — not run on every PR to
avoid the CI cost of repeating the full suite 10x per push). See the PR description for the
current measured flake rate.
