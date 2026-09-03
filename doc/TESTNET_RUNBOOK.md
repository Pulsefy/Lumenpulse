# LumenPulse Stellar Testnet Runbook

## 1. Purpose

This runbook documents the current procedure for building, deploying, initializing, and validating LumenPulse Soroban contracts on the Stellar Testnet.

All deployment steps in this document are intended for **Stellar Testnet**, not production.

---

## 2. Stellar Testnet Configuration

Use the following configuration:

```text
Network: Stellar Testnet
Network Passphrase: Test SDF Network ; September 2015
Soroban RPC: https://soroban-testnet.stellar.org
Horizon: https://horizon-testnet.stellar.org
```

> Verify the network passphrase and endpoints before deployment.

---

## 3. Deployment Configuration

Deployment scripts are located in:

```text
scripts/
├── contracts.config.ts
├── deploy.ts
├── utils.ts
├── package.json
└── .env.example
```

The deployment script reads these environment variables:

```text
NETWORK_PASSPHRASE
SOROBAN_RPC_URL
HORIZON_URL
ADMIN_SECRET
```

Create:

```text
scripts/.env
```

with:

```env
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
SOROBAN_RPC_URL="https://soroban-testnet.stellar.org"
HORIZON_URL="https://horizon-testnet.stellar.org"
ADMIN_SECRET=YOUR_TESTNET_SECRET_KEY
```

**Never commit `scripts/.env` or expose `ADMIN_SECRET`.**

---

## 4. Install Deployment Dependencies

From the repository root:

```powershell
cd scripts
npm install
```

Return to the repository root:

```powershell
cd ..
```

---

## 5. Build the Contracts

From the repository root:

```powershell
cd apps\onchain
cargo build --release --target wasm32-unknown-unknown
```

Verify the generated WASM files:

```powershell
Get-ChildItem target\wasm32-unknown-unknown\release\*.wasm
```

The current deployment configuration expects:

```text
lumen_token.wasm
contributor_registry.wasm
crowdfund_vault.wasm
vesting_wallet.wasm
```

Return to the repository root:

```powershell
cd ..\..
```

---

## 6. Current Deployment Order

The current `scripts/contracts.config.ts` deploys these contracts in this order:

1. `token`
2. `registry`
3. `vault`
4. `vesting_wallet`

### Token

Initialization:

```text
admin
decimal = 7
name = LumenToken
symbol = LUMEN
```

### Contributor Registry

Initialization:

```text
admin
```

### Crowdfund Vault

Initialization:

```text
admin
```

### Vesting Wallet

Initialization:

```text
admin
token contract address
```

The Vesting Wallet therefore depends on the Token contract being deployed first.

---

## 7. Deploy to Testnet

From the repository root:

```powershell
cd scripts
npm run deploy
```

The deployment script:

1. Loads the administrator keypair.
2. Loads the configured contract list.
3. Resolves each WASM file.
4. Uploads the WASM.
5. Creates the contract.
6. Obtains the contract ID.
7. Initializes the contract.
8. Writes deployment information to:

```text
scripts/contract-ids.json
```

---

## 8. Verify Deployment

After deployment:

```powershell
Get-Content contract-ids.json
```

Confirm that contract IDs were generated for:

```text
token
registry
vault
vesting_wallet
```

Also check the repository:

```powershell
cd ..
git status --short
```

---

## 9. Test the On-Chain Workspace

Run:

```powershell
cd apps\onchain
cargo test
```

If tests fail, record the exact package and error. Do not report the deployment as fully validated until the relevant failures have been reviewed.

---

## 10. Important Repository Findings

### Network Passphrase

The existing `scripts/.env.example` contains:

```text
Test SDA Network ; September 2015
```

The Testnet configuration should use:

```text
Test SDF Network ; September 2015
```

### RPC Variable

`scripts/.env.example` currently defines:

```text
RPC_URL
```

but `scripts/deploy.ts` reads:

```text
SOROBAN_RPC_URL
```

Therefore, the deployment environment should define:

```env
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

### Contract Coverage

The repository contains more contracts than the deployment script currently configures.

The current deployment script only deploys:

```text
token
registry
vault
vesting_wallet
```

The presence of another contract under:

```text
apps/onchain/contracts/
```

does **not** mean that it will automatically be deployed.

---

## 11. Security Requirements

Before deployment:

* Confirm the network is Stellar Testnet.
* Confirm the administrator account is a Testnet account.
* Confirm the account has sufficient Testnet XLM.
* Confirm the required WASM files exist.
* Confirm initialization arguments match the contract functions.
* Never commit `ADMIN_SECRET`.
* Never place private keys or secrets in this runbook.
* Do not use production credentials or production endpoints.

---

## 12. Deployment Record

Record the following after a successful Testnet deployment:

```text
Deployment date:
Git commit:
Network:
Admin public key:
Token contract ID:
Contributor Registry contract ID:
Crowdfund Vault contract ID:
Vesting Wallet contract ID:
WASM hashes:
Deployment transaction hashes:
Initialization transaction hashes:
Validation status:
Known issues:
```

Do not record private keys, secret keys, passwords, or other credentials.

---

## 13. Final Checklist

* [ ] Testnet network confirmed
* [ ] Correct Testnet passphrase configured
* [ ] Soroban Testnet RPC configured
* [ ] Horizon Testnet endpoint configured
* [ ] Testnet administrator configured
* [ ] Deployment dependencies installed
* [ ] WASM artifacts built
* [ ] Token deployed
* [ ] Contributor Registry deployed
* [ ] Crowdfund Vault deployed
* [ ] Vesting Wallet deployed
* [ ] Contracts initialized successfully
* [ ] `contract-ids.json` generated
* [ ] Relevant tests executed
* [ ] Deployment transactions recorded
* [ ] No secrets committed
* [ ] Known issues documented
