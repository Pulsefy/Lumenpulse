# Contributing to LumenPulse

Thanks for contributing. This guide defines the standards expected before review so PRs can be merged faster.

## Scope

Use this document for repo-wide workflow and standards. For area-specific commands and architecture notes:

- [Mobile Guide](docs/mobile-contributing.md)
- [Backend Guide](docs/backend-contributing.md)
- [Contracts Guide](docs/contracts-contributing.md)
- [Contributor Review Guide](docs/contributor-pr-review-guide.md) - how reviewers verify a change before it merges

## Platform Direction

LumenPulse operates on Stellar/Soroban. All new work should align with Stellar-first principles. See [Stellar Migration Notes](docs/STELLAR_MIGRATION_NOTES.md) for details on migration from prior chain assumptions and guidance for contributors.

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
- Add or update an ADR when the change introduces or revises a significant architectural decision, platform boundary, operational pattern, or contract/governance approach.

When an issue changes how services are split, how the backend integrates with Python or external systems, how on-chain state or upgradeability works, or what persistence/eventing pattern is used, the PR should include an ADR entry in [docs/adr/README.md](docs/adr/README.md) and link the related implementation summary or feature write-up.

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
- [ ] Docs updated (including `docs/` guides when applicable).
- [ ] PR description links the issue (`Closes #...`).
- [ ] Screenshots/video attached for UI changes.
- [ ] PR description names every file or artefact the change creates or modifies (see [Definition of Done for Issue Closure](#definition-of-done-for-issue-closure)).

## Definition of Done

A contribution is done when all conditions are met:

- [ ] Acceptance criteria from the issue are satisfied.
- [ ] Relevant linting and tests pass locally and in CI.
- [ ] Required documentation updates are included.
- [ ] PR checklist is fully completed.
- [ ] Reviewer feedback is resolved and approved.
- [ ] The artefacts named by the PR exist on the merged branch (see below).

## Definition of Done for Issue Closure

An issue is closed only when the work it describes is present on `main`. A merged pull
request with a matching title is not sufficient evidence of that, and is not accepted as
evidence on its own.

### 1. A closing PR must name its artefacts

Every pull request that closes an issue must include an **Artefacts** section in its
description listing, by path, each file or artefact the change creates or modifies:

```markdown
## Artefacts

- `.github/workflows/webapp.yml` - new CI workflow for `apps/webapp`
- `apps/webapp/e2e/checkout.spec.ts` - Playwright coverage for the checkout flow
```

Rules for that section:

- Use real repository paths. A description of the work ("added CI for the webapp") is not a
  path and does not satisfy this.
- Every path listed must appear in the PR's **Files changed** tab.
- A stub, an empty file, or a placeholder does not count as the artefact. The file must
  contain the implementation the issue asked for.
- A test suite counts as delivered only when the runner discovers and executes it. A CI
  workflow counts as delivered only once it has appeared in the Actions tab.
- Documentation issues are no exception: name the document's path.

### 2. Reviewers confirm the artefacts exist on the merged branch

Before an issue is closed, a reviewer confirms each named artefact is present on the branch
that was merged:

```bash
git fetch origin main
git ls-tree -r --name-only origin/main -- <path>   # prints the path if it exists
git show origin/main:<path> | head                 # prints the content, fails if absent
```

The full reviewer checklist is in the
[Contributor Review Guide](docs/contributor-pr-review-guide.md#12-reviewer-quick-reference). If an artefact named
by a merged PR is missing, reopen the issue and post the output showing its absence.

### 3. Closing without a merged PR requires a written reason

An issue closed without a linked merged pull request requires an explicit written reason left
as a comment before the close, stating which case applies:

- **Superseded** - name the issue or PR that replaced it.
- **Already satisfied** - name the existing artefact path and the commit that added it.
- **Not doing** - state the decision and who made it.
- **Cannot reproduce / invalid** - state what was tried.
- **Duplicate** - link the original issue.

"Done", "fixed", "completed", or a bare close with no comment is not a reason. An issue closed
with neither a linked merged PR nor a written reason should be reopened.

### 4. Worked examples of the failure mode

A Wave 8 audit found four issues closed with no corresponding artefact on `main`. Each had a
pull request merged under a matching title; in each case the work was not present afterwards.

| Claimed artefact | Expected path | What was actually on `main` |
|---|---|---|
| Webapp CI workflow | `.github/workflows/webapp.yml` | Only `backend.yml`, `data-processing.yml`, and `onchain.yml` exist. |
| Playwright suite | `apps/webapp/playwright.config.ts`, `apps/webapp/e2e/` | No Playwright config, spec, or dependency anywhere in the repo. |
| Webapp i18n catalogs | `apps/webapp/messages/*.json` | No catalog directory and no i18n dependency in `apps/webapp/package.json`. |
| `notification_interface` test module | `apps/onchain/contracts/notification_interface/src/test.rs` | The crate holds only `Cargo.toml` and `src/lib.rs`, with no `#[cfg(test)]` module - unlike sibling contracts such as `crowdfund_vault` and `vesting-wallet`. |

Each of these would have been caught by one command against the merged branch. The
[Contributor Review Guide](docs/contributor-pr-review-guide.md#131-worked-examples-of-the-failure-mode)
gives the exact command per case.

## Review Standards

PRs may be blocked when:

- The **Artefacts** section is missing, or names paths absent from the diff.
- A claimed file exists but is empty or a stub.
- Scope does not match the linked issue.
- Branch/commit naming standards are not followed.
- Tests or lint are skipped without clear reason.
- Required docs are missing.

Reviewers should work from the [Contributor Review Guide](docs/contributor-pr-review-guide.md).

Following this guide keeps review focused on code quality instead of process fixes.
