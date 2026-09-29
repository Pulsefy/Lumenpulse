import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import { UserRole } from '../users/entities/user.entity';

type AuthDecision = 'public' | 'authenticated' | 'role-based' | 'ip-allowlist';

interface RouteInfo {
  controller: string;
  method: string;
  path: string;
  hasJwtGuard: boolean;
  hasRolesGuard: boolean;
  hasContractAdminGuard: boolean;
  hasIpAllowlistGuard: boolean;
  requiredRoles: UserRole[];
  authorizationDecision: AuthDecision;
}

const ROOT = path.join(__dirname, '..');
const METHOD_DECORATOR =
  /@(Get|Post|Put|Patch|Delete)\s*(?:\(\s*(?:['"`]([^'"`]*)['"`])?\s*\))?/g;

function normalizePath(value: string): string {
  const normalized = value.replace(/^\/+|\/+$/g, '');
  return normalized ? `/${normalized}` : '/';
}

function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join('/'));
}

function getControllerBasePath(source: string): string {
  const match = source.match(
    /@Controller\s*(?:\(\s*(?:\{[^}]*path\s*:\s*['"`]([^'"`]+)['"`][^}]*\}|['"`]([^'"`]+)['"`])\s*\))?/m,
  );
  return match?.[1] ?? match?.[2] ?? '';
}

function getRoles(context: string): UserRole[] {
  const roles: UserRole[] = [];
  const matches = context.matchAll(/UserRole\.(ADMIN|REVIEWER|USER)/g);

  for (const match of matches) {
    const role = UserRole[match[1] as keyof typeof UserRole];
    if (role && !roles.includes(role)) roles.push(role);
  }

  return roles;
}

function getAuthorizationDecision(context: string): AuthDecision {
  if (context.includes('IpAllowlistGuard')) return 'ip-allowlist';
  if (
    context.includes('ContractAdminGuard') ||
    context.includes('RolesGuard')
  ) {
    return 'role-based';
  }
  if (context.includes('JwtAuthGuard')) return 'authenticated';

  // Public endpoints are allowed to have no auth decorators in this app.
  return 'public';
}

function getControllerFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return getControllerFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.controller.ts')
      ? [fullPath]
      : [];
  });
}

function readRoutes(filePath: string): RouteInfo[] {
  const source = fs.readFileSync(filePath, 'utf8');
  const classMatch = source.match(/export class (\w+Controller)/);
  if (!classMatch) return [];

  const classStart = source.indexOf(`export class ${classMatch[1]}`);
  const classDecorators = source.slice(0, classStart);
  const basePath = getControllerBasePath(source);
  const routes: RouteInfo[] = [];

  METHOD_DECORATOR.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = METHOD_DECORATOR.exec(source)) !== null) {
    if (match.index > classStart) break;

    const nextDecorator = source
      .slice(match.index + match[0].length)
      .search(/\n\s*@/);
    const end =
      nextDecorator < 0
        ? source.length
        : match.index + match[0].length + nextDecorator;
    const context = `${classDecorators}\n${source.slice(match.index, end)}`;

    routes.push({
      controller: classMatch[1],
      method: match[1].toUpperCase(),
      path: joinPath(basePath, match[2] ?? ''),
      hasJwtGuard: context.includes('JwtAuthGuard'),
      hasRolesGuard: context.includes('RolesGuard'),
      hasContractAdminGuard: context.includes('ContractAdminGuard'),
      hasIpAllowlistGuard: context.includes('IpAllowlistGuard'),
      requiredRoles: getRoles(context),
      authorizationDecision: getAuthorizationDecision(context),
    });
  }

  return routes;
}

function discoverRoutes(): RouteInfo[] {
  return getControllerFiles(ROOT).flatMap(readRoutes);
}

describe('Authorization Matrix Regression Checks', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [],
    }).compile();
    app = moduleFixture.createNestApplication();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('requires authentication for administrative routes', () => {
    const violations = discoverRoutes()
      .filter((route) => route.path.includes('/admin'))
      .filter(
        (route) =>
          !route.hasJwtGuard &&
          !route.hasRolesGuard &&
          !route.hasContractAdminGuard,
      )
      .map((route) => `${route.controller}: ${route.method} ${route.path}`);

    expect(violations).toEqual([]);
  });

  it('requires an ADMIN role for ContractAdminGuard routes', () => {
    const violations = discoverRoutes()
      .filter((route) => route.hasContractAdminGuard)
      .filter((route) => !route.requiredRoles.includes(UserRole.ADMIN))
      .map((route) => `${route.controller}: ${route.method} ${route.path}`);

    expect(violations).toEqual([]);
  });

  it('does not classify guarded routes as public', () => {
    const violations = discoverRoutes()
      .filter(
        (route) =>
          route.authorizationDecision === 'public' &&
          (route.hasJwtGuard ||
            route.hasRolesGuard ||
            route.hasContractAdminGuard ||
            route.hasIpAllowlistGuard),
      )
      .map((route) => `${route.controller}: ${route.method} ${route.path}`);

    expect(violations).toEqual([]);
  });
});
