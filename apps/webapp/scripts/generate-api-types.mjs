import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '..');
const sourceSpec = path.resolve(appDir, '../backend/openapi.json');
const outputDir = path.join(appDir, 'generated');
const outputPath = path.join(outputDir, 'openapi-types.ts');
const tmpPath = path.join(outputDir, 'openapi-types.ts.tmp');

const schemaNames = [
  'WatchlistItemType',
  'AddToWatchlistDto',
  'UpdateWatchlistDto',
  'WatchlistItemResponseDto',
  'WatchlistResponseDto',
  'ReportType',
  'ReportReason',
  'ReportStatus',
  'CreateReportDto',
  'ContentReport',
  'FeedActivityType',
  'FeedActivityItemDto',
  'ContributorFeedResponseDto',
  'AssetBalanceWithCurrency',
  'PortfolioSummaryResponseDto',
];

const tsType = (schema) => {
  if (!schema || typeof schema !== 'object') return 'unknown';

  if (schema.type === 'string' && Array.isArray(schema.enum)) {
    return schema.enum.map((item) => JSON.stringify(item)).join(' | ');
  }

  if (schema.type === 'object' || schema.properties || schema.additionalProperties) {
    const props = schema.properties ?? {};
    const entries = Object.entries(props).map(([key, value]) => {
      const optional = !schema.required?.includes(key) ? '?' : '';
      const valueType = propType(value);
      return `    ${key}${optional}: ${valueType};`;
    });

    return `{
${entries.join('\n')}
  }`;
  }

  if (schema.type === 'array') {
    return `${propType(schema.items)}[]`;
  }

  if (schema.type === 'integer' || schema.type === 'number') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'string') return 'string';
  if (schema.type === 'null') return 'null';
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.map((item) => propType(item)).join(' | ');
  }
  if (schema.oneOf) {
    return schema.oneOf.map((item) => propType(item)).join(' | ');
  }
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop();
    return name;
  }

  return 'unknown';
};

const propType = (schema) => {
  if (!schema || typeof schema !== 'object') return 'unknown';

  if (schema.$ref) {
    const name = schema.$ref.split('/').pop();
    return name;
  }

  if (schema.type === 'array') return `${propType(schema.items)}[]`;
  if (schema.type === 'object' || schema.properties || schema.additionalProperties) {
    if (schema.additionalProperties && schema.additionalProperties !== true) {
      return `Record<string, ${propType(schema.additionalProperties)}>`;
    }
    return 'Record<string, unknown>';
  }
  if (schema.anyOf) {
    return schema.anyOf.map((item) => propType(item)).join(' | ');
  }
  if (schema.oneOf) {
    return schema.oneOf.map((item) => propType(item)).join(' | ');
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((item) => JSON.stringify(item)).join(' | ');
  }
  if (schema.type === 'string') return 'string';
  if (schema.type === 'integer' || schema.type === 'number') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'null') return 'null';
  if (schema.type === 'array') return 'unknown[]';

  return 'unknown';
};

const generateTypes = () => {
  if (!existsSync(sourceSpec)) {
    console.error(`OpenAPI spec missing at ${sourceSpec}`);
    process.exit(1);
  }

  const source = JSON.parse(readFileSync(sourceSpec, 'utf8'));
  const schemas = source?.components?.schemas ?? {};
  const lines = [
    'export interface components {',
    '  schemas: {',
  ];

  for (const name of schemaNames) {
    const schema = schemas[name];
    if (!schema) {
      throw new Error(`Missing schema export for ${name}`);
    }

    if (schema.type === 'string' && Array.isArray(schema.enum)) {
      lines.push(`    ${name}: ${schema.enum.map((value) => JSON.stringify(value)).join(' | ')};`);
      continue;
    }

    if (schema.type === 'object' || schema.properties) {
      const properties = schema.properties ?? {};
      const members = Object.entries(properties).map(([key, value]) => {
        const optional = schema.required?.includes(key) ? '' : '?';
        return `      ${key}${optional}: ${propType(value)};`;
      });
      lines.push(`    ${name}: {`);
      members.forEach((line) => lines.push(line));
      lines.push('    };');
      continue;
    }

    lines.push(`    ${name}: ${tsType(schema)};`);
  }

  lines.push('  };');
  lines.push('}');

  return `${lines.join('\n')}\n`;
};

const writeTypes = (targetPath) => {
  mkdirSync(outputDir, { recursive: true });
  const content = generateTypes();
  writeFileSync(targetPath, content, 'utf8');
};

const run = () => {
  try {
    if (process.argv.includes('--check')) {
      writeTypes(tmpPath);
      const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : null;
      const next = readFileSync(tmpPath, 'utf8');
      unlinkSync(tmpPath);

      if (current !== next) {
        console.error('Generated OpenAPI types are stale. Run: npm run generate:api-types');
        process.exit(1);
      }

      console.log('OpenAPI types are up to date.');
      return;
    }

    writeTypes(outputPath);
    console.log(`OpenAPI types generated at ${outputPath}`);
  } catch (error) {
    console.error('Failed to generate OpenAPI types.');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

run();
