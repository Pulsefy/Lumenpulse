import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import {
  CanActivate,
  Controller,
  INestApplication,
  Get,
  Injectable,
  Module,
  Post,
  Type,
  UseGuards,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiBearerAuth, ApiSecurity, OpenAPIObject } from '@nestjs/swagger';
import { scanApplication } from './openapi-app';
import { createOpenApiDocument } from './openapi.document';
import { GUARD_SECURITY_SCHEMES, lintSecurity } from './openapi.lint';
import {
  ANONYMOUS_GUARD,
  collectRouteGuards,
  findUnmappedGlobalGuardCalls,
} from './route-guards';
import {
  API_KEY_SECURITY_SCHEME,
  JWT_SECURITY_SCHEME,
  WEBHOOK_SIGNATURE_SECURITY_SCHEME,
} from './openapi.constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { ContractAdminTrustedCallerGuard } from '../common/guards/contract-admin-trusted-caller.guard';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard';
import { WebhookVerificationGuard } from '../webhook/webhook-verification.guard';
import { SorobanEventIngestionGuard } from '../soroban-events/guards/soroban-event-ingestion.guard';
import { AppModule } from '../app.module';
import { setupApp } from '../bootstrap/app.setup';

/** Scans a module exactly like scripts/generate-openapi.ts does. */
async function build(
  rootModule: Type<unknown>,
  setup?: (app: INestApplication) => void,
) {
  const { app, container, globalGuards } = await scanApplication(
    rootModule,
    setup,
  );
  const document = createOpenApiDocument(app);
  const routeGuards = collectRouteGuards(container, globalGuards);
  return {
    document,
    routeGuards,
    violations: lintSecurity(document, routeGuards),
  };
}

function operation(document: OpenAPIObject, operationId: string) {
  for (const pathItem of Object.values(document.paths)) {
    for (const op of Object.values(pathItem)) {
      if ((op as { operationId?: string }).operationId === operationId) {
        return op as { security?: Record<string, string[]>[] };
      }
    }
  }
  throw new Error(`No operation ${operationId}`);
}

const violationsFor = (violations: string[], operationId: string) =>
  violations.filter((v) => v.includes(`[${operationId}]`));

@Injectable()
class PartnerTokenGuard implements CanActivate {
  canActivate() {
    return true;
  }
}

@Controller('fixture-jwt')
@UseGuards(JwtAuthGuard, RolesGuard)
class JwtFixtureController {
  @Get('declared')
  @ApiBearerAuth(JWT_SECURITY_SCHEME)
  declared() {}

  @Get('undeclared')
  undeclared() {}

  @Get('unnamed')
  @ApiBearerAuth()
  unnamed() {}

  @Get('wrong-scheme')
  @ApiSecurity(API_KEY_SECURITY_SCHEME)
  wrongScheme() {}
}

@Controller('fixture-api-key')
@UseGuards(JwtAuthGuard, ContractAdminTrustedCallerGuard)
class ApiKeyFixtureController {
  @Post('both')
  @ApiSecurity({ [JWT_SECURITY_SCHEME]: [], [API_KEY_SECURITY_SCHEME]: [] })
  both() {}

  @Post('either')
  @ApiBearerAuth(JWT_SECURITY_SCHEME)
  @ApiSecurity(API_KEY_SECURITY_SCHEME)
  either() {}

  @Post('jwt-only')
  @ApiBearerAuth(JWT_SECURITY_SCHEME)
  jwtOnly() {}

  @Post('wrong-scheme')
  @ApiSecurity({
    [JWT_SECURITY_SCHEME]: [],
    [WEBHOOK_SIGNATURE_SECURITY_SCHEME]: [],
  })
  wrongScheme() {}
}

@Controller('fixture-webhooks')
class WebhookFixtureController {
  @Post('signed')
  @UseGuards(WebhookVerificationGuard)
  @ApiSecurity(WEBHOOK_SIGNATURE_SECURITY_SCHEME)
  signed() {}

  @Post('unsigned')
  @UseGuards(WebhookVerificationGuard)
  unsigned() {}

  @Post('soroban')
  @UseGuards(SorobanEventIngestionGuard)
  soroban() {}

  @Post('wrong-scheme')
  @UseGuards(WebhookVerificationGuard)
  @ApiBearerAuth(JWT_SECURITY_SCHEME)
  wrongScheme() {}
}

@Controller('fixture-public')
class PublicFixtureController {
  @Get('open')
  open() {}

  @Get('claims-auth')
  @ApiBearerAuth(JWT_SECURITY_SCHEME)
  claimsAuth() {}

  @Get('partner')
  @UseGuards(PartnerTokenGuard)
  partner() {}
}

@Module({
  controllers: [
    JwtFixtureController,
    ApiKeyFixtureController,
    WebhookFixtureController,
    PublicFixtureController,
  ],
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
class FixtureModule {}

@Controller('fixture-global')
class GloballyGuardedController {
  @Get('declared')
  @ApiBearerAuth(JWT_SECURITY_SCHEME)
  declared() {}

  @Get('undeclared')
  undeclared() {}
}

@Module({
  controllers: [GloballyGuardedController],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
class GlobalJwtFixtureModule {}

@Controller('fixture-use-global')
class UseGlobalGuardsController {
  @Get('declared')
  @ApiBearerAuth(JWT_SECURITY_SCHEME)
  declared() {}

  @Get('undeclared')
  undeclared() {}
}

@Module({ controllers: [UseGlobalGuardsController] })
class UseGlobalGuardsFixtureModule {}

/** A JwtAuthGuard instance, as main.ts would pass it, without its DI deps. */
const jwtGuardInstance = () =>
  Object.create(JwtAuthGuard.prototype) as CanActivate;

describe('security lint against real guards', () => {
  let violations: string[];
  let routeGuards: Map<string, string[]>;

  beforeAll(async () => {
    ({ violations, routeGuards } = await build(FixtureModule));
  });

  it('collects APP_GUARD guards onto every route', () => {
    for (const guards of routeGuards.values()) {
      expect(guards[0]).toBe('RateLimitGuard');
    }
  });

  describe('JWT-protected routes', () => {
    it('pass when they declare JWT-auth', () => {
      expect(
        violationsFor(violations, 'JwtFixtureController_declared'),
      ).toEqual([]);
    });

    it('fail when they declare nothing', () => {
      expect(
        violationsFor(violations, 'JwtFixtureController_undeclared'),
      ).toEqual([
        expect.stringContaining(
          `guarded by JwtAuthGuard, RolesGuard but does not declare the "${JWT_SECURITY_SCHEME}"`,
        ),
      ]);
    });

    it('fail when @ApiBearerAuth() is unnamed (emits an undefined "bearer" scheme)', () => {
      expect(violationsFor(violations, 'JwtFixtureController_unnamed')).toEqual(
        [
          expect.stringContaining('declares unknown security scheme "bearer"'),
          expect.stringContaining(
            `does not declare the "${JWT_SECURITY_SCHEME}"`,
          ),
        ],
      );
    });
  });

  describe('JWT-protected route declaring the wrong scheme', () => {
    it('fails for both the missing and the unenforced scheme', () => {
      expect(
        violationsFor(violations, 'JwtFixtureController_wrongScheme'),
      ).toEqual([
        expect.stringContaining(
          `declares the "${API_KEY_SECURITY_SCHEME}" security scheme but no guard on the route enforces it`,
        ),
        expect.stringContaining(
          `does not declare the "${JWT_SECURITY_SCHEME}"`,
        ),
      ]);
    });
  });

  describe('API-key-protected routes', () => {
    it('pass when JWT and API key are one requirement', () => {
      expect(violationsFor(violations, 'ApiKeyFixtureController_both')).toEqual(
        [],
      );
    });

    it('fail when JWT and API key are separate alternatives', () => {
      expect(
        violationsFor(violations, 'ApiKeyFixtureController_either'),
      ).toEqual([
        expect.stringContaining(`"${JWT_SECURITY_SCHEME}" as optional`),
        expect.stringContaining(`"${API_KEY_SECURITY_SCHEME}" as optional`),
      ]);
    });

    it('fail when the API key is not declared', () => {
      expect(
        violationsFor(violations, 'ApiKeyFixtureController_jwtOnly'),
      ).toEqual([
        expect.stringContaining(
          `guarded by ContractAdminTrustedCallerGuard but does not declare the "${API_KEY_SECURITY_SCHEME}"`,
        ),
      ]);
    });
  });

  describe('API-key-protected route declaring the wrong scheme', () => {
    it('fails for both the missing and the unenforced scheme', () => {
      expect(
        violationsFor(violations, 'ApiKeyFixtureController_wrongScheme'),
      ).toEqual([
        expect.stringContaining(
          `declares the "${WEBHOOK_SIGNATURE_SECURITY_SCHEME}" security scheme but no guard on the route enforces it`,
        ),
        expect.stringContaining(
          `does not declare the "${API_KEY_SECURITY_SCHEME}"`,
        ),
      ]);
    });
  });

  describe('webhook-signature-protected routes', () => {
    it('pass when they declare webhook-signature', () => {
      expect(
        violationsFor(violations, 'WebhookFixtureController_signed'),
      ).toEqual([]);
    });

    it.each([
      ['WebhookFixtureController_unsigned', 'WebhookVerificationGuard'],
      ['WebhookFixtureController_soroban', 'SorobanEventIngestionGuard'],
    ])('%s fails when it declares nothing', (operationId, guard) => {
      expect(violationsFor(violations, operationId)).toEqual([
        expect.stringContaining(
          `guarded by ${guard} but does not declare the "${WEBHOOK_SIGNATURE_SECURITY_SCHEME}"`,
        ),
      ]);
    });
  });

  describe('webhook-signature-protected route declaring the wrong scheme', () => {
    it('fails for both the missing and the unenforced scheme', () => {
      expect(
        violationsFor(violations, 'WebhookFixtureController_wrongScheme'),
      ).toEqual([
        expect.stringContaining(
          `declares the "${JWT_SECURITY_SCHEME}" security scheme but no guard on the route enforces it`,
        ),
        expect.stringContaining(
          `does not declare the "${WEBHOOK_SIGNATURE_SECURITY_SCHEME}"`,
        ),
      ]);
    });
  });

  describe('other routes', () => {
    it('accept a public route', () => {
      expect(violationsFor(violations, 'PublicFixtureController_open')).toEqual(
        [],
      );
    });

    it('reject declared auth that no guard enforces', () => {
      expect(
        violationsFor(violations, 'PublicFixtureController_claimsAuth'),
      ).toEqual([expect.stringContaining('no guard on the route enforces it')]);
    });

    it('reject an unclassified guard', () => {
      expect(
        violationsFor(violations, 'PublicFixtureController_partner'),
      ).toEqual([
        expect.stringContaining('unclassified guard PartnerTokenGuard'),
      ]);
    });
  });

  it('applies a global credential guard to routes with no @UseGuards', async () => {
    const global = await build(GlobalJwtFixtureModule);

    expect(global.violations).toEqual([
      expect.stringMatching(
        /\[GloballyGuardedController_undeclared\]: guarded by JwtAuthGuard but does not declare/,
      ),
    ]);
  });

  it('maps guards passed to app.useGlobalGuards() in setup onto every route', async () => {
    const result = await build(UseGlobalGuardsFixtureModule, (app) => {
      app.useGlobalGuards(jwtGuardInstance());
    });

    expect(
      result.routeGuards.get('UseGlobalGuardsController_declared'),
    ).toEqual(['JwtAuthGuard']);
    expect(result.violations).toEqual([
      expect.stringMatching(
        /\[UseGlobalGuardsController_undeclared\]: guarded by JwtAuthGuard but does not declare/,
      ),
    ]);
  });

  it('fails every route when a useGlobalGuards() guard cannot be identified', async () => {
    const result = await build(UseGlobalGuardsFixtureModule, (app) => {
      app.useGlobalGuards({ canActivate: () => true });
    });

    expect(
      violationsFor(result.violations, 'UseGlobalGuardsController_declared'),
    ).toEqual([
      expect.stringContaining(`unclassified guard ${ANONYMOUS_GUARD}`),
      expect.stringContaining(
        `declares the "${JWT_SECURITY_SCHEME}" security scheme but no guard on the route enforces it`,
      ),
    ]);
    expect(
      violationsFor(result.violations, 'UseGlobalGuardsController_undeclared'),
    ).toEqual([
      expect.stringContaining(`unclassified guard ${ANONYMOUS_GUARD}`),
    ]);
  });
});

describe('findUnmappedGlobalGuardCalls', () => {
  let root: string;

  const write = (file: string, source: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), source);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'openapi-guards-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('fails a useGlobalGuards() call the OpenAPI scan does not run', () => {
    write('main.ts', 'app.use(x);\napp.useGlobalGuards(new AuthGuard());\n');

    expect(findUnmappedGlobalGuardCalls(root)).toEqual([
      expect.stringMatching(
        /^main\.ts:2: app\.useGlobalGuards\(\) here is not seen/,
      ),
    ]);
  });

  it('ignores mentions in comments and strings', () => {
    write(
      'main.ts',
      [
        '// app.useGlobalGuards(new AuthGuard());',
        '/* app.useGlobalGuards(x) */',
        "const hint = 'call app.useGlobalGuards() in setupApp';",
        'const msg = `app.useGlobalGuards(${x})`;',
      ].join('\n'),
    );

    expect(findUnmappedGlobalGuardCalls(root)).toEqual([]);
  });

  it('allows calls in setupApp (scanned) and ignores spec files', () => {
    write('bootstrap/app.setup.ts', 'app.useGlobalGuards(new AuthGuard());');
    write('main.spec.ts', 'app.useGlobalGuards(new AuthGuard());');

    expect(findUnmappedGlobalGuardCalls(root)).toEqual([]);
  });
});

describe('security contract of the real application', () => {
  let document: OpenAPIObject;
  let routeGuards: Map<string, string[]>;
  let violations: string[];

  beforeAll(async () => {
    ({ document, routeGuards, violations } = await build(AppModule, setupApp));
  }, 120_000);

  it('declares the correct scheme on every guarded route', () => {
    expect(violations).toEqual([]);
  });

  it.each([
    JWT_SECURITY_SCHEME,
    API_KEY_SECURITY_SCHEME,
    WEBHOOK_SIGNATURE_SECURITY_SCHEME,
  ])(
    'has routes protected by "%s", each declaring it in every requirement',
    (scheme) => {
      const protectedRoutes = [...routeGuards]
        .filter(([, guards]) =>
          guards.some((g) => GUARD_SECURITY_SCHEMES[g] === scheme),
        )
        .map(([operationId]) => operationId);

      // Guards the lint recognises by class name must still exist in the app;
      // if one is renamed, this goes empty instead of silently passing.
      expect(protectedRoutes.length).toBeGreaterThan(0);
      for (const operationId of protectedRoutes) {
        const security = operation(document, operationId).security ?? [];
        expect(security.length).toBeGreaterThan(0);
        for (const requirement of security) {
          expect(Object.keys(requirement)).toContain(scheme);
        }
      }
    },
  );

  it.each([
    ['AuthController_getActiveSessions', [[JWT_SECURITY_SCHEME]]],
    [
      'DeploymentManifestController_createManifest',
      [[JWT_SECURITY_SCHEME, API_KEY_SECURITY_SCHEME]],
    ],
    [
      'WebhookController_handleDataProcessing',
      [[WEBHOOK_SIGNATURE_SECURITY_SCHEME]],
    ],
    ['SorobanEventsController_ingest', [[WEBHOOK_SIGNATURE_SECURITY_SCHEME]]],
  ])('%s requires %j', (operationId, expected) => {
    expect(
      (operation(document, operationId).security ?? []).map((req) =>
        Object.keys(req).sort(),
      ),
    ).toEqual(expected.map((schemes) => [...schemes].sort()));
  });

  it('applies the global rate-limit guard to every route', () => {
    expect(routeGuards.size).toBeGreaterThan(0);
    for (const guards of routeGuards.values()) {
      expect(guards).toContain('RateLimitGuard');
    }
  });

  it('has no app.useGlobalGuards() call the scan cannot map', () => {
    expect(findUnmappedGlobalGuardCalls(resolve(__dirname, '..'))).toEqual([]);
  });

  it('has no unidentifiable guard on any route', () => {
    for (const guards of routeGuards.values()) {
      expect(guards).not.toContain(ANONYMOUS_GUARD);
    }
  });
});
