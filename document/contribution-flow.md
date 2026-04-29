# 💸 Contribution Flow

```mermaid
sequenceDiagram
  participant User
  participant Contribution
  participant Treasury
  participant Registry

  User->>Contribution: Submit funds
  Contribution->>Registry: Validate project
  Contribution->>Treasury: Transfer funds
  Treasury-->>Contribution: Confirm deposit
  Contribution-->>User: Success response
``` id="nt1k7n"

---

## Flow Explanation

1. User submits contribution
2. Project validity checked via registry
3. Funds transferred into treasury
4. Contribution recorded
5. User receives confirmation