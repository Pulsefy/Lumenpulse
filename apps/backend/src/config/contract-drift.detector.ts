import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export interface ManifestContractEntry {
  id?: unknown;
  wasm_hash?: unknown;
}

export interface TestnetManifest {
  network?: unknown;
  contracts?: Record<string, ManifestContractEntry>;
}

export interface ContractSource {
  id: string;
  path: string;
  contracts: Record<string, string[]>;
}

export interface SourceContractValue {
  variable: string;
  value: string;
}

export interface ContractDriftFinding {
  source: string;
  path: string;
  contract: string;
  variable: string;
  expected: string;
  actual: string;
}

export interface ContractMissingFinding {
  source: string;
  path: string;
  contract: string;
  variables: string[];
  expected: string;
}

export interface ContractDriftReport {
  ok: boolean;
  generatedAt: string;
  manifest: {
    path: string;
    network: string;
    contracts: Record<string, string>;
  };
  summary: {
    sourcesChecked: number;
    contractValuesChecked: number;
    driftCount: number;
    missingCount: number;
  };
  drift: ContractDriftFinding[];
  missing: ContractMissingFinding[];
}

export interface BuildContractDriftReportOptions {
  generatedAt?: string;
  failOnMissing?: boolean;
}

const CONTRACT_ENV_NAMES: Record<string, string[]> = {
  contributor_registry: [
    'CONTRIBUTOR_REGISTRY_CONTRACT_ID',
    'STELLAR_CONTRACT_CONTRIBUTOR_REGISTRY',
  ],
  project_registry: [
    'PROJECT_REGISTRY_CONTRACT_ID',
    'STELLAR_CONTRACT_PROJECT_REGISTRY',
  ],
  crowdfund_vault: [
    'CROWDFUND_VAULT_CONTRACT_ID',
    'STELLAR_CONTRACT_CROWDFUND_VAULT',
  ],
  matching_pool: [
    'MATCHING_POOL_CONTRACT_ID',
    'STELLAR_CONTRACT_MATCHING_POOL',
  ],
  treasury: ['TREASURY_CONTRACT_ID', 'STELLAR_CONTRACT_TREASURY'],
  lumen_token: ['LUMEN_TOKEN_CONTRACT_ID', 'STELLAR_CONTRACT_LUMEN_TOKEN'],
  pricing_adapter: [
    'PRICING_ADAPTER_CONTRACT_ID',
    'STELLAR_CONTRACT_PRICING_ADAPTER',
  ],
};

export const DEFAULT_CONTRACT_SOURCES: ContractSource[] = [
  {
    id: 'backend.env.example',
    path: 'apps/backend/.env.example',
    contracts: CONTRACT_ENV_NAMES,
  },
  {
    id: 'webapp.env.local.example',
    path: 'apps/webapp/.env.local.example',
    contracts: {
      crowdfund_vault: [
        'NEXT_PUBLIC_TESTNET_CROWDFUND_CONTRACT_ID',
        'NEXT_PUBLIC_CROWDFUND_CONTRACT_ID',
      ],
    },
  },
  {
    id: 'mobile.env.example',
    path: 'apps/mobile/.env.example',
    contracts: {
      crowdfund_vault: [
        'EXPO_PUBLIC_TESTNET_CROWDFUND_CONTRACT_ID',
        'EXPO_PUBLIC_CROWDFUND_CONTRACT_ID',
      ],
    },
  },
];

export function loadManifest(manifestPath: string): TestnetManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as TestnetManifest;
}

export function parseEnvContents(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    values[key] = stripEnvQuotes(rawValue);
  }

  return values;
}

export function getCanonicalContractIds(
  manifest: TestnetManifest,
): Record<string, string> {
  const contracts = manifest.contracts ?? {};
  const canonical: Record<string, string> = {};

  for (const [contractName, entry] of Object.entries(contracts)) {
    if (typeof entry?.id === 'string' && entry.id.trim()) {
      canonical[contractName] = entry.id.trim();
    }
  }

  return canonical;
}

export function buildContractDriftReport(
  manifestPath: string,
  sources: ContractSource[],
  options: BuildContractDriftReportOptions = {},
): ContractDriftReport {
  const manifest = loadManifest(manifestPath);
  const canonicalContracts = getCanonicalContractIds(manifest);
  const drift: ContractDriftFinding[] = [];
  const missing: ContractMissingFinding[] = [];
  let contractValuesChecked = 0;

  for (const source of sources) {
    if (!existsSync(source.path)) {
      throw new Error(`Contract source not found: ${source.path}`);
    }

    const sourceValues = parseEnvContents(readFileSync(source.path, 'utf8'));

    for (const [contractName, variables] of Object.entries(source.contracts)) {
      const expected = canonicalContracts[contractName];
      if (!expected) {
        continue;
      }

      const configuredValues = variables
        .map((variable) => ({
          variable,
          value: sourceValues[variable]?.trim() ?? '',
        }))
        .filter(({ value }) => value.length > 0);

      if (configuredValues.length === 0) {
        missing.push({
          source: source.id,
          path: source.path,
          contract: contractName,
          variables,
          expected,
        });
        continue;
      }

      for (const configured of configuredValues) {
        contractValuesChecked += 1;
        if (configured.value !== expected) {
          drift.push({
            source: source.id,
            path: source.path,
            contract: contractName,
            variable: configured.variable,
            expected,
            actual: configured.value,
          });
        }
      }
    }
  }

  return {
    ok: drift.length === 0 && (!options.failOnMissing || missing.length === 0),
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    manifest: {
      path: manifestPath,
      network:
        typeof manifest.network === 'string' && manifest.network.trim()
          ? manifest.network
          : 'unknown',
      contracts: canonicalContracts,
    },
    summary: {
      sourcesChecked: sources.length,
      contractValuesChecked,
      driftCount: drift.length,
      missingCount: missing.length,
    },
    drift,
    missing,
  };
}

export function resolveContractSources(
  repoRoot: string,
  sources: ContractSource[] = DEFAULT_CONTRACT_SOURCES,
): ContractSource[] {
  return sources.map((source) => ({
    ...source,
    path: resolve(repoRoot, source.path),
  }));
}

function stripEnvQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
