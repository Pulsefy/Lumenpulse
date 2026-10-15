import { existsSync } from 'fs';
import { resolve } from 'path';
import {
  buildContractDriftReport,
  resolveContractSources,
  type ContractSource,
} from '../src/config/contract-drift.detector';

interface CliOptions {
  failOnMissing: boolean;
  manifestPath?: string;
  sources: ContractSource[];
}

function main(): void {
  const repoRoot = findRepoRoot(process.cwd());
  const options = parseArgs(process.argv.slice(2));
  const manifestPath =
    options.manifestPath ??
    resolve(repoRoot, 'apps/onchain/testnet-manifest.json');
  const sources =
    options.sources.length > 0
      ? resolveContractSources(repoRoot, options.sources)
      : resolveContractSources(repoRoot);

  const report = buildContractDriftReport(manifestPath, sources, {
    failOnMissing: options.failOnMissing,
  });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    failOnMissing: false,
    sources: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case '--fail-on-missing':
        options.failOnMissing = true;
        break;
      case '--manifest':
        options.manifestPath = requireNextArg(args, index, '--manifest');
        index += 1;
        break;
      case '--source': {
        const value = requireNextArg(args, index, '--source');
        options.sources.push(parseSourceArg(value));
        index += 1;
        break;
      }
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parseSourceArg(value: string): ContractSource {
  const [idAndPath, mappingList] = value.split('::');
  const [id, sourcePath] = idAndPath.split('=');

  if (!id || !sourcePath || !mappingList) {
    throw new Error(
      'Invalid --source. Use source-id=relative/path::contract=ENV_A,ENV_B;other=ENV_C',
    );
  }

  const contracts: Record<string, string[]> = {};
  for (const mapping of mappingList.split(';')) {
    const [contract, variables] = mapping.split('=');
    if (!contract || !variables) {
      throw new Error(`Invalid contract mapping in --source: ${mapping}`);
    }

    contracts[contract] = variables
      .split(',')
      .map((variable) => variable.trim())
      .filter(Boolean);
  }

  return { id, path: sourcePath, contracts };
}

function requireNextArg(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function findRepoRoot(startDir: string): string {
  let current = resolve(startDir);

  while (current !== resolve(current, '..')) {
    if (existsSync(resolve(current, 'apps/onchain/testnet-manifest.json'))) {
      return current;
    }
    current = resolve(current, '..');
  }

  throw new Error(
    'Could not find repo root containing apps/onchain/testnet-manifest.json',
  );
}

function printHelp(): void {
  process.stdout.write(`Usage: npm run contract:drift -- [options]

Options:
  --manifest <path>       Override the canonical manifest path.
  --source <mapping>      Add a source mapping.
                          Format: id=path::contract=ENV_A,ENV_B;other=ENV_C
  --fail-on-missing       Treat blank or missing configured IDs as failures.
  --help                  Show this help text.

The command always writes a machine-readable JSON report and exits 1 when drift
is found. Missing values are warnings unless --fail-on-missing is passed.
`);
}

main();
