import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { inspect } from 'node:util';

const REQUIRED_ENV: Record<string, string> = {
  PORT: '3000',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'super-secret-db-password',
  DB_DATABASE: 'lumenpulse',
  JWT_SECRET: 'super-secret-jwt',
  STELLAR_SERVER_SECRET:
    'SB6RIPM3GJQ7RP3Q6R5F3QIBYZHP4N27SGGCQ3R4LWA2ZKXZWQ3NU3G4',
};

const MANAGED_KEYS = [
  ...Object.keys(REQUIRED_ENV),
  'NODE_ENV',
  'ENVIRONMENT',
  'CACHE_TTL_MS',
  'CORS_ORIGIN',
] as const;

const resetManagedEnv = (values: Record<string, string | undefined>) => {
  for (const key of MANAGED_KEYS) {
    delete process['env'][key];
  }

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process['env'][key];
    } else {
      process['env'][key] = value;
    }
  }
};

const requireFromHere = createRequire(__filename);

const importFreshConfigModule = async (): Promise<
  typeof import('./config')
> => {
  jest.resetModules();
  await Promise.resolve();
  const configModule = requireFromHere('./config') as typeof import('./config');
  return configModule;
};

describe('config validation', () => {
  const originalCwd = process.cwd();
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.chdir(originalCwd);
    resetManagedEnv({ ...REQUIRED_ENV, NODE_ENV: 'test', ENVIRONMENT: 'test' });
  });

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    process.chdir(originalCwd);
  });

  it('returns config when all required variables are valid', async () => {
    const { config } = await importFreshConfigModule();

    expect(config.port).toBe(3000);
    expect(config.database.host).toBe('localhost');
    expect(config.database.password.reveal()).toBe('super-secret-db-password');
  });

  it('throws when a required secret is missing', async () => {
    resetManagedEnv({
      ...REQUIRED_ENV,
      JWT_SECRET: undefined,
      NODE_ENV: 'test',
      ENVIRONMENT: 'test',
    });

    await expect(importFreshConfigModule()).rejects.toThrow('JWT_SECRET');
  });

  it('throws once with all missing variable names', async () => {
    resetManagedEnv({
      ...REQUIRED_ENV,
      JWT_SECRET: undefined,
      DB_PASSWORD: undefined,
      NODE_ENV: 'test',
      ENVIRONMENT: 'test',
    });

    await expect(importFreshConfigModule()).rejects.toThrow(
      /JWT_SECRET[\s\S]*DB_PASSWORD|DB_PASSWORD[\s\S]*JWT_SECRET/,
    );
  });

  it('throws for wrong required config type', async () => {
    resetManagedEnv({
      ...REQUIRED_ENV,
      PORT: 'abc',
      NODE_ENV: 'test',
      ENVIRONMENT: 'test',
    });

    await expect(importFreshConfigModule()).rejects.toThrow(/PORT/i);
  });

  it('applies default values for optional config when absent', async () => {
    const { config } = await importFreshConfigModule();

    expect(config.rateLimit.global.limit).toBe(300);
    expect(config.logging.level).toBe('log');
  });
});

describe('SecretString wrapper', () => {
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    resetManagedEnv({ ...REQUIRED_ENV, NODE_ENV: 'test', ENVIRONMENT: 'test' });
  });

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('toString returns redacted', async () => {
    const { SecretString } = await importFreshConfigModule();

    const secret = new SecretString('actual-value');
    expect(secret.toString()).toBe('[REDACTED]');
  });

  it('toJSON returns redacted for JSON serialization', async () => {
    const { SecretString } = await importFreshConfigModule();

    const secret = new SecretString('actual-value');
    expect(JSON.stringify(secret)).toBe('"[REDACTED]"');
  });

  it('reveal returns the real value', async () => {
    const { SecretString } = await importFreshConfigModule();

    const secret = new SecretString('actual-value');
    expect(secret.reveal()).toBe('actual-value');
  });

  it('does not leak secret values in config object logs', async () => {
    const { config } = await importFreshConfigModule();

    const output = inspect(config);
    expect(output).not.toContain('super-secret-db-password');
    expect(output).not.toContain('super-secret-jwt');
    expect(output).toContain('[REDACTED]');
  });
});

describe('environment-specific loading', () => {
  const originalCwd = process.cwd();
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.chdir(originalCwd);
  });

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    process.chdir(originalCwd);
  });

  it('loads .env.local in development when present', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'lumenpulse-config-dev-'));
    writeFileSync(
      path.join(tempDir, '.env.local'),
      [
        'NODE_ENV=development',
        'ENVIRONMENT=local',
        'PORT=4101',
        'DB_HOST=localhost',
        'DB_PORT=5432',
        'DB_USERNAME=postgres',
        'DB_PASSWORD=from-env-local',
        'DB_DATABASE=lumenpulse',
        'JWT_SECRET=jwt-from-env-local',
        'STELLAR_SERVER_SECRET=SB6RIPM3GJQ7RP3Q6R5F3QIBYZHP4N27SGGCQ3R4LWA2ZKXZWQ3NU3G4',
      ].join('\n'),
    );

    resetManagedEnv({
      PORT: undefined,
      DB_HOST: undefined,
      DB_PORT: undefined,
      DB_USERNAME: undefined,
      DB_PASSWORD: undefined,
      DB_DATABASE: undefined,
      JWT_SECRET: undefined,
      STELLAR_SERVER_SECRET: undefined,
      NODE_ENV: 'development',
      ENVIRONMENT: 'local',
    });

    process.chdir(tempDir);

    const { config } = await importFreshConfigModule();

    expect(config.port).toBe(4101);
    expect(config.database.password.reveal()).toBe('from-env-local');
  });

  it('warns in production when .env file exists and does not throw', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'lumenpulse-config-prod-'));
    writeFileSync(
      path.join(tempDir, '.env'),
      'JWT_SECRET=should-not-be-used\n',
    );

    resetManagedEnv({
      ...REQUIRED_ENV,
      NODE_ENV: 'production',
      ENVIRONMENT: 'production',
      CORS_ORIGIN: 'https://app.lumenpulse.io',
    });

    process.chdir(tempDir);

    await expect(importFreshConfigModule()).resolves.toBeDefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'WARNING: .env file detected in a non-local environment.',
      ),
    );
  });

  it('defaults to development and warns when env is unspecified', async () => {
    resetManagedEnv({
      ...REQUIRED_ENV,
      NODE_ENV: undefined,
      ENVIRONMENT: undefined,
    });

    const { config } = await importFreshConfigModule();

    expect(config.nodeEnv).toBe('development');
    expect(warnSpy).toHaveBeenCalledWith(
      'WARNING: NODE_ENV/ENVIRONMENT not set. Defaulting to development.',
    );
  });
});
