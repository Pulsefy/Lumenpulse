import { createRequire } from 'node:module';

describe('fail-fast boot behavior', () => {
  const requireFromHere = createRequire(__filename);
  const managedKeys = [
    'NODE_ENV',
    'ENVIRONMENT',
    'PORT',
    'DB_HOST',
    'DB_PORT',
    'DB_USERNAME',
    'DB_PASSWORD',
    'DB_DATABASE',
    'JWT_SECRET',
    'STELLAR_SERVER_SECRET',
  ] as const;

  beforeEach(() => {
    jest.resetModules();
    for (const key of managedKeys) {
      delete process['env'][key];
    }

    process['env']['NODE_ENV'] = 'development';
    process['env']['ENVIRONMENT'] = 'local';
    process['env']['PORT'] = '3999';
    process['env']['DB_HOST'] = 'localhost';
    process['env']['DB_PORT'] = '5432';
    process['env']['DB_USERNAME'] = 'postgres';
    process['env']['DB_PASSWORD'] = 'postgres';
    process['env']['DB_DATABASE'] = 'lumenpulse';
    process['env']['STELLAR_SERVER_SECRET'] =
      'SB6RIPM3GJQ7RP3Q6R5F3QIBYZHP4N27SGGCQ3R4LWA2ZKXZWQ3NU3G4';
    process['env']['JWT_SECRET'] = '';
  });

  it('exits before app bootstrap work when required config is missing', () => {
    const createMock = jest.fn();

    jest.doMock('@nestjs/core', () => ({
      NestFactory: {
        create: createMock,
      },
    }));

    expect(() => {
      requireFromHere('../main');
    }).toThrow(/JWT_SECRET/);

    expect(createMock).not.toHaveBeenCalled();
  });
});
