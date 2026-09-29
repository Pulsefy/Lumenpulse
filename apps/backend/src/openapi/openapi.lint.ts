import { OpenAPIObject } from '@nestjs/swagger';
import {
  API_KEY_SECURITY_SCHEME,
  JWT_SECURITY_SCHEME,
  WEBHOOK_SIGNATURE_SECURITY_SCHEME,
} from './openapi.constants';
import { NO_RESPONSE_BODY_EXTENSION } from './api-no-body-response.decorator';

type OperationObject = OpenAPIObject['paths'][string]['get'] & object;
type SchemaObject = Record<string, unknown>;

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

/**
 * Guard class name → security scheme the operation must declare.
 *
 * Every guard that can reach a route must be listed here or in
 * NON_CREDENTIAL_GUARDS; an unclassified guard fails the lint, so a new auth
 * guard can't silently ship without a matching scheme in the contract.
 */
export const GUARD_SECURITY_SCHEMES: Record<string, string> = {
  JwtAuthGuard: JWT_SECURITY_SCHEME,
  RolesGuard: JWT_SECURITY_SCHEME,
  ContractAdminGuard: JWT_SECURITY_SCHEME,
  ContractAdminTrustedCallerGuard: API_KEY_SECURITY_SCHEME,
  WebhookVerificationGuard: WEBHOOK_SIGNATURE_SECURITY_SCHEME,
  SorobanEventIngestionGuard: WEBHOOK_SIGNATURE_SECURITY_SCHEME,
  DriftAlertIngestionGuard: WEBHOOK_SIGNATURE_SECURITY_SCHEME,
};

/** Guards that gate a route without asking the client for credentials. */
export const NON_CREDENTIAL_GUARDS: ReadonlySet<string> = new Set([
  'RateLimitGuard',
  'ThrottlerGuard',
  'IpAllowlistGuard',
  'FeatureFlagGuard',
]);

/** operationId → names of guard classes protecting that route. */
export type RouteGuardMap = Map<string, string[]>;

/**
 * Returns human-readable violations that make the spec an unreliable contract
 * for generated clients. An empty list means the document is complete.
 */
export function lintOpenApiDocument(
  document: OpenAPIObject,
  routeGuards: RouteGuardMap,
): string[] {
  return [
    ...lintDocumentation(document),
    ...lintSecurity(document, routeGuards),
  ];
}

/**
 * Checks that every operation declares exactly the security its guards
 * enforce. These violations are never baselined: a wrong auth contract makes
 * generated clients send the wrong credentials, or none.
 */
export function lintSecurity(
  document: OpenAPIObject,
  routeGuards: RouteGuardMap,
): string[] {
  const known = new Set(
    Object.keys(document.components?.securitySchemes ?? {}),
  );

  return forEachOperation(document, (operation) => {
    const problems: string[] = [];
    const operationId = operation.operationId ?? '';
    const guards = routeGuards.get(operationId);
    if (!guards) {
      return [
        'not found in the controller graph, so its guards (and required security) cannot be verified',
      ];
    }

    const required = new Set<string>();
    for (const guard of guards) {
      const scheme = GUARD_SECURITY_SCHEMES[guard];
      if (scheme) {
        required.add(scheme);
      } else if (!NON_CREDENTIAL_GUARDS.has(guard)) {
        problems.push(
          `guarded by unclassified guard ${guard}; add it to GUARD_SECURITY_SCHEMES (if it checks client credentials) or NON_CREDENTIAL_GUARDS in src/openapi/openapi.lint.ts`,
        );
      }
    }

    // Each entry of `security` is an alternative (OR); schemes inside one
    // entry are all required (AND). Guards all run, so every alternative
    // must carry every scheme the guards demand.
    const alternatives = (operation.security ?? []).map((req) =>
      Object.keys(req),
    );
    const declared = new Set(alternatives.flat());

    for (const scheme of declared) {
      if (!known.has(scheme)) {
        problems.push(`declares unknown security scheme "${scheme}"`);
      } else if (!required.has(scheme)) {
        problems.push(
          `declares the "${scheme}" security scheme but no guard on the route enforces it`,
        );
      }
    }

    for (const scheme of required) {
      const guardNames = guards
        .filter((g) => GUARD_SECURITY_SCHEMES[g] === scheme)
        .join(', ');
      if (!declared.has(scheme)) {
        problems.push(
          `guarded by ${guardNames} but does not declare the "${scheme}" security scheme`,
        );
      } else if (alternatives.some((alt) => !alt.includes(scheme))) {
        problems.push(
          `declares "${scheme}" as optional (a separate security alternative), but ${guardNames} always requires it; declare all schemes in one requirement, e.g. @ApiSecurity({ '${[...required].join("': [], '")}': [] })`,
        );
      }
    }

    return problems;
  });
}

/**
 * Checks the parts of the contract that make generated clients usable:
 * tags, summaries, and typed bodies. Pre-existing gaps are tracked in
 * `openapi-lint-baseline.json` (see scripts/generate-openapi.ts).
 */
export function lintDocumentation(document: OpenAPIObject): string[] {
  const violations = forEachOperation(document, lintOperationDocs);

  for (const [name, schema] of Object.entries(
    document.components?.schemas ?? {},
  )) {
    if (isEmptySchema(schema as SchemaObject)) {
      violations.push(
        `schema ${name}: has no properties (add @ApiProperty or use a *.dto.ts file)`,
      );
    }
  }

  return violations;
}

function forEachOperation(
  document: OpenAPIObject,
  lint: (operation: OperationObject) => string[],
): string[] {
  const violations: string[] = [];
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      const where = `${method.toUpperCase()} ${path} [${operation.operationId}]`;
      violations.push(
        ...lint(operation).map((message) => `${where}: ${message}`),
      );
    }
  }
  return violations;
}

function lintOperationDocs(operation: OperationObject): string[] {
  const problems: string[] = [];

  if (!operation.tags?.length) {
    problems.push('missing @ApiTags on the controller');
  }
  if (!operation.summary?.trim()) {
    problems.push('missing @ApiOperation({ summary })');
  }

  const successStatuses = Object.keys(operation.responses).filter((status) =>
    /^[23]\d\d$/.test(status),
  );
  if (successStatuses.length === 0) {
    problems.push('missing a documented 2xx/3xx response');
  }
  const bodyless = (operation as Record<string, unknown>)[
    NO_RESPONSE_BODY_EXTENSION
  ];
  for (const status of bodyless ? [] : successStatuses) {
    const response = operation.responses[status];
    if (!/^2/.test(status) || status === '204') continue;
    if (!response || '$ref' in response) continue;
    if (!response.content || Object.keys(response.content).length === 0) {
      problems.push(
        `${status} response has no body schema (add @ApiOkResponse/@ApiCreatedResponse with a type; @ApiNoBodyResponse if the handler returns nothing)`,
      );
    }
  }

  const body = operation.requestBody;
  if (body && !('$ref' in body)) {
    const schemas = Object.values(body.content ?? {}).map(
      (media) => media.schema as SchemaObject | undefined,
    );
    if (schemas.length === 0 || schemas.some((s) => !s || isEmptySchema(s))) {
      problems.push('request body has no schema (type the @Body() with a DTO)');
    }
  }

  return problems;
}

function isEmptySchema(schema: SchemaObject): boolean {
  if (!schema || typeof schema !== 'object') return true;
  if (Object.keys(schema).length === 0) return true;
  if (schema.$ref || schema.enum || schema.allOf || schema.oneOf) return false;
  if (schema.anyOf || schema.items || schema.additionalProperties) return false;
  if (schema.type && schema.type !== 'object') return false;
  const properties = schema.properties as SchemaObject | undefined;
  return !properties || Object.keys(properties).length === 0;
}
