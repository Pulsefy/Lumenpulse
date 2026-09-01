import '../src/lib/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { buildSwaggerConfig } from '../src/bootstrap/swagger.config';

const OUTPUT_PATH = path.resolve(__dirname, '../openapi/openapi.json');

async function generate(): Promise<void> {
  // abortOnError: false so a bootstrap failure rejects the promise below
  // (and is reported by this script) instead of Nest calling process.exit()
  // internally before our own error handling runs.
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
    abortOnError: false,
  });
  const document = SwaggerModule.createDocument(app, buildSwaggerConfig());

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(document, null, 2)}\n`);

  await app.close();

  console.log(`OpenAPI spec written to ${OUTPUT_PATH}`);
}

generate().catch((error) => {
  console.error('Failed to generate OpenAPI spec:', error);
  process.exitCode = 1;
});
