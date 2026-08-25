# Contract Capability Catalog Endpoint

## Overview
The Contract Capability Catalog endpoint provides a machine-readable catalog of blockchain contract capabilities available in the current environment. This endpoint enables frontend and mobile clients to safely discover which contracts are available, their identifiers, and the methods they support.

## Endpoint

### GET `/v1/contracts/capabilities`
Returns the complete contract capability catalog.

**Response Example:**
```json
{
  "environment": "development",
  "apiVersion": "v1",
  "catalogVersion": "1.0.0",
  "generatedAt": "2026-06-28T10:00:00Z",
  "contracts": [
    {
      "contractId": "lumen-token",
      "displayName": "Lumen Token",
      "version": "1.0.0",
      "status": "active",
      "category": "token",
      "address": "CCOVDGHF3XQ5RAFY6DJ36G6CHQJF54QCOBZXCC3LBMKNEWQJLDGXQJSB",
      "supportedMethods": [
        {
          "name": "decimals",
          "category": "read-only",
          "description": "Returns the number of decimals used by the token",
          "public": true
        },
        {
          "name": "transfer",
          "category": "write",
          "description": "Transfers tokens between accounts",
          "public": true
        }
      ],
      "network": "testnet",
      "lastValidatedAt": "2026-06-28T10:00:00Z"
    }
  ]
}
```

### GET `/v1/contracts/capabilities/{contractId}`
Returns capabilities for a specific contract.

**Path Parameters:**
- `contractId` (string): Contract identifier (e.g., `lumen-token`, `crowdfund-vault`)

**Response Example:**
```json
{
  "contractId": "lumen-token",
  "displayName": "Lumen Token",
  "version": "1.0.0",
  "status": "active",
  "category": "token",
  "address": "CCOVDGHF3XQ5RAFY6DJ36G6CHQJF54QCOBZXCC3LBMKNEWQJLDGXQJSB",
  "supportedMethods": [
    {
      "name": "decimals",
      "category": "read-only",
      "description": "Returns the number of decimals used by the token",
      "public": true
    }
  ],
  "network": "testnet",
  "lastValidatedAt": "2026-06-28T10:00:00Z"
}
```

## Available Contracts

The catalog includes the following contracts:

### 1. Lumen Token (`lumen-token`)
- **Category:** Token
- **Description:** ERC-20 style token contract for Lumen tokens
- **Status:** Active (when deployed)
- **Public Methods:** `decimals`, `symbol`, `balance`, `transfer`, `approve`, `transfer_from`

### 2. Crowdfund Vault (`crowdfund-vault`)
- **Category:** Vault
- **Description:** Holds crowdfunding contributions and manages distributions
- **Status:** Active (when deployed)
- **Public Methods:** `get_admin`, `get_storage_version`, `contribute`, `withdraw`, `get_contribution`

### 3. Project Registry (`project-registry`)
- **Category:** Registry
- **Description:** Stores project metadata and configurations
- **Status:** Active (when deployed)
- **Public Methods:** `get_admin`, `get_config`, `register_project`, `update_project`, `get_project`

### 4. Contributor Registry (`contributor-registry`)
- **Category:** Registry
- **Description:** Tracks contributor information and permissions
- **Status:** Active (when deployed)
- **Public Methods:** `get_multisig_config`, `register_contributor`, `update_contributor`, `get_contributor`, `verify_contributor`

### 5. Matching Pool (`matching-pool`)
- **Category:** Pool
- **Description:** Manages quadratic funding matching amounts
- **Status:** Active (when deployed)
- **Public Methods:** `get_admin`, `calculate_match`, `distribute_matching`, `get_matching_stats`

### 6. Treasury (`treasury`)
- **Category:** Treasury
- **Description:** Manages protocol funds and reserves
- **Status:** Active (when deployed)
- **Public Methods:** `get_admin`, `get_token`, `allocate_budget`, `rotate_beneficiary`, `get_stream`

### 7. Vesting Wallet (`vesting-wallet`)
- **Category:** Vesting
- **Description:** Manages token vesting schedules for contributors
- **Status:** Uses contributorRegistry address
- **Public Methods:** `create_vesting`, `create_vesting_with_milestone`, `get_vesting`, `withdraw_vested`, `get_vesting_stats`

### 8. Pricing Adapter (`pricing-adapter`)
- **Category:** Adapter
- **Description:** Converts between different pricing mechanisms and tokens
- **Status:** Active (when deployed)
- **Public Methods:** `get_config`, `convert`, `update_rate`, `get_rate`

## Implementation Details

### Architecture
- **Controller:** `ContractsController` (versioned at `/v1/contracts`)
- **Service:** `ContractCapabilityService` (centralized catalog management)
- **DTOs:** `ContractCapabilityCatalogResponseDto`, `ContractCapabilityDto`, `ContractMethodDto`
- **Module:** `ContractsModule` (imports `AppConfigModule`)

### Data Sources
1. **Contract Definitions:** Hardcoded in `ContractCapabilityService` with method metadata
2. **Contract Addresses:** Retrieved from `ConfigService.getStellarConfig()`
3. **Environment Info:** Derived from `NODE_ENV` and API versioning
4. **Network Info:** From Stellar configuration

### Caching
- **Cache Duration:** 5 minutes (300,000 ms)
- **Cache Strategy:** `@CacheInterceptor` with `@CacheTTL(300_000)`
- **Rationale:** Contract capabilities rarely change at runtime

### Security Considerations
- **Public Access:** No authentication required (safe public data only)
- **Data Exposure:** Only public method names and descriptions
- **No Secrets:** No private keys, RPC credentials, or sensitive configuration
- **Safe for Clients:** Frontend and mobile applications can consume directly

## Usage Examples

### Frontend Integration
```javascript
// Fetch contract capabilities
async function loadContractCapabilities() {
  const response = await fetch('/v1/contracts/capabilities');
  const catalog = await response.json();
  
  // Find specific contract
  const lumenToken = catalog.contracts.find(c => c.contractId === 'lumen-token');
  
  // Check available methods
  const readMethods = lumenToken.supportedMethods.filter(m => m.category === 'read-only');
  
  return catalog;
}
```

### Mobile Integration
```dart
// Example for Flutter/Dart
Future<Map<String, dynamic>> fetchContractCapabilities() async {
  final response = await http.get(Uri.parse('https://api.lumenpulse.io/v1/contracts/capabilities'));
  final catalog = jsonDecode(response.body);
  return catalog;
}
```

## Future Extensions

### Planned Enhancements
1. **Method Parameters:** Include parameter types and validation rules
2. **Event Schemas:** Include contract event definitions
3. **ABI References:** Link to contract ABIs for advanced clients
4. **Version History:** Track contract version changes over time
5. **Network-Specific:** Different capabilities per network (testnet/mainnet)

### Integration Points
- **Frontend:** Dynamic contract interaction UIs
- **Mobile:** Offline capability caching
- **CLI Tools:** Contract discovery and validation
- **Documentation:** Auto-generated API docs from catalog

## Testing

### Unit Tests
- `contracts.controller.spec.ts` - Controller tests
- `contract-capability.service.spec.ts` - Service tests

### Test Coverage
- Endpoint returns HTTP 200
- Response contains environment metadata
- Response contains contracts array
- SupportedMethods is present for each contract
- Response excludes sensitive fields
- Contract-specific endpoint works correctly

## Maintenance

### Adding New Contracts
1. Add contract definition to `ContractCapabilityService.contractDefinitions`
2. Update DTOs if new fields are needed
3. Add tests for the new contract
4. Update this documentation

### Updating Existing Contracts
1. Modify method definitions in `ContractCapabilityService`
2. Update version number if breaking changes
3. Run tests to verify backward compatibility
4. Update documentation

### Deployment Notes
- The catalog reflects deployed contract addresses from environment configuration
- Undeployed contracts show as `status: 'upcoming'`
- Contract addresses update automatically when configuration changes