/**
 * Contract error code registry — TypeScript source of truth.
 *
 * Maps every numeric Soroban contract error code to its contract name,
 * enum variant name, and human-readable message.
 *
 * BREAKING CHANGE: All numeric codes were renumbered during the error-code
 * standardization (issue #1227). Each contract now occupies a dedicated range
 * of 100 codes so that any code uniquely identifies the originating contract:
 *
 * | Contract               | Range       |
 * |------------------------|-------------|
 * | contributor_registry   | 1001–1099   |
 * | vesting-wallet         | 1101–1199   |
 * | project_registry       | 1201–1299   |
 * | treasury               | 1301–1399   |
 * | crowdfund_vault        | 1401–1499   |
 * | lumenpulse-curation    | 1501–1599   |
 * | feature_flags          | 1601–1699   |
 * | notification_broker    | 1701–1799   |
 * | upgradable-contract    | 1801–1899   |
 * | cross-contract-view    | 1901–1999   |
 * | pricing_adapter        | 2001–2099   |
 * | matching_pool          | 2101–2199   |
 * | protocol_registry      | 2201–2299   |
 * | yield_vault            | 2301–2399   |
 *
 * See document/contract-error-codes.md for the full allocation guide.
 */

export interface ContractErrorEntry {
  /** Directory name of the originating contract. */
  contract: string;
  /** Rust enum variant name. */
  variant: string;
  /** Human-readable error message. */
  message: string;
}

/** Flat lookup from numeric error code → entry. */
export const CONTRACT_ERROR_REGISTRY: Readonly<
  Record<number, ContractErrorEntry>
> = {
  // ── contributor_registry (1001–1022) ─────────────────────────────────────
  1001: { contract: 'contributor_registry', variant: 'NotInitialized',           message: 'Contract is not initialized' },
  1002: { contract: 'contributor_registry', variant: 'AlreadyInitialized',       message: 'Contract is already initialized' },
  1003: { contract: 'contributor_registry', variant: 'Unauthorized',             message: 'Caller is not authorized' },
  1004: { contract: 'contributor_registry', variant: 'ContributorNotFound',      message: 'Contributor not found' },
  1005: { contract: 'contributor_registry', variant: 'ContributorAlreadyExists', message: 'Contributor already exists' },
  1006: { contract: 'contributor_registry', variant: 'InvalidGitHubHandle',      message: 'Invalid GitHub handle' },
  1007: { contract: 'contributor_registry', variant: 'ReputationOverflow',       message: 'Reputation value overflow' },
  1008: { contract: 'contributor_registry', variant: 'GitHubHandleTaken',        message: 'GitHub handle already taken' },
  1009: { contract: 'contributor_registry', variant: 'InvalidMultisigConfig',    message: 'Invalid multisig configuration' },
  1010: { contract: 'contributor_registry', variant: 'TooManySigners',           message: 'Too many signers in multisig' },
  1011: { contract: 'contributor_registry', variant: 'ProposalNotFound',         message: 'Proposal not found' },
  1012: { contract: 'contributor_registry', variant: 'InvalidProposalStatus',    message: 'Invalid proposal status' },
  1013: { contract: 'contributor_registry', variant: 'ProposalExpired',          message: 'Proposal has expired' },
  1014: { contract: 'contributor_registry', variant: 'AlreadySigned',            message: 'Already signed this proposal' },
  1015: { contract: 'contributor_registry', variant: 'BelowThreshold',           message: 'Approvals below required threshold' },
  1016: { contract: 'contributor_registry', variant: 'InvalidNonce',             message: 'Invalid nonce' },
  1017: { contract: 'contributor_registry', variant: 'InvalidSignature',         message: 'Invalid signature' },
  1018: { contract: 'contributor_registry', variant: 'AttestationNotActive',     message: 'Attestation is not active' },
  1019: { contract: 'contributor_registry', variant: 'AttestationNotSuspended',  message: 'Attestation is not suspended' },
  1020: { contract: 'contributor_registry', variant: 'AttestationAlreadyRevoked',message: 'Attestation already revoked' },
  1021: { contract: 'contributor_registry', variant: 'ContributionScopePaused',  message: 'Contribution scope is paused' },
  1022: { contract: 'contributor_registry', variant: 'GovernanceScopePaused',    message: 'Governance scope is paused' },

  // ── vesting-wallet (1101–1111) ────────────────────────────────────────────
  1101: { contract: 'vesting-wallet', variant: 'NotInitialized',       message: 'Contract is not initialized' },
  1102: { contract: 'vesting-wallet', variant: 'AlreadyInitialized',   message: 'Contract is already initialized' },
  1103: { contract: 'vesting-wallet', variant: 'Unauthorized',         message: 'Caller is not authorized' },
  1104: { contract: 'vesting-wallet', variant: 'VestingNotFound',      message: 'Vesting entry not found' },
  1105: { contract: 'vesting-wallet', variant: 'InvalidAmount',        message: 'Invalid amount' },
  1106: { contract: 'vesting-wallet', variant: 'InvalidDuration',      message: 'Invalid vesting duration' },
  1107: { contract: 'vesting-wallet', variant: 'InvalidStartTime',     message: 'Invalid vesting start time' },
  1108: { contract: 'vesting-wallet', variant: 'NothingToClaim',       message: 'Nothing available to claim' },
  1109: { contract: 'vesting-wallet', variant: 'InsufficientBalance',  message: 'Insufficient balance' },
  1110: { contract: 'vesting-wallet', variant: 'Reentrancy',           message: 'Reentrancy detected' },
  1111: { contract: 'vesting-wallet', variant: 'DelegateNotAuthorized',message: 'Delegate is not authorized' },

  // ── project_registry (1201–1212) ──────────────────────────────────────────
  1201: { contract: 'project_registry', variant: 'NotInitialized',           message: 'Contract is not initialized' },
  1202: { contract: 'project_registry', variant: 'AlreadyInitialized',       message: 'Contract is already initialized' },
  1203: { contract: 'project_registry', variant: 'Unauthorized',             message: 'Caller is not authorized' },
  1204: { contract: 'project_registry', variant: 'ProjectNotFound',          message: 'Project not found' },
  1205: { contract: 'project_registry', variant: 'ProjectAlreadyRegistered', message: 'Project already registered' },
  1206: { contract: 'project_registry', variant: 'AlreadyVoted',             message: 'Already voted on this project' },
  1207: { contract: 'project_registry', variant: 'VotingClosed',             message: 'Voting is closed' },
  1208: { contract: 'project_registry', variant: 'InsufficientWeight',       message: 'Insufficient voting weight' },
  1209: { contract: 'project_registry', variant: 'InvalidThreshold',         message: 'Invalid threshold' },
  1210: { contract: 'project_registry', variant: 'ContractPaused',           message: 'Contract is paused' },
  1211: { contract: 'project_registry', variant: 'ProjectAlreadyVerified',   message: 'Project already verified' },
  1212: { contract: 'project_registry', variant: 'ProjectAlreadyRejected',   message: 'Project already rejected' },

  // ── treasury (1301–1323) ──────────────────────────────────────────────────
  1301: { contract: 'treasury', variant: 'NotInitialized',       message: 'Contract is not initialized' },
  1302: { contract: 'treasury', variant: 'AlreadyInitialized',   message: 'Contract is already initialized' },
  1303: { contract: 'treasury', variant: 'Unauthorized',         message: 'Caller is not authorized' },
  1304: { contract: 'treasury', variant: 'InvalidAmount',        message: 'Invalid amount' },
  1305: { contract: 'treasury', variant: 'InvalidDuration',      message: 'Invalid stream duration' },
  1306: { contract: 'treasury', variant: 'InvalidStartTime',     message: 'Invalid stream start time' },
  1307: { contract: 'treasury', variant: 'StreamNotFound',       message: 'Stream not found' },
  1308: { contract: 'treasury', variant: 'NothingToClaim',       message: 'Nothing available to claim' },
  1309: { contract: 'treasury', variant: 'Reentrancy',           message: 'Reentrancy detected' },
  1310: { contract: 'treasury', variant: 'AlreadyExecuted',      message: 'Action already executed' },
  1311: { contract: 'treasury', variant: 'SameBeneficiary',      message: 'New beneficiary must differ from current' },
  1312: { contract: 'treasury', variant: 'ProposalNotFound',     message: 'Proposal not found' },
  1313: { contract: 'treasury', variant: 'ProposalNotApproved',  message: 'Proposal not approved' },
  1314: { contract: 'treasury', variant: 'ProposalAlreadySigned',message: 'Proposal already signed' },
  1315: { contract: 'treasury', variant: 'ProposalExpired',      message: 'Proposal has expired' },
  1316: { contract: 'treasury', variant: 'ProposalNotActive',    message: 'Proposal is not active' },
  1317: { contract: 'treasury', variant: 'WrongProposalAction',  message: 'Wrong proposal action type' },
  1318: { contract: 'treasury', variant: 'InvalidMultisigConfig',message: 'Invalid multisig configuration' },
  1319: { contract: 'treasury', variant: 'TooManySigners',       message: 'Too many signers in multisig' },
  1320: { contract: 'treasury', variant: 'InvalidCliffTime',     message: 'Invalid cliff time' },
  1321: { contract: 'treasury', variant: 'InvalidScheduleStep',  message: 'Invalid schedule step' },
  1322: { contract: 'treasury', variant: 'TooManyInstallments',  message: 'Too many installments requested' },
  1323: { contract: 'treasury', variant: 'Insolvent',            message: 'Treasury is insolvent' },

  // ── crowdfund_vault (1401–1440) ───────────────────────────────────────────
  1401: { contract: 'crowdfund_vault', variant: 'NotInitialized',                  message: 'Contract is not initialized' },
  1402: { contract: 'crowdfund_vault', variant: 'AlreadyInitialized',              message: 'Contract is already initialized' },
  1403: { contract: 'crowdfund_vault', variant: 'Unauthorized',                    message: 'Caller is not authorized' },
  1404: { contract: 'crowdfund_vault', variant: 'ProjectNotFound',                 message: 'Project not found' },
  1405: { contract: 'crowdfund_vault', variant: 'MilestoneNotApproved',            message: 'Milestone not approved' },
  1406: { contract: 'crowdfund_vault', variant: 'InsufficientBalance',             message: 'Insufficient balance' },
  1407: { contract: 'crowdfund_vault', variant: 'ProjectNotActive',                message: 'Project is not active' },
  1408: { contract: 'crowdfund_vault', variant: 'InvalidAmount',                   message: 'Invalid amount' },
  1409: { contract: 'crowdfund_vault', variant: 'AlreadyRegistered',               message: 'Already registered' },
  1410: { contract: 'crowdfund_vault', variant: 'ContributorNotFound',             message: 'Contributor not found' },
  1411: { contract: 'crowdfund_vault', variant: 'ContractPaused',                  message: 'Contract is paused' },
  1412: { contract: 'crowdfund_vault', variant: 'ProjectAlreadyCanceled',          message: 'Project already canceled' },
  1413: { contract: 'crowdfund_vault', variant: 'ProjectNotCancellable',           message: 'Project cannot be canceled' },
  1414: { contract: 'crowdfund_vault', variant: 'RefundFailed',                    message: 'Refund failed' },
  1415: { contract: 'crowdfund_vault', variant: 'ContractNotPaused',               message: 'Contract is not paused' },
  1416: { contract: 'crowdfund_vault', variant: 'YieldProviderNotFound',           message: 'Yield provider not found' },
  1417: { contract: 'crowdfund_vault', variant: 'VotingWindowNotStarted',          message: 'Voting window not started' },
  1418: { contract: 'crowdfund_vault', variant: 'VotingWindowClosed',              message: 'Voting window is closed' },
  1419: { contract: 'crowdfund_vault', variant: 'AlreadyVoted',                    message: 'Already voted' },
  1420: { contract: 'crowdfund_vault', variant: 'InsufficientContributionToVote',  message: 'Insufficient contribution to vote' },
  1421: { contract: 'crowdfund_vault', variant: 'MilestoneAlreadyApproved',        message: 'Milestone already approved' },
  1422: { contract: 'crowdfund_vault', variant: 'MilestoneAlreadyDisputed',        message: 'Milestone already disputed' },
  1423: { contract: 'crowdfund_vault', variant: 'MilestoneNotDisputed',            message: 'Milestone not disputed' },
  1424: { contract: 'crowdfund_vault', variant: 'MilestoneEscrowed',               message: 'Milestone funds are escrowed' },
  1425: { contract: 'crowdfund_vault', variant: 'InvalidRecipient',                message: 'Invalid recipient address' },
  1426: { contract: 'crowdfund_vault', variant: 'UnsupportedStorageVersion',       message: 'Unsupported storage version' },
  1427: { contract: 'crowdfund_vault', variant: 'MigrationRequired',               message: 'Migration required' },
  1428: { contract: 'crowdfund_vault', variant: 'MilestoneExpired',                message: 'Milestone has expired' },
  1429: { contract: 'crowdfund_vault', variant: 'RefundWindowClosed',              message: 'Refund window is closed' },
  1430: { contract: 'crowdfund_vault', variant: 'RefundWindowNotOpen',             message: 'Refund window is not open' },
  1431: { contract: 'crowdfund_vault', variant: 'Reentrancy',                      message: 'Reentrancy detected' },
  1432: { contract: 'crowdfund_vault', variant: 'AlreadyExecuted',                 message: 'Action already executed' },
  1433: { contract: 'crowdfund_vault', variant: 'EmergencyMigrationRequiresPause', message: 'Emergency migration requires contract to be paused' },
  1434: { contract: 'crowdfund_vault', variant: 'MigrationPlanAlreadyExists',      message: 'Migration plan already exists' },
  1435: { contract: 'crowdfund_vault', variant: 'MigrationPlanNotFound',           message: 'Migration plan not found' },
  1436: { contract: 'crowdfund_vault', variant: 'MigrationAlreadyExecuted',        message: 'Migration already executed' },
  1437: { contract: 'crowdfund_vault', variant: 'InvalidMigrationRecipient',       message: 'Invalid migration recipient' },
  1438: { contract: 'crowdfund_vault', variant: 'MigrationAmountExceedsBalance',   message: 'Migration amount exceeds balance' },
  1439: { contract: 'crowdfund_vault', variant: 'MigrationPlanVetoed',             message: 'Migration plan was vetoed' },
  1440: { contract: 'crowdfund_vault', variant: 'InvalidBatch',                    message: 'Invalid batch' },

  // ── lumenpulse-curation (1501–1510) ───────────────────────────────────────
  1501: { contract: 'lumenpulse-curation', variant: 'AlreadyInitialized',     message: 'Contract is already initialized' },
  1502: { contract: 'lumenpulse-curation', variant: 'NotInitialized',         message: 'Contract is not initialized' },
  1503: { contract: 'lumenpulse-curation', variant: 'ProjectNotFound',        message: 'Project not found' },
  1504: { contract: 'lumenpulse-curation', variant: 'VotingClosed',           message: 'Voting is closed' },
  1505: { contract: 'lumenpulse-curation', variant: 'VotingWindowExpired',    message: 'Voting window has expired' },
  1506: { contract: 'lumenpulse-curation', variant: 'VotingWindowNotExpired', message: 'Voting window has not expired' },
  1507: { contract: 'lumenpulse-curation', variant: 'AlreadyVoted',           message: 'Already voted' },
  1508: { contract: 'lumenpulse-curation', variant: 'InsufficientReputation', message: 'Insufficient reputation to vote' },
  1509: { contract: 'lumenpulse-curation', variant: 'InvalidMetadata',        message: 'Invalid metadata' },
  1510: { contract: 'lumenpulse-curation', variant: 'Unauthorized',           message: 'Caller is not authorized' },

  // ── feature_flags (1601–1604) ─────────────────────────────────────────────
  1601: { contract: 'feature_flags', variant: 'NotInitialized',    message: 'Contract is not initialized' },
  1602: { contract: 'feature_flags', variant: 'AlreadyInitialized',message: 'Contract is already initialized' },
  1603: { contract: 'feature_flags', variant: 'Unauthorized',      message: 'Caller is not authorized' },
  1604: { contract: 'feature_flags', variant: 'ContractPaused',    message: 'Contract is paused' },

  // ── notification_broker (1701–1704) ───────────────────────────────────────
  1701: { contract: 'notification_broker', variant: 'NotInitialized',      message: 'Contract is not initialized' },
  1702: { contract: 'notification_broker', variant: 'AlreadyInitialized',  message: 'Contract is already initialized' },
  1703: { contract: 'notification_broker', variant: 'SubscriptionNotFound',message: 'Subscription not found' },
  1704: { contract: 'notification_broker', variant: 'ReentrancyDetected',  message: 'Reentrancy detected' },

  // ── upgradable-contract (1801–1808) ───────────────────────────────────────
  1801: { contract: 'upgradable-contract', variant: 'AlreadyInitialized',     message: 'Contract is already initialized' },
  1802: { contract: 'upgradable-contract', variant: 'Unauthorized',           message: 'Caller is not authorized' },
  1803: { contract: 'upgradable-contract', variant: 'NotInitialized',         message: 'Contract is not initialized' },
  1804: { contract: 'upgradable-contract', variant: 'OperationAlreadyQueued', message: 'Operation already queued' },
  1805: { contract: 'upgradable-contract', variant: 'OperationNotFound',      message: 'Operation not found' },
  1806: { contract: 'upgradable-contract', variant: 'OperationNotReady',      message: 'Operation is not ready to execute' },
  1807: { contract: 'upgradable-contract', variant: 'OperationExpired',       message: 'Operation has expired' },
  1808: { contract: 'upgradable-contract', variant: 'InvalidDelay',           message: 'Invalid timelock delay' },

  // ── cross-contract-view (1901–1908) ───────────────────────────────────────
  1901: { contract: 'cross-contract-view', variant: 'NotFound',               message: 'Data not found in storage' },
  1902: { contract: 'cross-contract-view', variant: 'NotInitialized',         message: 'Contract not initialized' },
  1903: { contract: 'cross-contract-view', variant: 'Unauthorized',           message: 'Caller is not authorized' },
  1904: { contract: 'cross-contract-view', variant: 'InvalidContract',        message: 'Invalid or unregistered contract address' },
  1905: { contract: 'cross-contract-view', variant: 'TypeMismatch',           message: 'Type conversion failed' },
  1906: { contract: 'cross-contract-view', variant: 'StorageError',           message: 'Storage operation failed' },
  1907: { contract: 'cross-contract-view', variant: 'TokenError',             message: 'Token operation failed' },
  1908: { contract: 'cross-contract-view', variant: 'CrossContractCallFailed',message: 'Cross-contract call failed' },

  // ── pricing_adapter (2001–2007) ───────────────────────────────────────────
  2001: { contract: 'pricing_adapter', variant: 'NotInitialized',    message: 'Contract is not initialized' },
  2002: { contract: 'pricing_adapter', variant: 'AlreadyInitialized',message: 'Contract is already initialized' },
  2003: { contract: 'pricing_adapter', variant: 'Unauthorized',      message: 'Caller is not authorized' },
  2004: { contract: 'pricing_adapter', variant: 'PriceNotFound',     message: 'Price not found' },
  2005: { contract: 'pricing_adapter', variant: 'InvalidPrice',      message: 'Invalid price' },
  2006: { contract: 'pricing_adapter', variant: 'StalePrice',        message: 'Price data is stale' },
  2007: { contract: 'pricing_adapter', variant: 'PriceInvalidated',  message: 'Price has been invalidated' },

  // ── matching_pool (2101–2121) ─────────────────────────────────────────────
  2101: { contract: 'matching_pool', variant: 'NotInitialized',          message: 'Contract is not initialized' },
  2102: { contract: 'matching_pool', variant: 'AlreadyInitialized',      message: 'Contract is already initialized' },
  2103: { contract: 'matching_pool', variant: 'Unauthorized',            message: 'Caller is not authorized' },
  2104: { contract: 'matching_pool', variant: 'RoundNotFound',           message: 'Round not found' },
  2105: { contract: 'matching_pool', variant: 'RoundNotActive',          message: 'Round is not active' },
  2106: { contract: 'matching_pool', variant: 'RoundAlreadyFinalized',   message: 'Round already finalized' },
  2107: { contract: 'matching_pool', variant: 'RoundNotFinalized',       message: 'Round not finalized' },
  2108: { contract: 'matching_pool', variant: 'ProjectNotEligible',      message: 'Project is not eligible' },
  2109: { contract: 'matching_pool', variant: 'ProjectAlreadyEligible',  message: 'Project already eligible' },
  2110: { contract: 'matching_pool', variant: 'InvalidAmount',           message: 'Invalid amount' },
  2111: { contract: 'matching_pool', variant: 'InsufficientPoolBalance', message: 'Insufficient pool balance' },
  2112: { contract: 'matching_pool', variant: 'NoEligibleProjects',      message: 'No eligible projects' },
  2113: { contract: 'matching_pool', variant: 'RoundStillOpen',          message: 'Round is still open' },
  2114: { contract: 'matching_pool', variant: 'MatchAlreadyDistributed', message: 'Match already distributed' },
  2115: { contract: 'matching_pool', variant: 'InvalidRoundDates',       message: 'Invalid round dates' },
  2116: { contract: 'matching_pool', variant: 'ContractPaused',          message: 'Contract is paused' },
  2117: { contract: 'matching_pool', variant: 'Reentrancy',              message: 'Reentrancy detected' },
  2118: { contract: 'matching_pool', variant: 'ContributionCapExceeded', message: 'Contribution cap exceeded' },
  2119: { contract: 'matching_pool', variant: 'ContributionScopePaused', message: 'Contribution scope is paused' },
  2120: { contract: 'matching_pool', variant: 'PayoutScopePaused',       message: 'Payout scope is paused' },
  2121: { contract: 'matching_pool', variant: 'GovernanceScopePaused',   message: 'Governance scope is paused' },

  // ── protocol_registry (2201–2208) ─────────────────────────────────────────
  2201: { contract: 'protocol_registry', variant: 'NotInitialized',          message: 'Contract is not initialized' },
  2202: { contract: 'protocol_registry', variant: 'AlreadyInitialized',      message: 'Contract is already initialized' },
  2203: { contract: 'protocol_registry', variant: 'Unauthorized',            message: 'Caller is not authorized' },
  2204: { contract: 'protocol_registry', variant: 'ModuleNotFound',          message: 'Module not found' },
  2205: { contract: 'protocol_registry', variant: 'ModuleAlreadyRegistered', message: 'Module already registered' },
  2206: { contract: 'protocol_registry', variant: 'ModuleInactive',          message: 'Module is inactive' },
  2207: { contract: 'protocol_registry', variant: 'ContractPaused',          message: 'Contract is paused' },
  2208: { contract: 'protocol_registry', variant: 'VersionNotIncremented',   message: 'Version must be incremented' },

  // ── yield_vault (2301–2310) ───────────────────────────────────────────────
  2301: { contract: 'yield_vault', variant: 'AlreadyInitialized',  message: 'Contract is already initialized' },
  2302: { contract: 'yield_vault', variant: 'NotInitialized',      message: 'Contract is not initialized' },
  2303: { contract: 'yield_vault', variant: 'InvalidAmount',       message: 'Invalid amount' },
  2304: { contract: 'yield_vault', variant: 'InsufficientBalance', message: 'Insufficient balance' },
  2305: { contract: 'yield_vault', variant: 'ProviderNotFound',    message: 'Yield provider not found' },
  2306: { contract: 'yield_vault', variant: 'NoProvidersAvailable',message: 'No yield providers available' },
  2307: { contract: 'yield_vault', variant: 'AlreadyExecuted',     message: 'Action already executed' },
  2308: { contract: 'yield_vault', variant: 'Unauthorized',        message: 'Caller is not authorized' },
  2309: { contract: 'yield_vault', variant: 'VaultPaused',         message: 'Vault is paused' },
  2310: { contract: 'yield_vault', variant: 'Reentrancy',          message: 'Reentrancy detected' },
} as const;

/**
 * Declared numeric ranges per contract.
 * Used by the overlap guard test to verify no two contracts share a code.
 */
export const CONTRACT_RANGES: Readonly<Record<string, [number, number]>> = {
  contributor_registry:   [1001, 1099],
  'vesting-wallet':       [1101, 1199],
  project_registry:       [1201, 1299],
  treasury:               [1301, 1399],
  crowdfund_vault:        [1401, 1499],
  'lumenpulse-curation':  [1501, 1599],
  feature_flags:          [1601, 1699],
  notification_broker:    [1701, 1799],
  'upgradable-contract':  [1801, 1899],
  'cross-contract-view':  [1901, 1999],
  pricing_adapter:        [2001, 2099],
  matching_pool:          [2101, 2199],
  protocol_registry:      [2201, 2299],
  yield_vault:            [2301, 2399],
} as const;
