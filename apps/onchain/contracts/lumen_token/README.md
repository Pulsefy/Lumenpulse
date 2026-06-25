# Lumen Token Contract

An implementation of the standard Soroban token interface tailored for the Lumenpulse network architecture. This asset handles standard supply minting, individual wallet balances, delegated authority allowances, frozen balances, and upgrades.

---

## 🚀 Testnet Deployment Configuration

This asset contract is actively deployed and initialized on the Stellar Testnet:

| Parameter Key | Value Reference |
| :--- | :--- |
| **Contract ID** | `CDAQQJHUVNQLSUDEXOTPT3V5GWGH5VFVGHMZRE5CCMHUTIORWWH6R3ZR` |
| **Network Target** | Stellar Testnet (`testnet`) |
| **WASM Hash** | `143ce02a24f71f8a0423d49dce69f9f4cee7a23abb01a4153207ecdb4545c731` |
| **Admin Address** | `GA5TBSBGERHVMEFBJGEM3KYMRLWO73Y2QRAV6P66GPEBOJ5ZMJUT7LLY` |
| **Configured Decimals** | `7` |

---

## 🛠️ Core Interface Methods

### Administrative Capabilities

* **`initialize(e: Env, admin: Address, decimal: u32, name: String, symbol: String)`** Configures the identity structure, sets initial display metadata, and locks down the administration keys. Throws an explicit `already initialized` panic if executed a second time.
* **`mint(e: Env, to: Address, amount: i128)`** Generates new supply tokens and directs them to a target wallet address. Requires explicit authorization signature matching the recorded administrative profile.
* **`freeze(e: Env, id: Address)` / **`unfreeze(e: Env, id: Address)`** Toggles internal transfer restriction matrices for target addresses to protect ecosystem security during risk incidents.
* **`upgrade(e: Env, caller: Address, new_wasm_hash: BytesN<32>)`** Swaps the backing WASM logic bytecode directly on-chain, keeping the exact same contract address pointer while upgrading underlying logic.

### Client Token Mechanics

* **`transfer(e: Env, from: Address, to: Address, amount: i128)`** Moves an explicit balance amount between two valid ledger addresses. Authenticates the `from` signature key automatically.
* **`approve(e: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32)`** Authorizes an external third-party contract or wallet address to draw down up to a set amount of tokens until a targeted ledger block height.
* **`transfer_from(e: Env, spender: Address, from: Address, to: Address, amount: i128)`** Executes a cross-wallet movement on behalf of a target user, decrementing the available approved allowance value. Used by external contracts to pull funding safely.

---

## 📊 Read-Only State Resolvers

```rust
pub fn balance(e: Env, id: Address) -> i128;
pub fn allowance(e: Env, from: Address, spender: Address) -> i128;
pub fn decimals(e: Env) -> u32;
pub fn name(e: Env) -> String;
pub fn symbol(e: Env) -> String;
```

---
