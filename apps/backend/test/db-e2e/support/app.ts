import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../src/app.module';
import { setupApp } from '../../../src/bootstrap/app.setup';

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  setupApp(app);
  app.enableVersioning({ type: VersioningType.URI });
  await app.init();
  return app;
}

export const http = (app: INestApplication) =>
  request(app.getHttpServer() as Parameters<typeof request>[0]);

export const uniqueEmail = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.test`;

export const PASSWORD = 'E2ePassw0rd!';

/** Registers a user, optionally sets its role directly in the DB, logs in. */
export async function createUser(
  app: INestApplication,
  prefix: string,
  role: 'user' | 'reviewer' | 'admin' = 'user',
): Promise<{ id: string; email: string; token: string }> {
  const email = uniqueEmail(prefix);
  const reg = await http(app)
    .post('/auth/register')
    .send({ email, password: PASSWORD })
    .expect(201);
  const id = (reg.body as { id: string }).id;
  if (role !== 'user') {
    await app
      .get(DataSource)
      .query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
  }
  const login = await http(app)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return {
    id,
    email,
    token: (login.body as { access_token: string }).access_token,
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
