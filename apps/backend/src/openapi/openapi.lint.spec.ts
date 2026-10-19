import { OpenAPIObject } from '@nestjs/swagger';
import {
  lintDocumentation,
  lintOpenApiDocument,
  lintSecurity,
} from './openapi.lint';
import {
  API_KEY_SECURITY_SCHEME,
  JWT_SECURITY_SCHEME,
  WEBHOOK_SIGNATURE_SECURITY_SCHEME,
} from './openapi.constants';

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

const OPERATION_ID = 'ItemsController_list';

const validOperation = (overrides: Partial<Operation> = {}): Operation => ({
  operationId: OPERATION_ID,
  tags: ['items'],
  summary: 'List items',
  responses: {
    '200': {
      description: 'ok',
      content: { 'application/json': { schema: { type: 'array' } } },
    },
  },
  ...overrides,
});

const doc = (
  operation: Operation,
  schemas: Record<string, object> = {},
): OpenAPIObject => ({
  openapi: '3.0.0',
  info: { title: 'test', version: '1' },
  paths: { '/items': { get: operation } },
  components: {
    schemas,
    securitySchemes: {
      [JWT_SECURITY_SCHEME]: { type: 'http', scheme: 'bearer' },
      [API_KEY_SECURITY_SCHEME]: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
      },
      [WEBHOOK_SIGNATURE_SECURITY_SCHEME]: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Webhook-Signature',
      },
    },
  },
});

const guardedBy = (...guards: string[]) => new Map([[OPERATION_ID, guards]]);

const secured = (...alternatives: string[][]) =>
  validOperation({
    security: alternatives.map((schemes) =>
      Object.fromEntries(schemes.map((s) => [s, []])),
    ),
  });

describe('lintDocumentation', () => {
  it('accepts a complete operation', () => {
    expect(lintDocumentation(doc(validOperation()))).toEqual([]);
  });

  it('requires tags and a summary', () => {
    expect(
      lintDocumentation(doc(validOperation({ tags: [], summary: '' }))),
    ).toEqual([
      expect.stringContaining('missing @ApiTags'),
      expect.stringContaining('missing @ApiOperation'),
    ]);
  });

  it('requires a body schema on 2xx responses other than 204', () => {
    expect(
      lintDocumentation(
        doc(validOperation({ responses: { '200': { description: 'ok' } } })),
      ),
    ).toEqual([expect.stringContaining('200 response has no body schema')]);

    expect(
      lintDocumentation(
        doc(validOperation({ responses: { '204': { description: 'gone' } } })),
      ),
    ).toEqual([]);
  });

  it('accepts a bodiless 2xx marked with @ApiNoBodyResponse', () => {
    expect(
      lintDocumentation(
        doc({
          ...validOperation({ responses: { '200': { description: 'ok' } } }),
          'x-no-response-body': true,
        } as Operation),
      ),
    ).toEqual([]);
  });

  it('flags untyped request bodies and empty component schemas', () => {
    expect(
      lintDocumentation(
        doc(
          validOperation({
            requestBody: {
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          }),
          { EmptyDto: { type: 'object', properties: {} } },
        ),
      ),
    ).toEqual([
      expect.stringContaining('request body has no schema'),
      'schema EmptyDto: has no properties (add @ApiProperty or use a *.dto.ts file)',
    ]);
  });
});

describe('lintSecurity', () => {
  it('accepts a public route with no guards and no security', () => {
    expect(lintSecurity(doc(validOperation()), guardedBy())).toEqual([]);
  });

  it('ignores guards that need no client credentials', () => {
    expect(
      lintSecurity(
        doc(validOperation()),
        guardedBy('RateLimitGuard', 'FeatureFlagGuard', 'IpAllowlistGuard'),
      ),
    ).toEqual([]);
  });

  describe.each([
    ['JwtAuthGuard', JWT_SECURITY_SCHEME],
    ['RolesGuard', JWT_SECURITY_SCHEME],
    ['ContractAdminGuard', JWT_SECURITY_SCHEME],
    ['ContractAdminTrustedCallerGuard', API_KEY_SECURITY_SCHEME],
    ['WebhookVerificationGuard', WEBHOOK_SIGNATURE_SECURITY_SCHEME],
    ['SorobanEventIngestionGuard', WEBHOOK_SIGNATURE_SECURITY_SCHEME],
  ])('a route guarded by %s', (guard, scheme) => {
    it(`passes when it declares "${scheme}"`, () => {
      expect(lintSecurity(doc(secured([scheme])), guardedBy(guard))).toEqual(
        [],
      );
    });

    it(`fails when it declares nothing`, () => {
      expect(lintSecurity(doc(validOperation()), guardedBy(guard))).toEqual([
        expect.stringContaining(
          `guarded by ${guard} but does not declare the "${scheme}" security scheme`,
        ),
      ]);
    });

    it(`fails when it declares only a different scheme`, () => {
      const other =
        scheme === JWT_SECURITY_SCHEME
          ? API_KEY_SECURITY_SCHEME
          : JWT_SECURITY_SCHEME;

      expect(lintSecurity(doc(secured([other])), guardedBy(guard))).toEqual([
        expect.stringContaining(
          `declares the "${other}" security scheme but no guard on the route enforces it`,
        ),
        expect.stringContaining(`does not declare the "${scheme}"`),
      ]);
    });
  });

  it('requires JWT and API key together when both guards apply', () => {
    const guards = guardedBy('JwtAuthGuard', 'ContractAdminTrustedCallerGuard');

    expect(
      lintSecurity(
        doc(secured([JWT_SECURITY_SCHEME, API_KEY_SECURITY_SCHEME])),
        guards,
      ),
    ).toEqual([]);

    // Two entries mean "JWT *or* API key", which the guards don't allow.
    expect(
      lintSecurity(
        doc(secured([JWT_SECURITY_SCHEME], [API_KEY_SECURITY_SCHEME])),
        guards,
      ),
    ).toEqual([
      expect.stringContaining(`declares "${JWT_SECURITY_SCHEME}" as optional`),
      expect.stringContaining(
        `declares "${API_KEY_SECURITY_SCHEME}" as optional`,
      ),
    ]);
  });

  it('rejects an anonymous alternative on a guarded route', () => {
    expect(
      lintSecurity(
        doc(secured([JWT_SECURITY_SCHEME], [])),
        guardedBy('JwtAuthGuard'),
      ),
    ).toEqual([
      expect.stringContaining(`declares "${JWT_SECURITY_SCHEME}" as optional`),
    ]);
  });

  it('rejects a guard it does not know how to classify', () => {
    expect(
      lintSecurity(doc(validOperation()), guardedBy('PartnerTokenGuard')),
    ).toEqual([
      expect.stringContaining(
        'guarded by unclassified guard PartnerTokenGuard',
      ),
    ]);
  });

  it('rejects a security scheme missing from components', () => {
    expect(lintSecurity(doc(secured(['bearer'])), guardedBy())).toEqual([
      expect.stringContaining('declares unknown security scheme "bearer"'),
    ]);
  });

  it('rejects a route missing from the controller graph', () => {
    expect(lintSecurity(doc(validOperation()), new Map())).toEqual([
      expect.stringContaining('not found in the controller graph'),
    ]);
  });
});

describe('lintOpenApiDocument', () => {
  it('reports documentation and security violations together', () => {
    expect(
      lintOpenApiDocument(
        doc(validOperation({ summary: '' })),
        guardedBy('JwtAuthGuard'),
      ),
    ).toEqual([
      expect.stringContaining('missing @ApiOperation'),
      expect.stringContaining('does not declare the "JWT-auth"'),
    ]);
  });
});
