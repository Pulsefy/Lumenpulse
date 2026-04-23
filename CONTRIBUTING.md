# Contributing to LumenPulse

Thanks for contributing. This guide defines the standards expected before review so PRs can be merged faster.

## Scope

Use this document for repo-wide workflow and standards. For area-specific commands and architecture notes:

- [Mobile Guide](document/mobile-contributing.md)
- [Backend Guide](document/backend-contributing.md)
- [Contracts Guide](document/contracts-contributing.md)

## How to Contribute

1. Find or open an issue
- Look for unassigned issues or confirm assignment before starting.
- If creating a new issue, include context, expected behavior, and acceptance criteria.

2. Sync your fork and create a branch
- Update local `main` first:
```bash
git checkout main
git pull origin main
```
- Create a branch using one of the required prefixes:
```bash
git checkout -b feat/short-description
git checkout -b fix/short-description
git checkout -b docs/short-description
```

3. Implement the change
- Keep scope aligned to the issue.
- Prefer small, reviewable commits.
- Add/update tests when behavior changes.
- Update docs when behavior, setup, or usage changes.

4. Run validation locally
- Run the relevant lint/test commands for your area:
```bash
cd apps/mobile && npm run lint && npm run tsc
cd apps/backend && npm run lint && npm run test
cd apps/onchain && cargo fmt --all && cargo clippy --all-targets --all-features -- -D warnings && cargo test --workspace
```
- If your change spans multiple areas, validate each affected area.

5. Commit using Conventional Commits
- Format:
```text
<type>(<scope>): <short summary>
```
- Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`.
- Examples:
```text
feat(mobile): add portfolio refresh on pull
fix(backend): handle empty news provider response
docs(meta): add comprehensive contributing guidelines and standards
```

6. Open a Pull Request
- Target `main`.
- Use the PR template in `.github/pull_request_template.md`.
- Link the issue with `Closes #<number>`.
- Add screenshots/videos for UI changes.
- Keep PR focused; avoid mixing unrelated changes.

7. Address review feedback
- Reply to each review thread with what changed.
- Re-run lint/tests after updates.
- Keep branch up to date if requested by maintainers.

## Pull Request Checklist

- [ ] Branch name follows `feat/`, `fix/`, or `docs/`.
- [ ] Commit messages follow Conventional Commits.
- [ ] Lint passed for affected app(s).
- [ ] Tests passed for affected app(s).
- [ ] Docs updated (including `document/` guides when applicable).
- [ ] PR description links the issue (`Closes #...`).
- [ ] Screenshots/video attached for UI changes.

## Definition of Done

A contribution is done when all conditions are met:

- [ ] Acceptance criteria from the issue are satisfied.
- [ ] Relevant linting and tests pass locally and in CI.
- [ ] Required documentation updates are included.
- [ ] PR checklist is fully completed.
- [ ] Reviewer feedback is resolved and approved.

## Review Standards

PRs may be blocked when:

- Scope does not match the linked issue.
- Branch/commit naming standards are not followed.
- Tests or lint are skipped without clear reason.
- Required docs are missing.

Following this guide keeps review focused on code quality instead of process fixes.
