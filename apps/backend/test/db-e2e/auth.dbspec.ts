import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  PASSWORD,
  bearer,
  createApp,
  createUser,
  http,
  uniqueEmail,
} from './support/app';

describe('Auth (db e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('runs against the migrated ephemeral database', async () => {
    const rows: { current_database: string }[] = await app
      .get(DataSource)
      .query('SELECT current_database()');
    const db = rows[0].current_database;
    expect(db).toMatch(/^lumenpulse_e2e_/);
  });

  it('registers, logs in and reads the profile', async () => {
    const email = uniqueEmail('auth');
    await http(app)
      .post('/auth/register')
      .send({ email, password: PASSWORD })
      .expect(201);
    const login = await http(app)
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const body = login.body as { access_token: string; refresh_token: string };
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();

    const profile = await http(app)
      .get('/auth/profile')
      .set(bearer(body.access_token))
      .expect(200);
    expect((profile.body as { email: string }).email).toBe(email);
  });

  it('rejects duplicate registration and bad credentials', async () => {
    const user = await createUser(app, 'dup');
    await http(app)
      .post('/auth/register')
      .send({ email: user.email, password: PASSWORD })
      .expect(409);
    await http(app)
      .post('/auth/login')
      .send({ email: user.email, password: 'wrong-password' })
      .expect(401);
  });

  it('guards protected routes without a token', async () => {
    await http(app).get('/auth/profile').expect(401);
    await http(app).get('/auth/profile').set(bearer('not-a-jwt')).expect(401);
  });
});
