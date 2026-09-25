import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import {
  API_KEY_SECURITY_SCHEME,
  ERROR_RESPONSE_SCHEMA,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_METHODS,
  JWT_SECURITY_SCHEME,
  REQUEST_ID_RESPONSE_HEADER,
  WEBHOOK_SIGNATURE_SECURITY_SCHEME,
} from './openapi.constants';
import { ErrorDetailDto, ErrorResponseDto } from './error-response.dto';

type OperationObject = OpenAPIObject['paths'][string]['get'] & object;
type ResponsesObject = OperationObject['responses'];
type ParameterObject = Extract<
  NonNullable<OperationObject['parameters']>[number],
  { in: string }
>;

const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

const API_DESCRIPTION = `Comprehensive API documentation for LumenPulse - A decentralized crypto news aggregator and portfolio management platform built on Stellar blockchain.

## Authentication
- **${JWT_SECURITY_SCHEME}**: \`Authorization: Bearer <jwt>\` obtained from \`POST /auth/login\`. Required on every operation that lists it under *security*.
- **${API_KEY_SECURITY_SCHEME}**: \`X-API-Key: <key>\` for trusted service callers (contract admin operations).
- **${WEBHOOK_SIGNATURE_SECURITY_SCHEME}**: HMAC signature headers on inbound webhook deliveries; see the individual operations for the timestamp and nonce headers they also require.

## Idempotency
Every \`POST\`, \`PUT\`, \`PATCH\` and \`DELETE\` accepts an optional \`${IDEMPOTENCY_KEY_HEADER}\` header. A repeated key with the same body replays the stored response for 24h; the same key with a different body returns **422**; a key still executing after the wait window returns **409**.

## Errors
Every non-2xx response uses the \`${ERROR_RESPONSE_SCHEMA}\` envelope (\`code\`, \`message\`, optional \`details\`, \`requestId\`).

## Correlation
Send \`${REQUEST_ID_RESPONSE_HEADER}\` to propagate your own correlation id; otherwise one is generated. It is echoed on every response.`;

export function buildSwaggerConfig(): Omit<OpenAPIObject, 'paths'> {
  return new DocumentBuilder()
    .setTitle('LumenPulse API')
    .setDescription(API_DESCRIPTION)
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT token',
      },
      JWT_SECURITY_SCHEME,
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'Trusted service caller API key',
      },
      API_KEY_SECURITY_SCHEME,
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-Webhook-Signature',
        description:
          'HMAC-SHA256 signature of the raw request body, computed with the shared webhook secret',
      },
      WEBHOOK_SIGNATURE_SECURITY_SCHEME,
    )
    .addTag('auth', 'Authentication and authorization endpoints')
    .addTag('config', 'Client-safe testnet/mainnet runtime configuration')
    .addTag('transactions', 'Transaction history and Stellar ledger queries')
    .addTag(
      'soroban-events',
      'Soroban smart contract event ingestion and tracking',
    )
    .addTag('users', 'User profile and account management')
    .addTag('news', 'Crypto news aggregation and sentiment analysis')
    .addTag('portfolio', 'Portfolio tracking and performance metrics')
    .addTag('stellar', 'Stellar blockchain integration')
    .addTag('search', 'Search and discovery endpoints')
    .addTag(
      'demo-bootstrap',
      'Testnet demo data bootstrap endpoints (admin only, testnet only)',
    )
    .addTag('contributor-feed', 'Aggregated contributor activity feed')
    .addTag(
      'contributor-registry',
      'On-chain contributor registration and reputation',
    )
    .addTag('admin-audit', 'Blockchain admin action audit log (admin only)')
    .addTag('crowdfund-sync', 'Crowdfund vault event sync and dead letters')
    .addServer('http://localhost:3000', 'Development')
    .addServer('https://api.lumenpulse.io', 'Production')
    .build();
}

/**
 * Builds the full OpenAPI document for the app: controller metadata plus the
 * cross-cutting behaviour that lives outside controllers (global exception
 * filter, idempotency interceptor, request-id middleware, rate limit guard).
 */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const document = SwaggerModule.createDocument(app, buildSwaggerConfig(), {
    extraModels: [ErrorResponseDto, ErrorDetailDto],
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey}_${methodKey}`,
  });
  return enrichOpenApiDocument(document);
}

const ERROR_DESCRIPTIONS: Record<string, string> = {
  '400': 'Malformed request or validation failure',
  '401': 'Missing or invalid credentials',
  '403': 'Authenticated but not permitted',
  '404': 'Resource not found',
  '409': `A request with the same ${IDEMPOTENCY_KEY_HEADER} is still in progress, or the resource is in a conflicting state`,
  '422': `${IDEMPOTENCY_KEY_HEADER} was reused with a different request body`,
  '429': 'Rate limit exceeded',
  '500': 'Unexpected server error',
};

const errorContent = () => ({
  'application/json': {
    schema: { $ref: `#/components/schemas/${ERROR_RESPONSE_SCHEMA}` },
  },
});

const requestIdHeader = () => ({
  [REQUEST_ID_RESPONSE_HEADER]: {
    description: 'Correlation id for this request',
    schema: { type: 'string' },
  },
});

/**
 * Adds the shared error envelope, idempotency header and correlation header
 * to every operation. Pure function over the document so it can be unit
 * tested without booting Nest.
 */
export function enrichOpenApiDocument(document: OpenAPIObject): OpenAPIObject {
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const parameters = [
        ...((pathItem.parameters as ParameterObject[] | undefined) ?? []),
        ...((operation.parameters as ParameterObject[] | undefined) ?? []),
      ];
      const isIdempotent = (IDEMPOTENT_METHODS as readonly string[]).includes(
        method,
      );
      const isSecured = (operation.security ?? []).some(
        (requirement) => Object.keys(requirement).length > 0,
      );

      if (isIdempotent) {
        addIdempotencyHeader(operation, parameters);
      }

      const expected = new Set(['429', '500']);
      if (parameters.length > 0 || operation.requestBody) expected.add('400');
      if (isSecured) {
        expected.add('401');
        expected.add('403');
      }
      if (path.includes('{')) expected.add('404');
      if (isIdempotent) {
        expected.add('409');
        expected.add('422');
      }

      operation.responses = normalizeResponses(operation.responses, expected);
    }
  }

  return document;
}

function addIdempotencyHeader(
  operation: OperationObject,
  parameters: ParameterObject[],
): void {
  const alreadyDeclared = parameters.some(
    (param) =>
      param.in === 'header' &&
      param.name.toLowerCase() === IDEMPOTENCY_KEY_HEADER.toLowerCase(),
  );
  if (alreadyDeclared) return;

  operation.parameters = [
    ...(operation.parameters ?? []),
    {
      name: IDEMPOTENCY_KEY_HEADER,
      in: 'header',
      required: false,
      description:
        'Client-generated unique key (UUID recommended). Retrying with the same key and body replays the original response instead of repeating the write.',
      schema: { type: 'string', maxLength: 255 },
    },
  ];
}

function normalizeResponses(
  responses: ResponsesObject,
  expected: Set<string>,
): ResponsesObject {
  const result: ResponsesObject = { ...responses };

  for (const status of expected) {
    if (!result[status]) {
      result[status] = { description: ERROR_DESCRIPTIONS[status] };
    }
  }

  for (const [status, response] of Object.entries(result)) {
    if (!response || '$ref' in response) continue;
    const code = Number(status);

    if (code >= 400 || status === 'default') {
      // GlobalExceptionFilter guarantees this envelope for every thrown error.
      response.content = errorContent();
    }
    response.headers = { ...requestIdHeader(), ...(response.headers ?? {}) };
  }

  // Stable ordering keeps the committed artifact diff-friendly.
  return Object.fromEntries(
    Object.entries(result).sort(([a], [b]) => a.localeCompare(b)),
  );
}
