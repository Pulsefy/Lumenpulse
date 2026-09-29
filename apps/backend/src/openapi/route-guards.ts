import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { Type } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { NestContainer } from '@nestjs/core/injector/container';
import { RouteGuardMap } from './openapi.lint';

/** Name reported for a guard whose class can't be identified. */
export const ANONYMOUS_GUARD = '<anonymous guard>';

/**
 * Class name of a guard given as a class or an instance. A guard without a
 * usable name is reported as ANONYMOUS_GUARD, which the lint can't classify,
 * so it fails rather than being skipped.
 */
const guardName = (guard: unknown): string => {
  const name =
    typeof guard === 'function'
      ? guard.name
      : (guard as { constructor?: { name?: string } } | null)?.constructor
          ?.name;
  return name && name !== 'Object' && name !== 'Function'
    ? name
    : ANONYMOUS_GUARD;
};

const guardsOf = (target: object): unknown[] =>
  (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[] | undefined) ?? [];

/**
 * Guards registered with `{ provide: APP_GUARD, ... }` in any module. Nest
 * stores each under a generated `APP_GUARD (UUID: ...)` token. A factory's
 * return type can't be known statically, so it is reported under a name the
 * lint doesn't recognise, which forces it to be made a class and classified.
 */
function collectAppGuards(container: NestContainer): string[] {
  const names: string[] = [];
  for (const moduleRef of container.getModules().values()) {
    for (const [token, wrapper] of moduleRef.providers) {
      if (typeof token !== 'string' || !token.startsWith(APP_GUARD)) continue;
      names.push(
        wrapper.inject
          ? `${APP_GUARD} factory in ${moduleRef.metatype.name}`
          : guardName(wrapper.metatype ?? wrapper.instance),
      );
    }
  }
  return names;
}

/**
 * Maps every route's operationId (`Controller_method`, matching
 * `createOpenApiDocument`) to the guards that run for it: `APP_GUARD`
 * providers, guards passed to `app.useGlobalGuards()` during the scanned
 * setup, and controller and handler `@UseGuards`. The spec lint uses this to
 * check that each route declares the security its guards enforce.
 */
export function collectRouteGuards(
  container: NestContainer,
  appGlobalGuards: unknown[] = [],
): RouteGuardMap {
  const routes: RouteGuardMap = new Map();
  const globalGuards = [
    ...collectAppGuards(container),
    ...appGlobalGuards.map(guardName),
  ];

  for (const moduleRef of container.getModules().values()) {
    for (const wrapper of moduleRef.controllers.values()) {
      const controller = wrapper.metatype as Type<unknown> | null;
      if (!controller) continue;

      const classGuards = guardsOf(controller);

      for (const methodName of Object.getOwnPropertyNames(
        controller.prototype,
      )) {
        const handler = (controller.prototype as Record<string, unknown>)[
          methodName
        ];
        if (typeof handler !== 'function') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) {
          continue;
        }

        routes.set(`${controller.name}_${methodName}`, [
          ...globalGuards,
          ...[...classGuards, ...guardsOf(handler)].map(guardName),
        ]);
      }
    }
  }

  return routes;
}

/**
 * Setup code the generator runs, so its `app.useGlobalGuards()` calls are
 * captured and mapped. Relative to the source root.
 */
export const SCANNED_SETUP_FILES = ['bootstrap/app.setup.ts'];

/**
 * `app.useGlobalGuards()` calls anywhere else (e.g. directly in main.ts) run
 * only in the live app, never in the offline scan, so their guards can't be
 * mapped to OpenAPI security. Each such call is a violation: register the
 * guard with APP_GUARD or move it into setupApp().
 */
export function findUnmappedGlobalGuardCalls(sourceRoot: string): string[] {
  const violations: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') visit(path);
        continue;
      }
      if (!/\.ts$/.test(entry.name) || /\.(spec|d)\.ts$/.test(entry.name)) {
        continue;
      }
      const file = relative(sourceRoot, path).split('\\').join('/');
      if (SCANNED_SETUP_FILES.includes(file)) continue;
      codeOnly(readFileSync(path, 'utf8'))
        .split('\n')
        .forEach((line, index) => {
          if (/\.useGlobalGuards\s*\(/.test(line)) {
            violations.push(
              `${file}:${index + 1}: app.useGlobalGuards() here is not seen by the OpenAPI scan, so its guards can't be mapped to security schemes; register the guard with APP_GUARD or call it from setupApp()`,
            );
          }
        });
    }
  };
  visit(sourceRoot);
  return violations;
}

/**
 * Blanks out comments and string/template literals, keeping newlines so line
 * numbers still match, so only real calls are reported.
 */
function codeOnly(source: string): string {
  // Sticky regexes match only at lastIndex: a comment or a string literal.
  const skippable =
    /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/y;
  let out = '';
  let i = 0;
  while (i < source.length) {
    skippable.lastIndex = i;
    const match = skippable.exec(source);
    if (match) {
      out += match[0].replace(/[^\n]/g, ' ');
      i += match[0].length;
    } else {
      out += source[i++];
    }
  }
  return out;
}
