@echo off
echo Creating GitHub Issues from Markdown Files...
echo.

:: WEBAPP ISSUES
echo ========================================
echo Creating Webapp Issues...
echo ========================================

gh issue create --title "Finish LumenPulse Branding Cleanup Across PWA Assets and Metadata" --body "The webapp still references legacy starkpulse-* assets across PWA metadata, icons, the navbar logo, the footer logo, and the service worker cache. Complete the branding cleanup so the app is consistently LumenPulse in both UI and installable PWA surfaces. Complexity: Medium (150 points)" --label "webapp,enhancement"
echo Created Issue 1

gh issue create --title "Implement Real Stellar Dashboard Overview Instead of Placeholder Cards" --body "Replace the current placeholder-only dashboard cards with a functional Stellar account overview powered by the connected wallet and backend or Horizon-compatible data. Complexity: High (200 points)" --label "webapp,enhancement"
echo Created Issue 2

gh issue create --title "Add Stellar Balances Panel to Dashboard" --body "Implement a dashboard balances panel that lists XLM and trusted Stellar assets for the connected account with formatting that matches Stellar asset conventions. Complexity: High (200 points)" --label "webapp,enhancement"
echo Created Issue 3

gh issue create --title "Add Stellar Transaction History Feed to Dashboard" --body "Build a recent activity panel for the connected Stellar account so users can see payments, trustline updates, and other relevant operations in the dashboard. Complexity: High (200 points)" --label "webapp,enhancement"
echo Created Issue 4

gh issue create --title "Add Explorer and Copy Actions for Connected Stellar Account" --body "Improve the connected wallet UX by adding a proper account summary surface with copy-to-clipboard and Stellar explorer actions instead of only showing a truncated address in the wallet button. Complexity: Medium (150 points)" --label "webapp,enhancement"
echo Created Issue 5

gh issue create --title "Improve Wallet State UX for Missing Freighter, Rejection, and Reconnect" --body "Refine the current wallet modal UX so missing-extension, rejection, reconnect, and previously connected states are handled more clearly and consistently. Complexity: Medium (150 points)" --label "webapp,enhancement"
echo Created Issue 6

gh issue create --title "Replace Placeholder Hash Navbar Links with Real App Navigation" --body "The navbar currently contains placeholder href=hash links for Community and Dashboard in desktop and mobile nav. Replace them with real application routes and ensure the navigation experience is consistent across screen sizes. Complexity: Trivial (100 points)" --label "webapp,bug"
echo Created Issue 7

gh issue create --title "Build Real Community Experience Instead of Placeholder Content" --body "Replace the current placeholder Community page with an actual contributor-facing experience aligned with LumenPulse's ecosystem and open-source growth goals. Complexity: Medium (150 points)" --label "webapp,enhancement"
echo Created Issue 8

gh issue create --title "Move News Fetching Behind a Safe Server-side or Backend Proxy" --body "The webapp currently fetches news from the client and includes a hardcoded NewsAPI key in frontend code. Move this flow behind a safer server-side route or backend proxy and preserve the existing news UX. Complexity: High (200 points)" --label "webapp,security"
echo Created Issue 9

gh issue create --title "Replace Fragile Cookie-check Route Guards with Shared Auth Gate Pattern" --body "Dashboard and community currently use ad hoc document.cookie.includes auth-token checks for route protection. Replace this with a shared frontend auth gate pattern that is easier to maintain and less brittle. Complexity: Medium (150 points)" --label "webapp,refactor"
echo Created Issue 10

echo.
echo ========================================
echo Creating Mobile Issues...
echo ========================================

gh issue create --title "Wallet Connection and Watch-only Import Flow" --body "Add a dedicated flow for connecting supported wallets or importing a public key as a watch-only account. Complexity: High (200 points)" --label "mobile,enhancement"
echo Created Mobile Issue 1

gh issue create --title "Push Notifications and Deep Link Routing" --body "Enable push notifications for alerts and wire them to deep link directly into the relevant app screen. Complexity: Medium (150 points)" --label "mobile,enhancement"
echo Created Mobile Issue 2

gh issue create --title "Saved Watchlist for Assets and Projects" --body "Let users bookmark assets and ecosystem projects they want to monitor closely. Complexity: Medium (150 points)" --label "mobile,enhancement"
echo Created Mobile Issue 3

gh issue create --title "Offline Cache and Stale-while-revalidate Data Loading" --body "Improve perceived speed by caching key screens locally and refreshing them in the background when connectivity returns. Complexity: High (200 points)" --label "mobile,enhancement"
echo Created Mobile Issue 4

gh issue create --title "News Reader Screen with Save and Share Actions" --body "Create a full article reader view so users can open, save, and share ecosystem news from inside the app. Complexity: Medium (150 points)" --label "mobile,enhancement"
echo Created Mobile Issue 5

gh issue create --title "Price Alert Creation and Management UI" --body "Allow users to create, edit, and delete price alerts for tracked Stellar assets. Complexity: Medium (150 points)" --label "mobile,enhancement"
echo Created Mobile Issue 6

gh issue create --title "Account Switcher for Multiple Linked Wallets" --body "Add a quick account switcher so users with multiple linked wallets can change context without digging through settings. Complexity: Medium (150 points)" --label "mobile,enhancement"
echo Created Mobile Issue 7

gh issue create --title "Explore Feed Filters and Sort Controls" --body "Add filter chips and sort controls to the Explore experience so users can browse by category, trend, sentiment, or funding status. Complexity: Medium (150 points)" --label "mobile,enhancement"
echo Created Mobile Issue 8

gh issue create --title "Transaction Detail Screen with Explorer Deep Links" --body "Extend transaction history with a detail screen showing richer metadata and one-tap access to an external explorer. Complexity: Medium (150 points)" --label "mobile,enhancement"
echo Created Mobile Issue 9

gh issue create --title "Security Center for Sessions and Connected Devices" --body "Create a Security Center screen where users can inspect recent sessions and revoke suspicious devices. Complexity: Medium (150 points)" --label "mobile,enhancement"
echo Created Mobile Issue 10

gh issue create --title "Onboarding Tour and First-link Guidance" --body "Add a lightweight onboarding flow that explains the product value and guides first-time users to link an account or start exploring. Complexity: Trivial (100 points)" --label "mobile,enhancement"
echo Created Mobile Issue 11

gh issue create --title "Theme Preferences and Dark Mode Support" --body "Add light, dark, and system theme options so the app feels polished and consistent with device settings. Complexity: Medium (150 points)" --label "mobile,enhancement"
echo Created Mobile Issue 12

gh issue create --title "Portfolio Asset Detail Screen" --body "Create an asset detail view showing balance, valuation, recent activity, and sentiment or price context for a selected holding. Complexity: Medium (150 points)" --label "mobile,enhancement"
echo Created Mobile Issue 13

gh issue create --title "Accessibility Pass for Core Mobile Flows" --body "Improve accessibility across the core app experience with better labels, touch targets, focus order, and color contrast. Complexity: Medium (150 points)" --label "mobile,enhancement"
echo Created Mobile Issue 14

gh issue create --title "Localization Framework and Initial i18n Setup" --body "Prepare the mobile app for multiple languages by introducing a localization framework and extracting hard-coded strings. Complexity: Medium (150 points)" --label "mobile,enhancement"
echo Created Mobile Issue 15

echo.
echo ========================================
echo Creating Data Processing Issues...
echo ========================================

gh issue create --title "Content Deduplication and Source Fingerprinting" --body "Add robust deduplication so the pipeline can detect reposted articles, syndicated content, and near-duplicate social posts before they distort analytics. Complexity: Medium (150 points)" --label "backend,data-processing"
echo Created Data Processing Issue 1

gh issue create --title "Multilingual Translation and Normalization Pipeline" --body "Expand ingestion to support non-English content by translating and normalizing articles/posts before analytics are computed. Complexity: High (200 points)" --label "backend,data-processing"
echo Created Data Processing Issue 2

gh issue create --title "Entity Linking to Projects, Assets, and Ecosystem Registry" --body "Go beyond entity extraction by linking mentions to known Lumenpulse projects, Stellar assets, and ecosystem entries. Complexity: Medium (150 points)" --label "backend,data-processing"
echo Created Data Processing Issue 3

gh issue create --title "Narrative Clustering and Topic Detection" --body "Group related news and social posts into narratives or topics so the product can surface major ecosystem themes instead of isolated items. Complexity: High (200 points)" --label "backend,ai-ml"
echo Created Data Processing Issue 4

gh issue create --title "Source Credibility Scoring Engine" --body "Score sources based on reputation, freshness, prior accuracy, and spam signals so downstream analytics can weight content quality. Complexity: Medium (150 points)" --label "backend,analytics"
echo Created Data Processing Issue 5

gh issue create --title "Feature Store for Reusable Analytics and ML Inputs" --body "Introduce a feature store layer so engineered features can be reused across sentiment, forecasting, anomaly detection, and ranking models. Complexity: High (200 points)" --label "backend,mlops"
echo Created Data Processing Issue 6

gh issue create --title "Model Drift Detection and Evaluation Dashboard" --body "Monitor prediction quality over time and detect when sentiment or forecasting models start drifting from expected behavior. Complexity: Medium (150 points)" --label "backend,mlops"
echo Created Data Processing Issue 7

gh issue create --title "Streaming Ingestion Bus for Near Real-time Analytics" --body "Add a streaming ingestion layer so new articles, posts, and on-chain events can be processed with lower latency than batch-only jobs. Complexity: High (200 points)" --label "backend,streaming"
echo Created Data Processing Issue 8

gh issue create --title "Embeddings-based Semantic Search for Insights" --body "Implement semantic search over articles, posts, and analytics insights so users can find related content beyond exact keyword matching. Complexity: High (200 points)" --label "backend,ai-ml"
echo Created Data Processing Issue 9

gh issue create --title "Explainable Sentiment Metadata and Reason Tags" --body "Augment sentiment outputs with reason tags, salient phrases, or confidence metadata so the frontend can explain why a score was assigned. Complexity: Medium (150 points)" --label "backend,nlp"
echo Created Data Processing Issue 10

gh issue create --title "Alert Backtesting and Threshold Tuning Framework" --body "Create a backtesting framework to evaluate whether alert thresholds would have produced useful results on historical data. Complexity: Medium (150 points)" --label "backend,analytics"
echo Created Data Processing Issue 11

gh issue create --title "Knowledge Graph of Projects, Assets, and Narratives" --body "Model relationships between projects, contributors, assets, news sources, and narratives to enable richer insight generation. Complexity: High (200 points)" --label "backend,data-modeling"
echo Created Data Processing Issue 12

gh issue create --title "Human Review Queue for Low-confidence Classifications" --body "Route low-confidence classifications or suspicious content into a manual review queue before they influence production-facing analytics. Complexity: Medium (150 points)" --label "backend,data-quality"
echo Created Data Processing Issue 13

gh issue create --title "Data Retention, Cold Storage, and Archival Lifecycle" --body "Define how raw content, intermediate artifacts, and derived analytics are retained, archived, or purged over time. Complexity: Medium (150 points)" --label "backend,devops"
echo Created Data Processing Issue 14

gh issue create --title "Insight Ranking Engine for Feed Prioritization" --body "Build a ranking layer that prioritizes the most useful insights based on freshness, confidence, source quality, and market relevance. Complexity: Medium (150 points)" --label "backend,ranking"
echo Created Data Processing Issue 15

echo.
echo ========================================
echo Creating Backend Issues...
echo ========================================

gh issue create --title "Verified Wallet Linking with Signed Challenge Flow" --body "Add a secure challenge-response flow so users can prove ownership of a Stellar address before linking it to their account. Complexity: Medium (150 points)" --label "backend,auth,stellar"
echo Created Backend Issue 1

gh issue create --title "API Versioning and Deprecation Strategy" --body "Introduce explicit API versioning so contributors can ship breaking changes without destabilizing current clients. Complexity: Medium (150 points)" --label "backend,api"
echo Created Backend Issue 2

gh issue create --title "Role-Based Access Control for Admin and Reviewer Operations" --body "Add role-based authorization for admin-only and reviewer-only actions across moderation, curation, and operational endpoints. Complexity: High (200 points)" --label "backend,security"
echo Created Backend Issue 3

gh issue create --title "Cursor-Based Pagination and Filtering Across Public Endpoints" --body "Standardize pagination, sorting, and filtering across high-volume endpoints such as projects, notifications, transactions, and analytics feeds. Complexity: Medium (150 points)" --label "backend,api,performance"
echo Created Backend Issue 4

gh issue create --title "Config Validation and Secrets Hardening at Application Boot" --body "Fail fast on invalid environment configuration and harden how secrets are loaded across local, staging, and production setups. Complexity: Medium (150 points)" --label "backend,devops,security"
echo Created Backend Issue 5

gh issue create --title "Read-Through Caching for Asset, Price, and Discovery Endpoints" --body "Add caching for frequently requested but slow-moving market and discovery endpoints to reduce latency and upstream load. Complexity: Medium (150 points)" --label "backend,caching,performance"
echo Created Backend Issue 6

gh issue create --title "Idempotency Keys for Contribution, Payout, and Notification APIs" --body "Protect mutation endpoints from duplicate submissions caused by retries, mobile reconnects, or client-side double taps. Complexity: High (200 points)" --label "backend,reliability,payments"
echo Created Backend Issue 7

gh issue create --title "Project Search and Discovery Service" --body "Create search endpoints for projects, assets, and ecosystem entities with basic ranking and filter support. Complexity: Medium (150 points)" --label "backend,search,product"
echo Created Backend Issue 8

gh issue create --title "Notification Preferences and Delivery Orchestration API" --body "Add backend support for managing per-user notification preferences and routing events to the correct delivery channels. Complexity: Medium (150 points)" --label "backend,notifications,product"
echo Created Backend Issue 9

gh issue create --title "Inbound Webhook Signature Verification Framework" --body "Create a reusable framework for verifying signed webhooks from trusted third-party providers or internal services. Complexity: Medium (150 points)" --label "backend,security,integrations"
echo Created Backend Issue 10

gh issue create --title "Portfolio Snapshot Materialization for Fast Reads" --body "Materialize portfolio snapshots so summary endpoints can serve fast reads without recomputing balances from raw events every time. Complexity: High (200 points)" --label "backend,portfolio,performance"
echo Created Backend Issue 11

gh issue create --title "Account Reconciliation for Balance and Position Drift" --body "Add reconciliation jobs that compare stored balances and positions against trusted upstream data to detect drift and repair inconsistencies. Complexity: High (200 points)" --label "backend,reliability,stellar"
echo Created Backend Issue 12

gh issue create --title "Transactional Outbox for Reliable Domain Events" --body "Introduce an outbox pattern so important domain events are persisted transactionally and delivered reliably to async consumers. Complexity: High (200 points)" --label "backend,architecture,reliability"
echo Created Backend Issue 13

gh issue create --title "Feature Flags and Controlled Rollouts" --body "Add feature flag support so new backend capabilities can be enabled gradually by environment, user segment, or project. Complexity: Medium (150 points)" --label "backend,dx,release"
echo Created Backend Issue 14

gh issue create --title "Request Correlation IDs and Structured Operational Logging" --body "Add request-scoped correlation IDs and structured logs to improve debugging across API requests, workers, and integrations. Complexity: Medium (150 points)" --label "backend,observability,devops"
echo Created Backend Issue 15

gh issue create --title "Signed Export Jobs for Portfolio and Tax CSV Downloads" --body "Implement asynchronous export generation for portfolio history and tax-friendly transaction CSV downloads. Complexity: Medium (150 points)" --label "backend,exports,product"
echo Created Backend Issue 16

gh issue create --title "Moderation Queue for Reported Projects and User Content" --body "Create backend support for reporting projects or user-generated content and routing those reports into a moderation queue. Complexity: Medium (150 points)" --label "backend,moderation,admin"
echo Created Backend Issue 17

gh issue create --title "Session Management and Device Revocation API" --body "Add visibility into active sessions and allow users to revoke old or suspicious devices. Complexity: Medium (150 points)" --label "backend,security,auth"
echo Created Backend Issue 18

gh issue create --title "Database Query Profiling and Index Hardening" --body "Review slow backend queries, add missing indexes, and document expected performance for critical read paths. Complexity: Medium (150 points)" --label "backend,database,performance"
echo Created Backend Issue 19

gh issue create --title "Project Drafts, Review States, and Publish Workflow API" --body "Implement draft and review states for project submissions so creators can save work, reviewers can request changes, and only approved projects are published. Complexity: High (200 points)" --label "backend,product,workflow"
echo Created Backend Issue 20

echo.
echo ========================================
echo Creating Smart Contract Issues...
echo ========================================

gh issue create --title "Upgrade-safe Storage Schema and Migration Guards" --body "Add explicit storage versioning and migration guards so contract upgrades do not corrupt persisted state. Complexity: High (200 points)" --label "smart-contracts,soroban"
echo Created Contract Issue 1

gh issue create --title "Emergency Pause and Circuit Breaker Controls" --body "Implement a pause mechanism for high-risk flows such as deposits, withdrawals, and distributions so maintainers can respond to production incidents quickly. Complexity: Medium (150 points)" --label "smart-contracts,security"
echo Created Contract Issue 2

gh issue create --title "Milestone Expiry, Refund Windows, and Contributor Clawback" --body "Add rules for milestone expiry and timed refund windows so funds do not remain locked forever when projects stall. Complexity: High (200 points)" --label "smart-contracts,enhancement"
echo Created Contract Issue 3

gh issue create --title "Dispute Resolution Escrow for Milestone Challenges" --body "Introduce a dispute flow that can temporarily escrow milestone payouts when contributors formally challenge completion. Complexity: High (200 points)" --label "smart-contracts,enhancement"
echo Created Contract Issue 4

gh issue create --title "Quadratic Matching Pool Distribution Contract" --body "Build a dedicated matching pool mechanism to distribute grants using quadratic funding style calculations across eligible projects. Complexity: High (200 points)" --label "smart-contracts,defi"
echo Created Contract Issue 5

gh issue create --title "Oracle-backed Asset Pricing Adapter for Contributions" --body "Allow non-XLM contributions to be normalized through a pricing adapter so project totals and matching logic can compare assets consistently. Complexity: Medium (150 points)" --label "smart-contracts,oracle"
echo Created Contract Issue 6

gh issue create --title "Batched Payout Execution for Contributor Rewards" --body "Support batched reward or rebate payouts to reduce repetitive execution overhead for treasury and grant distribution flows. Complexity: Medium (150 points)" --label "smart-contracts,enhancement"
echo Created Contract Issue 7

gh issue create --title "Permit-style Signed Deposit Approvals" --body "Add a signed intent flow so users can authorize deposits off-chain and a relayer can execute them on-chain with lower UX friction. Complexity: High (200 points)" --label "smart-contracts,ux"
echo Created Contract Issue 8

gh issue create --title "Protocol Registry for Contract Discovery and Version Resolution" --body "Create a registry contract that maps protocol modules to active contract addresses and versions for safer client integration. Complexity: Medium (150 points)" --label "smart-contracts,infrastructure"
echo Created Contract Issue 9

gh issue create --title "Treasury Streaming and Budget Allocation Module" --body "Implement time-based treasury streaming so approved budgets can unlock gradually instead of being released in one lump sum. Complexity: Medium (150 points)" --label "smart-contracts,treasury"
echo Created Contract Issue 10

gh issue create --title "Shared Cross-contract Access Policy Interface" --body "Define a shared access-control interface so contracts can ask other protocol modules about roles, permissions, and trusted callers in a standardized way. Complexity: Medium (150 points)" --label "smart-contracts,security"
echo Created Contract Issue 11

gh issue create --title "Storage Rent Optimization and State Compaction" --body "Review persistent contract state and introduce compaction patterns that reduce long-term storage bloat and rent pressure. Complexity: Medium (150 points)" --label "smart-contracts,performance"
echo Created Contract Issue 12

gh issue create --title "Reentrancy Guard Hardening Across All Vaults" --body "Implement a standardized reentrancy guard pattern across all protocol contracts that handle asset transfers to prevent malicious callbacks. Complexity: Medium (150 points)" --label "smart-contracts,security"
echo Created Contract Issue 13

gh issue create --title "Implement On-chain Protocol Fee Model" --body "Introduce a small protocol fee on withdrawals or project funding to ensure long-term sustainability of the Lumenpulse platform. Complexity: Medium (150 points)" --label "smart-contracts,fees"
echo Created Contract Issue 14

gh issue create --title "Voting-based Milestone Approval Logic" --body "Move from admin-only milestone approval to a community or contributor voting system for releasing funds from the Crowdfund Vault. Complexity: High (200 points)" --label "smart-contracts,governance"
echo Created Contract Issue 15

gh issue create --title "Contributor Tiering and Metadata Badges" --body "Extend the contributor-registry to support on-chain Badges or tiers based on contribution history and reputation. Complexity: Medium (150 points)" --label "smart-contracts,enhancement"
echo Created Contract Issue 16

gh issue create --title "Yield-bearing Vault Extensions (Mock Integration)" --body "Explore integrating the Crowdfund Vault with other Soroban liquidity protocols to earn yield on idle funds awaiting milestone release. Complexity: High (200 points)" --label "smart-contracts,defi"
echo Created Contract Issue 17

gh issue create --title "Invariant Testing and Formal Verification Setup" --body "Introduce property-based testing (Invariants) to ensure protocol-level rules are never violated, regardless of user input. Complexity: High (200 points)" --label "smart-contracts,testing"
echo Created Contract Issue 18

gh issue create --title "Performance-based Dynamic Vesting" --body "Upgrade the vesting-wallet to support vesting schedules that accelerate or trigger based on external project milestones rather than just time. Complexity: Medium (150 points)" --label "smart-contracts,enhancement"
echo Created Contract Issue 19

gh issue create --title "Cross-contract Event Notification System" --body "Implement a Notification pattern where contracts can signal state changes to each other efficiently without tight coupling. Complexity: Medium (150 points)" --label "smart-contracts,architecture"
echo Created Contract Issue 20

gh issue create --title "On-chain Analytics: TVL and Volume Tracking" --body "Maintain high-level protocol statistics (Total Value Locked, Cumulative Funding Volume) directly on-chain for trustless reporting. Complexity: Trivial (100 points)" --label "smart-contracts,analytics"
echo Created Contract Issue 21

gh issue create --title "Gas-less Transaction Support (EIP-712 Style Signatures)" --body "Allow users to sign contribution or registration intents off-chain and have a relayer submit them, enabling gas-less UX for end-users. Complexity: High (200 points)" --label "smart-contracts,ux"
echo Created Contract Issue 22

gh issue create --title "Decentralized Project Curation and Whitelisting" --body "Implement a mechanism where the community (via reputation or token balance) decides which projects are Lumenpulse Verified and eligible for matching funds. Complexity: High (200 points)" --label "smart-contracts,governance"
echo Created Contract Issue 23

echo.
echo ========================================
echo All issues created successfully!
echo ========================================
