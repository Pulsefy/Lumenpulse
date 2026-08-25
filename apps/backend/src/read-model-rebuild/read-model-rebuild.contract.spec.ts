import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

describe('Data-processing OpenAPI Contract', () => {
  let openapiSchema: any;

  beforeAll(() => {
    // Artifact location documented for backend contributors: apps/data-processing/openapi.json
    const schemaPath = resolve(__dirname, '../../../data-processing/openapi.json');
    if (existsSync(schemaPath)) {
      const content = readFileSync(schemaPath, 'utf8');
      openapiSchema = JSON.parse(content);
    } else {
      console.warn(`OpenAPI schema not found at ${schemaPath}, skipping test`);
    }
  });

  it('should define the rebuild endpoints used by read-model-rebuild.service.ts', () => {
    if (!openapiSchema) return; // Skip if no schema (e.g. initial setup before python build)

    const requiredEndpoints = [
      '/api/rebuild/kpi-snapshots',
      '/api/rebuild/project-views',
      '/api/rebuild/contract-events',
      '/api/rebuild/metrics',
      '/api/rebuild/all',
    ];

    for (const endpoint of requiredEndpoints) {
      expect(openapiSchema.paths[endpoint]).toBeDefined();
      expect(openapiSchema.paths[endpoint].post).toBeDefined();

      const postOp = openapiSchema.paths[endpoint].post;

      // Assert Request payload
      const requestBody = postOp.requestBody;
      expect(requestBody).toBeDefined();
      const content = requestBody.content['application/json'];
      expect(content).toBeDefined();
      const schemaRef = content.schema.$ref;
      expect(schemaRef).toBeDefined();
      
      const schemaName = schemaRef.split('/').pop();
      const requestSchema = openapiSchema.components.schemas[schemaName];
      expect(requestSchema).toBeDefined();
      
      // Assert it has dataset, force, etc.
      expect(requestSchema.properties.dataset).toBeDefined();
      expect(requestSchema.properties.contract_id).toBeDefined();
      expect(requestSchema.properties.force).toBeDefined();

      // Assert Response payload
      const response200 = postOp.responses['200'];
      expect(response200).toBeDefined();
      const responseContent = response200.content['application/json'];
      expect(responseContent).toBeDefined();
      const responseSchemaRef = responseContent.schema.$ref;
      expect(responseSchemaRef).toBeDefined();

      const responseSchemaName = responseSchemaRef.split('/').pop();
      const responseSchema = openapiSchema.components.schemas[responseSchemaName];
      expect(responseSchema).toBeDefined();

      // Ensure response has totalItems, processedItems, failedItems to match NestJS expectations
      expect(responseSchema.properties.totalItems).toBeDefined();
      expect(responseSchema.properties.processedItems).toBeDefined();
      expect(responseSchema.properties.failedItems).toBeDefined();
    }
  });
});
