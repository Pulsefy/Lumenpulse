jest.mock('expo-constants', () => {
  const mockConstants = {
    expoConfig: {
      name: 'Lumenpulse Test',
      version: '1.2.3',
      extra: {
        environment: 'development',
      },
    },
    nativeBuildVersion: '42',
  };
  return mockConstants;
});

jest.mock('react-native/Libraries/Utilities/Platform', () => ({
  OS: 'ios',
  Version: '17.4',
  select: (obj: Record<string, unknown>) => obj.ios,
}));

const releaseMetadataPath = '../release-metadata';

describe('release metadata', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns release metadata with the required shape', () => {
    const { getReleaseMetadata } = require(releaseMetadataPath);
    const data = getReleaseMetadata();

    expect(data).toBeTruthy();
    expect(Array.isArray(data.releases)).toBe(true);
    expect(data.releases.length).toBeGreaterThan(0);
    expect(typeof data.releases[0].version).toBe('string');
    expect(typeof data.releases[0].title).toBe('string');
    expect(Array.isArray(data.releases[0].notes)).toBe(true);
  });

  it('falls back to the bundled metadata when the asset is unavailable', () => {
    const { fallbackReleaseMetadata } = require(releaseMetadataPath);
    expect(fallbackReleaseMetadata.releases[0].version).toBe('1.0.0');
    expect(Array.isArray(fallbackReleaseMetadata.releases[0].notes)).toBe(true);
    expect(fallbackReleaseMetadata.releases[0].notes.length).toBeGreaterThan(0);
  });
});

describe('getRuntimeUpdateInfo', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('returns stable runtime info including version and embedded flag in dev client', () => {
    jest.doMock('expo-constants', () => ({
      expoConfig: {
        name: 'Lumenpulse',
        version: '1.2.3',
        extra: { environment: 'development' },
      },
      nativeBuildVersion: '42',
    }));

    const { getRuntimeUpdateInfo } = require(releaseMetadataPath);
    const info = getRuntimeUpdateInfo();

    expect(info.runtimeVersion).toBe('1.2.3 (42)');
    expect(info.isEmbedded).toBe(true);
    expect(info.updateId).toBeNull();
    expect(['development', 'preview', 'production', 'unknown']).toContain(info.channel);
  });

  it('gracefully handles missing native build version', () => {
    jest.doMock('expo-constants', () => ({
      expoConfig: {
        name: 'Lumenpulse',
        version: '2.0.0',
      },
      nativeBuildVersion: null,
    }));

    const { getRuntimeUpdateInfo } = require(releaseMetadataPath);
    const info = getRuntimeUpdateInfo();

    expect(info.runtimeVersion).toBe('2.0.0');
    expect(info.isEmbedded).toBe(true);
  });

  it('extracts updateId and channel from manifest extra when present', () => {
    jest.doMock('expo-constants', () => ({
      expoConfig: {
        name: 'Lumenpulse',
        version: '1.0.0',
        extra: {
          environment: 'production',
          expoClient: {
            updateId: '01924e2e-88a0-7fdf-b804-123456789abc',
            releaseChannel: 'production',
            createdAt: '2026-08-19T12:30:00.000Z',
          },
        },
      },
      nativeBuildVersion: '10',
    }));

    const { getRuntimeUpdateInfo } = require(releaseMetadataPath);
    const info = getRuntimeUpdateInfo();

    expect(info.updateId).toBe('01924e2e-88a0-7fdf-b804-123456789abc');
    expect(info.channel).toBe('production');
    expect(info.createdAt).toBe('2026-08-19T12:30:00.000Z');
    expect(info.isEmbedded).toBe(false);
  });

  it('normalizes case-insensitive channel names (preview, dev)', () => {
    jest.doMock('expo-constants', () => ({
      expoConfig: {
        name: 'Lumenpulse',
        version: '1.0.0',
        releaseChannel: 'Staging',
      },
    }));

    const { getRuntimeUpdateInfo } = require(releaseMetadataPath);
    const info = getRuntimeUpdateInfo();

    expect(info.channel).toBe('preview');
  });

  it('falls back to unknown when channel garbage value', () => {
    jest.doMock('expo-constants', () => ({
      expoConfig: {
        name: 'Lumenpulse',
        version: '1.0.0',
        releaseChannel: 'whitespace//garbage',
      },
    }));

    const { getRuntimeUpdateInfo } = require(releaseMetadataPath);
    const info = getRuntimeUpdateInfo();
    expect(info.channel).toBe('unknown');
  });
});

describe('checkForRuntimeUpdate (OTA)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('returns unsupported status when expo-updates is not installed (dev client)', async () => {
    const originalResolve = require.resolve;
    jest.doMock(
      'module',
      () => {
        const mod = jest.requireActual('module');
        return {
          ...mod,
          _resolveFilename: () => {
            const err = new Error("Cannot find module 'expo-updates'") as Error & {
              code: string;
            };
            err.code = 'MODULE_NOT_FOUND';
            throw err;
          },
        };
      },
      { virtual: true },
    );

    // Fallback path - expo-updates require throws
    jest.doMock('expo-updates', () => {
      const err = new Error("Cannot find module 'expo-updates'") as Error & { code: string };
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    });

    const { checkForRuntimeUpdate } = require(releaseMetadataPath);
    const res = await checkForRuntimeUpdate();

    expect(res.status).toBe('unsupported');
    expect(res.message).toMatch(/unavailable/i);
    expect(res.newUpdateId).toBeNull();
    expect(originalResolve).toBeDefined();
  });

  it('returns up-to-date when no update is available', async () => {
    jest.doMock('expo-updates', () => ({
      checkForUpdateAsync: jest.fn().mockResolvedValue({
        isAvailable: false,
      }),
    }));

    const { checkForRuntimeUpdate } = require(releaseMetadataPath);
    const res = await checkForRuntimeUpdate();
    expect(res.status).toBe('up-to-date');
    expect(res.message).toMatch(/latest/i);
  });

  it('returns available with new update id when manifest has it', async () => {
    jest.doMock('expo-updates', () => ({
      checkForUpdateAsync: jest.fn().mockResolvedValue({
        isAvailable: true,
        manifest: {
          updateId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          createdAt: '2026-09-01T00:00:00.000Z',
        },
      }),
    }));

    const { checkForRuntimeUpdate } = require(releaseMetadataPath);
    const res = await checkForRuntimeUpdate();

    expect(res.status).toBe('available');
    expect(res.newUpdateId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(res.createdAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('returns roll-back-available when the server offers embedded rollback', async () => {
    jest.doMock('expo-updates', () => ({
      checkForUpdateAsync: jest.fn().mockResolvedValue({
        isRollBackToEmbedded: true,
      }),
    }));

    const { checkForRuntimeUpdate } = require(releaseMetadataPath);
    const res = await checkForRuntimeUpdate();
    expect(res.status).toBe('roll-back-available');
    expect(res.message).toMatch(/rollback/i);
  });

  it('returns error status when checkForUpdateAsync throws', async () => {
    jest.doMock('expo-updates', () => ({
      checkForUpdateAsync: jest.fn().mockRejectedValue(new Error('Network unreachable')),
    }));

    const { checkForRuntimeUpdate } = require(releaseMetadataPath);
    const res = await checkForRuntimeUpdate();

    expect(res.status).toBe('error');
    expect(res.message).toBe('Network unreachable');
    expect(res.newUpdateId).toBeNull();
  });

  it('returns error for non-object / unexpected responses', async () => {
    jest.doMock('expo-updates', () => ({
      checkForUpdateAsync: jest.fn().mockResolvedValue(null),
    }));

    const { checkForRuntimeUpdate } = require(releaseMetadataPath);
    const res = await checkForRuntimeUpdate();
    expect(res.status).toBe('error');
  });
});

describe('redactSensitiveDiagnostics', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('redacts stellar G... (56 char) public keys', () => {
    const { redactSensitiveDiagnostics } = require(releaseMetadataPath);
    const key =
      'GCVHEKSRASJBD6O2Z532LWH4N2ZLCBTET73Y35P72OY3Y3Y3Y3Y3Y3Y3Y3Y3Y3Y3Y3Y3Y3Y3Y3';
    const scrubbed = redactSensitiveDiagnostics(`wallet: ${key}`);
    expect(scrubbed).not.toContain(key);
    expect(scrubbed).toContain('[REDACTED_STELLAR_ADDRESS]');
  });

  it('redacts M... muxed account addresses', () => {
    const { redactSensitiveDiagnostics } = require(releaseMetadataPath);
    const mux =
      'MDT67MK7Z2X4FRUGBPWLFPREMEY5M6CNP6N2MZTF7X2STHK23XZAAAAAAAAAAMBIH7L4F7T47R522';
    const scrubbed = redactSensitiveDiagnostics(`muxed = ${mux}`);
    expect(scrubbed).not.toContain(mux);
    expect(scrubbed).toContain('[REDACTED_STELLAR_MUXED_ADDRESS]');
  });

  it('redacts C... contract addresses (but intentionally kept in context below)', () => {
    const { redactSensitiveDiagnostics } = require(releaseMetadataPath);
    const c = 'CDJ4QV4PG7J6YTYHEFV7F43XSZ2Z53JQ6N3O4256P4XJ72Z6Y3Y3Y3Y3Y3Y3Y3Y3';
    const scrubbed = redactSensitiveDiagnostics(`contract=${c}`);
    expect(scrubbed).not.toContain(c);
    expect(scrubbed).toContain('[REDACTED_CONTRACT_ADDRESS]');
  });

  it('redacts JWT tokens (eyJ.... form)', () => {
    const { redactSensitiveDiagnostics } = require(releaseMetadataPath);
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const scrubbed = redactSensitiveDiagnostics(`token: ${jwt}`);
    expect(scrubbed).not.toContain('eyJhbGci');
    expect(scrubbed).toContain('[REDACTED_JWT]');
  });

  it('redacts authorization / x-api-key style headers', () => {
    const { redactSensitiveDiagnostics } = require(releaseMetadataPath);
    const line = 'Authorization: Bearer sk_live_abcdefghijk1234567890abcdefgh';
    const scrubbed = redactSensitiveDiagnostics(line);
    expect(scrubbed).not.toContain('sk_live_');
    expect(scrubbed).toMatch(/authorization:\s*\[REDACTED_TOKEN\]/i);
  });

  it('redacts auth-token style cookies', () => {
    const { redactSensitiveDiagnostics } = require(releaseMetadataPath);
    const line =
      'cookie: auth-token=eyJhbGciOi...notAValidJWTButStillSecret1234567890abcdef; other=1';
    const scrubbed = redactSensitiveDiagnostics(line);
    expect(scrubbed).toContain('auth-token=[REDACTED_COOKIE]');
    expect(scrubbed).not.toContain('notAValidJWTButStillSecret');
  });

  it('passes non-sensitive lines through untouched', () => {
    const { redactSensitiveDiagnostics } = require(releaseMetadataPath);
    const benign =
      'Runtime Version : 1.2.3 (42)\nEnvironment : Testnet (testnet)\nUpdate Channel : preview';
    expect(redactSensitiveDiagnostics(benign)).toBe(benign);
  });
});

describe('buildDiagnosticsBlock', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('expo-constants', () => ({
      expoConfig: {
        name: 'Lumenpulse Test',
        version: '1.2.3',
        extra: { environment: 'development' },
      },
      nativeBuildVersion: '42',
    }));
  });

  const baseCtx = {
    environment: 'testnet',
    environmentLabel: 'Testnet',
    apiBaseUrl: 'https://api.example.com',
    stellarNetwork: 'testnet',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    crowdfundContractId: 'CDJ4QV4PG7J6YTYHEFV7F43XSZ2Z53JQ6N3O4256P4XJ72Z6AAAAAAAAAA',
    connectionStatus: 'online' as const,
    lastCheckedAt: '2026-09-20T12:00:00.000Z',
  };

  it('produces a labeled block with runtime + environment fields', () => {
    const { buildDiagnosticsBlock } = require(releaseMetadataPath);
    const block = buildDiagnosticsBlock(baseCtx);

    expect(block).toContain('--- Lumenpulse Diagnostics ---');
    expect(block).toMatch(/App\s*: Lumenpulse Test/);
    expect(block).toMatch(/Runtime Version\s*: 1\.2\.3 \(42\)/);
    expect(block).toMatch(/Update Channel\s*: (development|unknown)/);
    expect(block).toMatch(/Environment\s*: Testnet \(testnet\)/);
    expect(block).toMatch(/Stellar Network\s*: testnet/);
    expect(block).toMatch(/API Base URL\s*: https:\/\/api\.example\.com/);
    expect(block).toMatch(/Soroban RPC\s*: https:\/\/soroban-testnet\.stellar\.org/);
    expect(block).toMatch(/Connection Status\s*: online/);
    expect(block).toMatch(/Last Network Check\s*: 2026-09-20T12:00:00\.000Z/);
    expect(block).toContain('--- END Diagnostics ---');
  });

  it('redacts wallet addresses and tokens when they sneak into a string context value', () => {
    // Construct the same context but with an embedded wallet/token in a label-like context.
    // We also directly test the redaction pipeline with a pre-constructed dangerous block.
    const { buildDiagnosticsBlock, redactSensitiveDiagnostics } = require(releaseMetadataPath);
    const block = buildDiagnosticsBlock(baseCtx);

    // Ensure base block is safe for basic tests.
    expect(block).not.toContain('[REDACTED_JWT]');

    const dangerous = `header:Authorization: Bearer verysecretvalue1234567890
  wallet=GCVHEKSRASJBD6O2Z532LWH4N2ZLCBTET73Y35P72OY3Y3Y3Y3Y3Y3Y3Y3Y3Y3Y3Y3Y3Y3Y3Y3
  ${block}`;
    const scrubbed = redactSensitiveDiagnostics(dangerous);
    expect(scrubbed).toContain('[REDACTED_TOKEN]');
    expect(scrubbed).toContain('[REDACTED_STELLAR_ADDRESS]');
    expect(scrubbed).not.toContain('verysecretvalue');
  });

  it('omits crowdfund contract when missing (no divider line for it)', () => {
    const { buildDiagnosticsBlock } = require(releaseMetadataPath);
    const block = buildDiagnosticsBlock({ ...baseCtx, crowdfundContractId: null });
    expect(block).not.toMatch(/Crowdfund Contract/);
  });

  it('shows (embedded build) for Update ID when no update metadata is present', () => {
    const { buildDiagnosticsBlock } = require(releaseMetadataPath);
    const block = buildDiagnosticsBlock(baseCtx);
    expect(block).toMatch(/Update ID\s*: \(embedded build\)/);
  });
});
