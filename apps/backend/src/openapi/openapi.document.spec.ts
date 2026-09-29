import { OpenAPIObject } from '@nestjs/swagger';
import { enrichOpenApiDocument } from './openapi.document';
import {
  ERROR_RESPONSE_SCHEMA,
  IDEMPOTENCY_KEY_HEADER,
  JWT_SECURITY_SCHEME,
  REQUEST_ID_RESPONSE_HEADER,
} from './openapi.constants';

const doc = (paths: OpenAPIObject['paths']): OpenAPIObject => ({
  openapi: '3.0.0',
  info: { title: 'test', version: '1' },
  paths,
  components: { schemas: {} },
});

const errorRef = {
  'application/json': {
    schema: { $ref: `#/components/schemas/${ERROR_RESPONSE_SCHEMA}` },
  },
};

describe('enrichOpenApiDocument', () => {
  it('adds the idempotency header and idempotency errors to writes', () => {
    const result = enrichOpenApiDocument(
      doc({
        '/items': {
          post: {
            responses: { '201': { description: 'Created' } },
            requestBody: {
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      }),
    );
    const op = result.paths['/items'].post!;

    expect(op.parameters).toEqual([
      expect.objectContaining({
        name: IDEMPOTENCY_KEY_HEADER,
        in: 'header',
        required: false,
      }),
    ]);
    expect(Object.keys(op.responses)).toEqual([
      '201',
      '400',
      '409',
      '422',
      '429',
      '500',
    ]);
  });

  it('does not add the idempotency header to reads', () => {
    const result = enrichOpenApiDocument(
      doc({
        '/items': { get: { responses: { '200': { description: 'ok' } } } },
      }),
    );
    const op = result.paths['/items'].get!;

    expect(op.parameters).toBeUndefined();
    expect(Object.keys(op.responses)).toEqual(['200', '429', '500']);
  });

  it('does not duplicate an explicitly declared idempotency header', () => {
    const result = enrichOpenApiDocument(
      doc({
        '/items': {
          put: {
            parameters: [
              { name: 'idempotency-key', in: 'header', required: true },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      }),
    );

    expect(result.paths['/items'].put!.parameters).toHaveLength(1);
  });

  it('adds 401/403 to secured operations and 404 to parameterised paths', () => {
    const result = enrichOpenApiDocument(
      doc({
        '/items/{id}': {
          get: {
            security: [{ [JWT_SECURITY_SCHEME]: [] }],
            parameters: [{ name: 'id', in: 'path', required: true }],
            responses: { '200': { description: 'ok' } },
          },
        },
      }),
    );

    expect(Object.keys(result.paths['/items/{id}'].get!.responses)).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '429',
      '500',
    ]);
  });

  it('points every error response at the shared envelope, keeping descriptions', () => {
    const result = enrichOpenApiDocument(
      doc({
        '/items': {
          get: {
            responses: {
              '200': { description: 'ok' },
              '503': {
                description: 'Upstream down',
                content: {
                  'application/json': { schema: { type: 'string' } },
                },
              },
            },
          },
        },
      }),
    );
    const responses = result.paths['/items'].get!.responses;

    expect(responses['503']).toMatchObject({
      description: 'Upstream down',
      content: errorRef,
    });
    expect(responses['500']).toMatchObject({ content: errorRef });
    expect(responses['200']).not.toHaveProperty('content');
  });

  it('documents the correlation header on every response', () => {
    const result = enrichOpenApiDocument(
      doc({
        '/items': { get: { responses: { '200': { description: 'ok' } } } },
      }),
    );

    for (const response of Object.values(
      result.paths['/items'].get!.responses,
    )) {
      expect(response).toHaveProperty(['headers', REQUEST_ID_RESPONSE_HEADER]);
    }
  });
});
