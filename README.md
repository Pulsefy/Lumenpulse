# LumenPulse

LumenPulse is a cutting-edge, decentralized crypto news aggregator and portfolio management platform built on the Stellar blockchain ecosystem. Leveraging Stellar's sub-second settlements, low fees, and Soroban smart contracts, LumenPulse curates real-time news from trusted sources, enables seamless portfolio tracking, and rewards community contributions with on-chain incentives—empowering users with transparent, borderless access to crypto insights.

Designed for crypto enthusiasts, traders, and developers worldwide, LumenPulse simplifies staying informed and managing assets in volatile markets. Whether you're a novice investor monitoring trends or a DeFi power user analyzing on-chain data, the platform's intuitive UI, robust API, and blockchain integration foster informed decisions and community-driven content, all while promoting financial inclusion through Stellar's efficient infrastructure.

## Features
### Core
- **Futuristic UI/UX**: Sleek, responsive design with animated components and interactive dashboards.
- **Stellar Wallet Integration**: Seamless connections via Freighter or Lobstr for secure auth and transactions.
- **News Aggregation Dashboard**: Real-time curation from multiple sources with sentiment analysis.
- **Portfolio Visualization**: Dynamic charts for asset tracking, performance metrics, and risk assessment.

### Advanced
- **Transaction History**: Detailed on-chain views with Stellar explorer links.
- **Community Engagement**: Rating, commenting, and rewarded content submissions via Soroban contracts.
- **RESTful API**: Scalable backend for data queries and integrations.
- **Intelligent Data Processing**: Automated analytics for market trends and portfolio optimization.

## Tech Stack
### Frontend
- Next.js 15: App router, server components, and streaming.
- React 18: Component-based UI.
- TypeScript: Type-safe development.
- Tailwind CSS: Utility-first styling.
- Zustand: Lightweight state management.
- Stellar SDK: Blockchain interactions.
- Lucide: Icon library.
- Recharts: Charting visuals.

### Backend API
- Node.js: Runtime.
- Express.js 4.18.2: Web framework.
- RESTful design with CORS and error handling.
- Nodemon 3.0.1: Hot reload.

### Data Processing
- Python 3.9+: Core language.
- Libraries for crypto/news aggregation and analytics.
- Stellar integration for on-chain data.

### Blockchain
- Stellar Blockchain: Core network for transactions and rewards.
- Soroban: Rust smart contracts for content incentives and data verification.
- Stellar SDK (JS): Client-side queries and tx building.

### Monorepo
- pnpm workspaces with TurboRepo for unified builds.

## Repository Structure
LumenPulse is a monorepo for streamlined development across web, API, data, and blockchain layers. The structure supports independent module scaling while sharing utilities like auth and Stellar helpers.

```
lumenpulse/
├── apps/
│   ├── frontend/              # Next.js UI (dashboards, news feeds)
│   ├── backend-api/           # Express.js REST API (data endpoints)
│   └── data-processing/       # Python scripts (aggregation, analytics)
├── packages/
│   ├── ui/                    # Shared React components/icons
│   └── stellar-sdk/           # Stellar/Soroban wrappers (tx utils, contract calls)
├── soroban-contracts/         # Rust Soroban contracts (rewards, content verification)
│   ├── src/
│   │   ├── lib.rs             # Core logic (e.g., reward minting)
│   │   └── test.rs            # Unit tests
│   └── Cargo.toml             # Dependencies (soroban-sdk)
├── .pnpm-workspace.yaml       # pnpm config
├── turbo.json                 # Build pipelines
└── .env.example               # Env template
```

For module-specific docs: [FRONTEND.md](FRONTEND.md), [BACKEND.md](BACKEND.md), [DATA-PROCESSING.md](DATA-PROCESSING.md), [SOROBAN.md](SOROBAN.md).

## Setup Instructions

### Prerequisites
- Node.js 18+ ([nodejs.org](https://nodejs.org)).
- pnpm (install: `npm install -g pnpm`).
- Python 3.9+ ([python.org](https://python.org)).
- Rust 1.75+ (for Soroban; [rustup.rs](https://rustup.rs); add WASM target: `rustup target add wasm32-unknown-unknown`).
- Stellar testnet wallet (Freighter; [freighter.app](https://freighter.app)).
- Git and pip.

### Installation
1. Clone the repository:
   ```
   git clone https://github.com/Pulsefy/Lumenpulse.git
   cd Lumenpulse
   ```

2. Install dependencies:
   ```
   pnpm install
   cd soroban-contracts && cargo build --target wasm32-unknown-unknown --release && cd ..
   cd data-processing && pip install -r requirements.txt && cd ..
   ```

### Environment Setup
1. Copy `.env.example` to `.env` (root) and configure:
   ```
   NODE_ENV=development
   PORT=3000
   DB_HOST=localhost
   DB_PORT=5432
   DB_USER=your_user
   DB_PASS=your_pass
   API_KEY=your_external_api_key
   STELLAR_NETWORK=testnet  # "mainnet" for production
   WALLET_SECRET=your_stellar_secret  # Base64 for dev txs
   SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc  # Local RPC
   ```
2. Database: Set up PostgreSQL (e.g., via Docker) and run migrations in `backend-api`: `npx prisma migrate dev` (if using Prisma).
3. Stellar: Fund testnet wallet at [laboratory.stellar.org](https://laboratory.stellar.org).
4. Soroban: Install CLI (`cargo install --git https://github.com/stellar/rs-soroban-cli soroban-cli`).

### Running Locally
1. Start Soroban RPC (for contracts):
   ```
   soroban rpc serve --network testnet --port 8000
   ```
2. Launch with TurboRepo:
   ```
   pnpm turbo run dev
   ```
   - Frontend: [http://localhost:3000](http://localhost:3000).
   - Backend: [http://localhost:8000](http://localhost:8000).
   - Data Processing: Runs as background script (invoke via API).
3. Deploy/deploy test contract:
   ```
   cd soroban-contracts
   soroban contract deploy --wasm target/wasm32-unknown-unknown/release/lumenpulse.wasm --network testnet
   ```
4. Connect wallet in frontend to test news/portfolio features.

### Testing
1. Lint/type-check:
   ```
   pnpm turbo run lint
   ```
2. Unit tests:
   ```
   pnpm turbo run test  # JS/TS (Jest)
   cd soroban-contracts && cargo test  # Rust
   cd data-processing && pytest  # Python
   ```
3. E2E:
   ```
   pnpm turbo run test:e2e  # Playwright for frontend
   ```
   Tests require testnet; mocks for external APIs.

### Deployment
- **Frontend**: Vercel—connect repo, add env vars.
- **Backend/Data**: Railway or AWS; containerize Python scripts.
- **Soroban Contracts**: Deploy via CI/CD (GitHub Actions); verify on Stellar explorer.
- Production: Set `STELLAR_NETWORK=mainnet`; audit contracts.

## Usage
1. **News Feed**: Browse aggregated articles; rate/comment for rewards.
2. **Portfolio**: Connect wallet → add assets → view charts/transactions.
3. **Contribute**: Submit insights; earn via Soroban reward contract.
4. **API**: Query endpoints like `/api/news` or `/api/portfolio`.

## Contributing
We welcome contributions to evolve LumenPulse! See [CONTRIBUTING.md](CONTRIBUTING.md) for details:
- **Issues**: Report bugs/features with repro steps.
- **PRs**:
  1. Fork/branch: `git checkout -b feat/your-feature`.
  2. Code/test/lint.
  3. Commit: "feat: add Soroban reward minting".
  4. PR to `main`.
- Monorepo tips: Use `pnpm turbo run build --filter=...` for targeted builds.
- Guidelines: Follow conventions, add tests, update docs. Adhere to [Code of Conduct](CODE_OF_CONDUCT.md).

## License
MIT License. See [LICENSE](LICENSE).


## Support & Community
- Join the [Lumenpulse Discord](https://discord.gg/gBmApTNVV) for real-time help, discussions, and updates.
- Have questions? Open an issue or DM @pulsefy.

Built with ❤️ by the LumenPulse Team. Powered by Stellar. 🚀
