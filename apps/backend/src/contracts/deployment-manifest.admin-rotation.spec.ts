import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as os from 'os';
import * as path from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { DeploymentManifestService } from './deployment-manifest.service';
import { ContractDeploymentManifest } from './entities/contract-deployment-manifest.entity';
import { ConfigService } from '../config/config.service';
import { ContractCapabilityService } from './contract-capability.service';

/**
 * Issue #1626 — admin key rotation must be picked up without a restart.
 * `refreshManifest()` tracks top-level + per-contract `admin_address` and
 * propagates them to `ConfigService` in-memory overrides.
 *
 * Uses real temp manifest files (no `fs` mocking) by pointing `process.cwd()`
 * at a temp repo root containing `apps/onchain/testnet-manifest.json`.
 */
describe('DeploymentManifestService admin rotation (issue #1626)', () => {
  let service: DeploymentManifestService;

  const OLD_ADMIN =
    'GDPBZZDKZJTPFERPP65ATQWH2T6OIXQESPKXSTO6YY33TA2HTUTAPJI6';
  // Valid Stellar G... address, distinct from OLD_ADMIN for rotation tests.
  const NEW_ADMIN =
    'GCNQBZDKZJTPFERPP65ATQWH2T6OIXQESPKXSTO6YY33TA2HTUTAPJI7';

  const mockConfigService = {
    setStellarContractOverrides: jest.fn(),
    setStellarAdminAddress: jest.fn(),
    setStellarContractAdminOverrides: jest.fn(),
    invalidateCache: jest.fn().mockResolvedValue(undefined),
  };

  const mockContractCapabilityService = {
    invalidateCache: jest.fn(),
  };

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findAndCount: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    count: jest.fn().mockResolvedValue(1),
  };

  const manifestWithAdmin = (admin: string, treasuryAdmin?: string) =>
    JSON.stringify({
      network: 'testnet',
      rpc_url: 'https://soroban-testnet.stellar.org:443',
      admin_address: admin,
      contracts: {
        treasury: {
          id: 'CB6FRSAWOGVLH5GD4ITATNZNLVTQ3TKDOWAXJVGUG77AKCO5UKHH5H3O',
          wasm_hash:
            'edd99a0d5ad358aec5a560b9df433a4f94fc7f68a6efe221cd89454ae9695299',
          ...(treasuryAdmin ? { admin_address: treasuryAdmin } : {}),
        },
      },
    });

  let tmpDirs: string[] = [];

  const writeManifest = (dir: string, content: string): void => {
    mkdirSync(path.join(dir, 'apps', 'onchain'), { recursive: true });
    writeFileSync(
      path.join(dir, 'apps', 'onchain', 'testnet-manifest.json'),
      content,
    );
  };

  const makeRepoRoot = (content: string): string => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'manifest-'));
    tmpDirs.push(dir);
    writeManifest(dir, content);
    return dir;
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeploymentManifestService,
        {
          provide: getRepositoryToken(ContractDeploymentManifest),
          useValue: mockRepo,
        },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: ContractCapabilityService,
          useValue: mockContractCapabilityService,
        },
      ],
    }).compile();

    service = module.get<DeploymentManifestService>(DeploymentManifestService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs = [];
  });

  it('picks up a top-level admin rotation without a restart', async () => {
    const repoRoot = makeRepoRoot(manifestWithAdmin(OLD_ADMIN));
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(repoRoot);

    await service.refreshManifest();
    expect(mockConfigService.setStellarAdminAddress).toHaveBeenCalledWith(
      OLD_ADMIN,
    );
    expect(service.getLastKnownAdminAddress()).toBe(OLD_ADMIN);

    writeManifest(repoRoot, manifestWithAdmin(NEW_ADMIN));
    await service.refreshManifest();
    expect(mockConfigService.setStellarAdminAddress).toHaveBeenCalledWith(
      NEW_ADMIN,
    );
    expect(service.getLastKnownAdminAddress()).toBe(NEW_ADMIN);
    expect(mockConfigService.invalidateCache).toHaveBeenCalled();
    expect(
      mockContractCapabilityService.invalidateCache,
    ).toHaveBeenCalled();

    cwdSpy.mockRestore();
  });

  it('does not propagate admin when the manifest admin is unchanged', async () => {
    const repoRoot = makeRepoRoot(manifestWithAdmin(OLD_ADMIN));
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(repoRoot);

    await service.refreshManifest();
    const callsAfterFirst =
      mockConfigService.setStellarAdminAddress.mock.calls.length;

    await service.refreshManifest();
    // Second refresh with identical admin must not re-propagate.
    expect(
      mockConfigService.setStellarAdminAddress.mock.calls.length,
    ).toBe(callsAfterFirst);

    cwdSpy.mockRestore();
  });

  it('tracks per-contract admin overrides (treasury)', async () => {
    const repoRoot = makeRepoRoot(manifestWithAdmin(OLD_ADMIN, NEW_ADMIN));
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(repoRoot);

    await service.refreshManifest();

    expect(
      mockConfigService.setStellarContractAdminOverrides,
    ).toHaveBeenCalledWith(expect.objectContaining({ treasury: NEW_ADMIN }));
    expect(service.getLastKnownContractAdmins()).toEqual(
      expect.objectContaining({ treasury: NEW_ADMIN }),
    );

    cwdSpy.mockRestore();
  });
});
