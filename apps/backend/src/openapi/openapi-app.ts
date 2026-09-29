import { INestApplication, Type, VersioningType } from '@nestjs/common';
import { ApplicationConfig, NestApplication } from '@nestjs/core';
import { NestContainer } from '@nestjs/core/injector/container';
import { Injector } from '@nestjs/core/injector/injector';
import { NoopGraphInspector } from '@nestjs/core/inspector/noop-graph-inspector';
import { MetadataScanner } from '@nestjs/core/metadata-scanner';
import { DependenciesScanner } from '@nestjs/core/scanner';
import { ExpressAdapter } from '@nestjs/platform-express';

export interface ScannedApplication {
  app: INestApplication;
  container: NestContainer;
  /** Guards registered through `app.useGlobalGuards()` during `setup`. */
  globalGuards: unknown[];
}

/**
 * Builds the module/controller graph of `rootModule` without resolving or
 * instantiating a single provider.
 *
 * Swagger only needs controller metadata, so the spec can be generated in CI
 * with no database, Redis or Stellar RPC — and without depending on every
 * provider's dependencies being resolvable. Mirrors the app-level settings
 * from `main.ts` that change route paths (URI versioning).
 */
export async function scanApplication(
  rootModule: Type<unknown>,
  setup?: (app: INestApplication) => void,
): Promise<ScannedApplication> {
  const config = new ApplicationConfig();
  const container = new NestContainer(config);
  const httpAdapter = new ExpressAdapter();
  container.setHttpAdapter(httpAdapter);

  const scanner = new DependenciesScanner(
    container,
    new MetadataScanner(),
    NoopGraphInspector,
    config,
  );
  await scanner.scan(rootModule);

  // Swagger reads route metadata off controller prototypes. Create them
  // without running constructors, exactly as Nest's preview mode does.
  const injector = new Injector();
  for (const moduleRef of container.getModules().values()) {
    for (const wrapper of moduleRef.controllers.values()) {
      injector.loadPrototype(wrapper, moduleRef.controllers);
    }
  }

  const app = new NestApplication(
    container,
    httpAdapter,
    config,
    NoopGraphInspector,
    { logger: false },
  );
  app.enableVersioning({ type: VersioningType.URI });
  // Run the same setup as main.ts so guards it registers with
  // app.useGlobalGuards() are visible to the security lint.
  setup?.(app);

  return { app, container, globalGuards: config.getGlobalGuards() };
}
