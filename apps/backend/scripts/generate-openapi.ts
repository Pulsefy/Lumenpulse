import { restoreConsole } from './openapi-env';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { scanApplication } from '../src/openapi/openapi-app';
import {
  OPENAPI_ARTIFACT_PATH,
  OPENAPI_LINT_BASELINE_PATH,
} from '../src/openapi/openapi.constants';
import { createOpenApiDocument } from '../src/openapi/openapi.document';
import { lintDocumentation, lintSecurity } from '../src/openapi/openapi.lint';
import {
  collectRouteGuards,
  findUnmappedGlobalGuardCalls,
} from '../src/openapi/route-guards';
import { setupApp } from '../src/bootstrap/app.setup';

/**
 * Emits the committed OpenAPI contract to `apps/backend/openapi.json`.
 *
 *   node dist/scripts/generate-openapi.js          write the artifact
 *   node dist/scripts/generate-openapi.js --check  fail if it is stale
 *   node dist/scripts/generate-openapi.js --update-baseline
 *                                                  rewrite the docs-lint baseline
 *
 * Security violations and schema-name collisions always fail. Documentation
 * gaps that predate the lint are listed in `openapi-lint-baseline.json`; a
 * new gap fails, and so does a baselined gap that has been fixed but not
 * removed, so the baseline only ever shrinks.
 *
 * Runs from `dist/` (after `nest build`) because DTO schemas come from the
 * @nestjs/swagger compiler plugin, which only runs inside `nest build`.
 */
async function main(): Promise<void> {
  restoreConsole();
  const check = process.argv.includes('--check');
  const updateBaseline = process.argv.includes('--update-baseline');
  const backendRoot = findBackendRoot();
  const artifactPath = resolve(backendRoot, OPENAPI_ARTIFACT_PATH);
  const baselinePath = resolve(backendRoot, OPENAPI_LINT_BASELINE_PATH);

  // @nestjs/swagger only logs schema-name collisions and keeps whichever
  // class it saw first, silently publishing the wrong shape. Treat as fatal.
  const swaggerErrors: string[] = [];
  Logger.overrideLogger({
    log: () => undefined,
    warn: () => undefined,
    error: (message: unknown) => swaggerErrors.push(String(message)),
  });

  const { app, container, globalGuards } = await scanApplication(
    AppModule,
    setupApp,
  );
  const document = createOpenApiDocument(app);
  const documentation = lintDocumentation(document);
  if (updateBaseline) {
    writeFileSync(
      baselinePath,
      `${JSON.stringify([...new Set(documentation)].sort(), null, 2)}\n`,
      'utf8',
    );
  }
  const baseline = new Set<string>(
    existsSync(baselinePath)
      ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as string[])
      : [],
  );
  const current = new Set(documentation);

  const violations = [
    ...swaggerErrors,
    ...lintSecurity(document, collectRouteGuards(container, globalGuards)),
    ...findUnmappedGlobalGuardCalls(resolve(backendRoot, 'src')),
    ...documentation.filter((v) => !baseline.has(v)),
    ...[...baseline]
      .filter((v) => !current.has(v))
      .map(
        (v) =>
          `fixed but still in ${OPENAPI_LINT_BASELINE_PATH} (run \`npm run openapi:baseline\`): ${v}`,
      ),
  ];

  if (violations.length > 0) {
    console.error(
      `OpenAPI spec is incomplete (${violations.length} problem(s)):\n` +
        violations.map((v) => `  - ${v}`).join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  const next = `${JSON.stringify(document, null, 2)}\n`;

  if (check) {
    const committed = existsSync(artifactPath)
      ? readFileSync(artifactPath, 'utf8')
      : '';
    if (committed !== next) {
      console.error(
        `${OPENAPI_ARTIFACT_PATH} is stale. Run \`npm run build\` in apps/backend and commit the result.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`${OPENAPI_ARTIFACT_PATH} is up to date.`);
    return;
  }

  writeFileSync(artifactPath, next, 'utf8');
  console.log(
    `OpenAPI spec written to ${artifactPath} (${Object.keys(document.paths).length} paths).`,
  );
}

/** `apps/backend`, whether run from source or from `dist/scripts`. */
function findBackendRoot(): string {
  let dir = __dirname;
  while (!existsSync(resolve(dir, 'nest-cli.json'))) {
    const parent = resolve(dir, '..');
    if (parent === dir) {
      throw new Error('Could not locate apps/backend (nest-cli.json)');
    }
    dir = parent;
  }
  return dir;
}

main().catch((error: unknown) => {
  console.error('Failed to generate OpenAPI spec.');
  console.error(error);
  process.exit(1);
});
