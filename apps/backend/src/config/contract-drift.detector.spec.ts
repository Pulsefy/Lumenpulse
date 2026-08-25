import {
  buildContractDriftReport,
  parseEnvContents,
  type ContractSource,
} from './contract-drift.detector';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('contract drift detector', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'contract-drift-'));
  });

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true });
  });

  it('parses env files with comments, blanks, and quoted values', () => {
    expect(
      parseEnvContents(`
        # ignored
        CONTRACT_A=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
        CONTRACT_B="CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
        CONTRACT_C='CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
      `),
    ).toEqual({
      CONTRACT_A: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      CONTRACT_B: 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      CONTRACT_C: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    });
  });

  it('reports drift in machine-readable form', () => {
    const manifestPath = join(tempDir, 'testnet-manifest.json');
    const sourcePath = join(tempDir, '.env.example');

    writeFileSync(
      manifestPath,
      JSON.stringify({
        network: 'testnet',
        contracts: {
          treasury: {
            id: 'CD56RQ3JBYKZIDB7TINYRWFLPAUVGVGQPCOYE2VYZYXP2TSEA5E52IQ5',
          },
        },
      }),
    );
    writeFileSync(
      sourcePath,
      'TREASURY_CONTRACT_ID=CC5XSIUYIZ2OQLBNYRJPCGV4465DJ4UXD23BBCBCJGZ7CVPY3NI2T6ZL\n',
    );

    const sources: ContractSource[] = [
      {
        id: 'backend.env.example',
        path: sourcePath,
        contracts: { treasury: ['TREASURY_CONTRACT_ID'] },
      },
    ];

    const report = buildContractDriftReport(manifestPath, sources, {
      generatedAt: '2026-06-27T00:00:00.000Z',
    });

    expect(report.ok).toBe(false);
    expect(report.summary).toEqual({
      contractValuesChecked: 1,
      driftCount: 1,
      missingCount: 0,
      sourcesChecked: 1,
    });
    expect(report.drift).toEqual([
      {
        actual: 'CC5XSIUYIZ2OQLBNYRJPCGV4465DJ4UXD23BBCBCJGZ7CVPY3NI2T6ZL',
        contract: 'treasury',
        expected: 'CD56RQ3JBYKZIDB7TINYRWFLPAUVGVGQPCOYE2VYZYXP2TSEA5E52IQ5',
        path: sourcePath,
        source: 'backend.env.example',
        variable: 'TREASURY_CONTRACT_ID',
      },
    ]);
  });

  it('can fail on missing configured IDs for stricter scheduled checks', () => {
    const manifestPath = join(tempDir, 'testnet-manifest.json');
    const sourcePath = join(tempDir, '.env.example');

    writeFileSync(
      manifestPath,
      JSON.stringify({
        network: 'testnet',
        contracts: {
          crowdfund_vault: {
            id: 'CBBQW7T65XBDPIPXEIIPJVJEEIBSPC566HMEU2LTBAULLKCNUFRFBKRO',
          },
        },
      }),
    );
    writeFileSync(sourcePath, 'EXPO_PUBLIC_CROWDFUND_CONTRACT_ID=\n');

    const sources: ContractSource[] = [
      {
        id: 'mobile.env.example',
        path: sourcePath,
        contracts: {
          crowdfund_vault: ['EXPO_PUBLIC_CROWDFUND_CONTRACT_ID'],
        },
      },
    ];

    const report = buildContractDriftReport(manifestPath, sources, {
      failOnMissing: true,
    });

    expect(report.ok).toBe(false);
    expect(report.drift).toHaveLength(0);
    expect(report.missing).toEqual([
      {
        contract: 'crowdfund_vault',
        expected: 'CBBQW7T65XBDPIPXEIIPJVJEEIBSPC566HMEU2LTBAULLKCNUFRFBKRO',
        path: sourcePath,
        source: 'mobile.env.example',
        variables: ['EXPO_PUBLIC_CROWDFUND_CONTRACT_ID'],
      },
    ]);
  });
});
