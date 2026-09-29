# System Architecture: Lumenpulse

**Version**: 1.0.0  
**Last Updated**: 2026-02-25  
**Status**: Active Development

## 1. Overview

Lumenpulse is a comprehensive platform combining decentralized finance (DeFi) capabilities on the Stellar network with traditional portfolio management and news analytics. The system architecture integrates a React Native mobile application, a NestJS backend API, a Python data processing pipeline, and Soroban smart contracts to deliver a seamless user experience for managing assets, tracking investments, and participating in crowdfunding initiatives.

## 2. System Architecture Diagram

The following diagram illustrates the high-level architecture and interaction patterns between the core components:

```mermaid
graph TD
    subgraph Client Layer
        Mobile[Mobile App (React Native)]
        Wallet[Stellar Wallet (Freighter/Albedo)]
    end

    subgraph Backend Services
        API[Backend API (NestJS)]
        Auth[Auth Service]
        Portfolio[Portfolio Service]
        Indexer[Crowdfund Indexer]
    end

    subgraph Data Layer
        DB[(Postgres Database)]
        Redis[(Redis Cache)]
    end

    subgraph Blockchain Layer
        Horizon[Stellar Horizon API]
        Soroban[Soroban RPC]
        Contracts[Smart Contracts (Rust)]
    end

    subgraph External Services
        NewsAPI[News Providers]
        PriceAPI[Price Feeds]
    end

    %% Client Interactions
    Mobile -->|HTTPS/REST| API
    Mobile -->|Sign/Submit| Wallet
    Wallet -->|Submit Tx| Horizon

    %% Backend Interactions
    API -->|Read/Write| DB
    API -->|Cache| Redis
    API -->|Query| Horizon
    API -->|Query Events| Soroban

    %% Internal Service Flows
    Auth -->|Validate| DB
    Portfolio -->|Sync Balances| Horizon
    Indexer -->|Listen Events| Soroban
    Indexer -->|Update State| DB

    %% External Data
    API -->|Fetch News| NewsAPI
    Portfolio -->|Get Prices| PriceAPI
```

## 3. Critical Data Flows

### 3.1 User Authentication Flow (JWT)

The authentication system uses JSON Web Tokens (JWT) to secure communication between the mobile app and the backend API.

**Flow Description:**
1.  **Initiation**: User enters credentials (email/password) in the Mobile App.
2.  **Request**: Mobile App sends a `POST /auth/login` request to the Backend API.
3.  **Validation**:
    *   The `AuthService` retrieves the user record from the Postgres database.
    *   It verifies the password hash using `bcrypt`.
4.  **Token Issuance**:
    *   Upon successful validation, the backend generates an `access_token` (short-lived) and a `refresh_token` (long-lived).
    *   The tokens are signed with a secure secret key.
5.  **Response**: The backend returns the tokens to the Mobile App.
6.  **Storage**: The Mobile App stores the tokens securely (e.g., in `SecureStore`).
7.  **Authenticated Requests**: For subsequent requests (e.g., `GET /portfolio`), the Mobile App includes the `access_token` in the `Authorization` header (`Bearer <token>`).
8.  **Guard Verification**: The backend's `JwtAuthGuard` intercepts requests, validates the token signature and expiration, and attaches the user context to the request object.

**Security Considerations:**
*   **HTTPS**: All communication is encrypted over SSL/TLS.
*   **Token Expiry**: Access tokens have a short lifespan (e.g., 15 minutes) to minimize risk if compromised.
*   **Refresh Rotation**: Refresh tokens are used to obtain new access tokens without re-entering credentials, and can be revoked server-side.

### 3.2 Portfolio Data Sync Flow

This flow synchronizes the user's on-chain Stellar assets with the application's local database to provide a unified view of their portfolio.

**Flow Description:**
1.  **Trigger**: The user opens the Portfolio tab in the Mobile App, or a scheduled background job runs.
2.  **Request**: Mobile App calls `GET /portfolio/history` or triggers a sync via `POST /portfolio/snapshot`.
3.  **Data Retrieval**:
    *   The backend's `PortfolioService` identifies the user's linked Stellar Public Key.
    *   It queries the **Stellar Horizon API** (`/accounts/{publicKey}`) to fetch current balances for native XLM and other assets.
4.  **Price Resolution**:
    *   The service resolves the current USD value of each asset using an external price feed or internal price cache.
5.  **Snapshot Creation**:
    *   A new `PortfolioSnapshot` record is created in the Postgres database, capturing the asset composition and total value at that point in time.
6.  **Response**: The updated portfolio data and historical performance metrics are returned to the Mobile App for display.

**API Endpoints:**
*   `GET /portfolio/history`: Retrieves historical value snapshots.
*   `POST /portfolio/snapshot`: Forces a real-time sync with the blockchain.

### 3.3 Crowdfund Interaction Flow

This flow describes how users participate in crowdfunding campaigns governed by Soroban smart contracts.

**Flow Description:**
1.  **Campaign Discovery**: The Mobile App fetches available campaigns from the backend (`GET /crowdfund/campaigns`), which are indexed from on-chain state.
2.  **Contribution Initiation**:
    *   User selects a campaign and an amount to contribute.
    *   The Mobile App constructs a Soroban transaction invoking the `deposit` function on the `CrowdfundVault` contract.
3.  **Signing & Submission**:
    *   The transaction is passed to the user's wallet (e.g., Freighter) for signing.
    *   The signed transaction is submitted to the **Soroban RPC** endpoint.
4.  **On-Chain Execution**:
    *   The smart contract validates the contribution (e.g., checks deadlines, amounts).
    *   If successful, it updates the contract state (ledger) and emits a `Deposit` event.
5.  **Indexing & Updates**:
    *   The backend **Indexer Service** monitors the blockchain for events from known Crowdfund contracts.
    *   Upon detecting a `Deposit` event, it updates the campaign's funded amount and the user's contribution record in the Postgres database.
6.  **Notification**: The backend may push a notification to the Mobile App confirming the successful contribution.

**Smart Contract Components:**
*   **CrowdfundVault**: Manages deposits, milestone tracking, and fund release.
*   **LumenToken**: Custom token used for contributions (if not native XLM).

## 4. Technology Stack Rationale

### 4.1 Backend API: NestJS
*   **Modular Architecture**: NestJS provides a structured, opinionated framework (Modules, Controllers, Services) that scales well for complex enterprise applications.
*   **TypeScript Support**: First-class TypeScript support ensures type safety across the entire stack, sharing interfaces with the frontend where possible.
*   **Ecosystem**: Extensive ecosystem for integration with Postgres (TypeORM), Auth (Passport), and Validation (class-validator).

### 4.2 Mobile App: React Native (Expo)
*   **Cross-Platform**: Allows maintaining a single codebase for both iOS and Android, significantly reducing development time and cost.
*   **Expo Ecosystem**: Expo provides a robust set of pre-built libraries (Router, SecureStore) and simplified build/deployment pipelines.
*   **Performance**: Near-native performance for the UI, with the flexibility of React for business logic.

### 4.3 Blockchain: Soroban (Stellar)
*   **Scalability**: Built on Stellar, Soroban inherits the network's high throughput and low transaction fees, essential for micro-payments and frequent crowdfunding interactions.
*   **Smart Contract Safety**: Rust-based contracts offer memory safety and performance, reducing the risk of common vulnerabilities found in other smart contract languages.
*   **Integration**: Seamless integration with existing Stellar assets (XLM, USDC) allows for easy value transfer.

### 4.4 Database: PostgreSQL
*   **Relational Integrity**: Essential for managing structured data like user profiles, complex relationships between entities (Users <-> Accounts <-> Snapshots), and ensuring data consistency (ACID compliance).
*   **Extensibility**: robust support for JSON types allows for flexible storage of semi-structured data (e.g., varied asset metadata) while maintaining relational rigor for core data.
*   **Performance**: Proven performance and reliability for high-concurrency read/write operations required by the indexer and API.

## 5. Security Architecture

*   **API Security**: Rate limiting (Throttler), Helmet for HTTP headers, and CORS policies protect the API.
*   **Data Protection**: Sensitive user data (passwords) is hashed using bcrypt. Environment variables manage secrets.
*   **Blockchain Security**: Smart contracts undergo rigorous testing (snapshot testing) to prevent logic errors. Users maintain custody of their private keys; the backend never stores raw private keys for transaction signing.

---
