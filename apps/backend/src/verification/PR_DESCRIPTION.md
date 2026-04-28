# feat(verification): community-driven project verification with quadratic funding eligibility

## Summary

Implements a full-stack project verification system that lets the community vote on which projects earn **Lumenpulse Verified** status and become eligible for matching funds. Voting weight is configurable — flat (one-address-one-vote), reputation-based (from `contributor_registry`), or governance token balance.

Closes #572

---

## What changed

### On-chain — new `project_registry` Soroban contract

A dedicated contract that owns the full verification lifecycle, independent of `crowdfund_vault`.

**Storage types** (`storage.rs`):
- `VerificationStatus` — `Pending | Verified | Rejected`
- `WeightMode` — `Flat | Reputation | TokenBalance`
- `ProjectEntry` — per-project record with vote tallies and timestamps
- `RegistryConfig` — quorum threshold, weight mode, governance token, contributor registry, min voter weight

**Contract functions** (`lib.rs`):
- `initialize` — sets admin, quorum, weight mode, optional token/registry addresses
- `register_project` — owner registers a project for community review
- `cast_vote` — voter casts for/against; weight resolved by mode; auto-resolves at quorum
- `override_verification` — admin can force verify or reject
- `update_config` — admin updates quorum and min weight
- `get_project`, `is_verified`, `has_voted`, `get_voter_weight`, `get_config`
- `pause` / `unpause` / `set_admin` / `upgrade`

**Weight resolution:**
- `Flat` — weight 1 per address (optionally gated by `contributor_registry.is_registered`)
- `Reputation` — cross-contract call to `contributor_registry.get_reputation(voter)`
- `TokenBalance` — reads `governance_token.balance(voter)` via `TokenClient`

**Events** (`events.rs`):
`InitializedEvent`, `ProjectRegisteredEvent`, `VoteCastEvent`, `ProjectVerifiedEvent`, `ProjectRejectedEvent`, `VerificationOverriddenEvent`

---

### Backend — `VerificationModule` (NestJS)

New module at `src/verification/` registered in `AppModule`.

**Endpoints:**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/verification/config` | public | Get quorum config |
| `PUT` | `/verification/config` | JWT | Update quorum / min weight |
| `GET` | `/verification/projects` | public | List projects (optional `?status=` filter) |
| `GET` | `/verification/projects/:id` | public | Get single project |
| `GET` | `/verification/projects/:id/verified` | public | Boolean verified check |
| `POST` | `/verification/projects` | JWT | Register project |
| `POST` | `/verification/vote` | public | Cast vote |
| `POST` | `/verification/override` | JWT | Admin override |

**Service** (`verification.service.ts`):
- In-memory store (drop-in for DB-backed implementation)
- Three weight modes: `FLAT`, `REPUTATION`, `TOKEN_BALANCE`
- Auto-resolves to `Verified` or `Rejected` when `votesFor` / `votesAgainst` reaches `quorumThreshold`
- `quorumProgress` percentage computed per project for UI display
- `setReputation` / `setTokenBalance` for on-chain sync

**DTOs** (`dto/verification.dto.ts`):
`RegisterProjectDto`, `CastVoteDto`, `OverrideDto`, `UpdateConfigDto`, `ProjectVerificationDto`, `VoteResultDto`, `RegistryConfigDto`

---

### Webapp — `/verification` page + `VerificationBadge` component

**`components/verification-badge.tsx`:**
- Status header with icon (ShieldCheck / ShieldAlert / Clock)
- Quorum progress bar with colour-coded fill
- For / against vote counts
- Verify / Reject buttons (shown when `canVote=true`)

**`app/verification/page.tsx`:**
- Stats row: Pending / Verified / Rejected counts
- Filter tabs: All / Pending / Verified / Rejected
- Project list with `VerificationBadge` per entry
- Live vote submission with optimistic refresh

**Navbar** (`components/navbar.tsx`):
- Verify link added to desktop nav and mobile menu (ShieldCheck icon)

---

### Mobile — `VerificationPanel` + `verification.ts`

**`lib/verification.ts`:**
- Typed API client (`getProject`, `listProjects`, `isVerified`, `castVote`, `getConfig`)
- `statusColor` and `statusLabel` helpers

**`components/VerificationPanel.tsx`:**
- Embeddable panel for the project detail screen
- Quorum bar, vote counts, Verify / Reject buttons
- Handles loading, voting, voted state, and error display
- Shows "Link a Stellar account in Settings to vote" when no public key

**`app/(tabs)/projects/[id].tsx`:**
- `VerificationPanel` rendered below the on-chain notice card, passing `projectId` and `stellarPublicKey`

---

## Tests

| Layer | Result |
|-------|--------|
| On-chain (`project_registry`) | **18 / 18 passing** |
| Backend (`VerificationService`) | **173 / 173 passing** (16 new) |

**On-chain test coverage:**
- Initialization and double-init guard
- Zero quorum rejection
- Project registration and duplicate guard
- Vote accumulation (Flat mode)
- Auto-verify at quorum
- Auto-reject at quorum against
- Double-vote rejection
- Vote on resolved project rejection
- Insufficient weight rejection
- Token balance weight mode (two voters crossing quorum)
- Admin override verify and revoke
- Non-admin override rejection
- `has_voted` / `get_voter_weight` queries
- Config update
- Pause blocks votes

**Backend test coverage:**
- Config get / update / zero-quorum rejection
- Registration and duplicate rejection
- Unknown project 404
- Vote accumulation and `quorumProgress` calculation
- Auto-verify and auto-reject at quorum
- Double-vote rejection
- Vote on resolved project rejection
- Reputation weight mode with two voters crossing quorum
- Min weight enforcement (ForbiddenException)
- Admin override verify and revoke
- List filtering by status

---

## Design decisions

- **Separate contract** — `project_registry` is independent of `crowdfund_vault`. Verification status is a prerequisite for matching fund eligibility but the two contracts are decoupled.
- **Three weight modes** — Flat gives equal voice to all registered contributors; Reputation rewards long-term contributors; TokenBalance enables governance token holders to control eligibility.
- **Cross-contract weight resolution** — Reputation and Flat modes call `contributor_registry` via `env.invoke_contract`; TokenBalance uses `TokenClient::balance`. No weight data is stored in the registry itself.
- **Auto-resolve** — Once `votes_for >= quorum_threshold` or `votes_against >= quorum_threshold` the status flips immediately in the same transaction, emitting the appropriate event.
- **Admin override** — Allows emergency revocation of verified status (e.g. if a project is found to be fraudulent after verification).
