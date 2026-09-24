# Error Code Allocation Scheme

To prevent overlapping error codes from different contracts and ensure unique identification of errors in the backend, each contract is assigned a specific range of 100 error codes.

| Contract             | Range       |
| -------------------- | ----------- |
| contract_registry    | 1000 - 1099 |
| contributor_registry | 1100 - 1199 |
| cross-contract-view  | 1200 - 1299 |
| crowdfund_vault      | 1300 - 1399 |
| feature_flags        | 1400 - 1499 |
| lumenpulse-curation  | 1500 - 1599 |
| matching_pool        | 1600 - 1699 |
| notification_broker  | 1700 - 1799 |
| pricing_adapter      | 1800 - 1899 |
| project_registry     | 1900 - 1999 |
| protocol_registry    | 2000 - 2099 |
| treasury             | 2100 - 2199 |
| upgradable-contract  | 2200 - 2299 |
| vesting-wallet       | 2300 - 2399 |
| yield_vault          | 2400 - 2499 |

This change is **BREAKING**. Any clients depending on raw numeric error codes need to be updated.
