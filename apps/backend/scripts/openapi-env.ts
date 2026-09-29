/**
 * Placeholder environment for building the OpenAPI document offline.
 *
 * `src/lib/config.ts` validates the environment at import time, so this module
 * must be imported before anything from `src/`. Values are forced (not
 * defaulted) so a developer's local `.env` can never change the generated
 * artifact. Nothing connects to these services: providers are never instantiated.
 */
const placeholders: Record<string, string> = {
  NODE_ENV: 'test',
  ENVIRONMENT: 'test',
  PORT: '3000',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USERNAME: 'openapi',
  DB_PASSWORD: 'openapi',
  DB_DATABASE: 'openapi',
  JWT_SECRET: 'openapi-generation-only',
  STELLAR_SERVER_SECRET:
    'SB6RIPM3GJQ7RP3Q6R5F3QIBYZHP4N27SGGCQ3R4LWA2ZKXZWQ3NU3G4',
};

for (const [key, value] of Object.entries(placeholders)) {
  process.env[key] = value;
}

// Config prints a boot summary on import; it is noise in `npm run build`.
const originalInfo = console.info;
console.info = () => undefined;

export function restoreConsole(): void {
  console.info = originalInfo;
}
