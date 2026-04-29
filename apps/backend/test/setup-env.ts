const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  ENVIRONMENT: 'test',
  PORT: '3000',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_DATABASE: 'lumenpulse',
  JWT_SECRET: 'test-jwt-secret',
  STELLAR_SERVER_SECRET:
    'SB6RIPM3GJQ7RP3Q6R5F3QIBYZHP4N27SGGCQ3R4LWA2ZKXZWQ3NU3G4',
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process['env'][key] || process['env'][key]?.trim().length === 0) {
    process['env'][key] = value;
  }
}
