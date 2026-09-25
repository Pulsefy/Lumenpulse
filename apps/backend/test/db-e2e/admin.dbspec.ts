import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PASSWORD, bearer, createApp, createUser, http } from './support/app';

describe('Admin paths (db e2e)', () => {
  let app: INestApplication;
  let user: { token: string; id: string; email: string };
  let admin: { token: string };

  beforeAll(async () => {
    app = await createApp();
    user = await createUser(app, 'adm-user');
    admin = await createUser(app, 'adm-admin', 'admin');
  });
  afterAll(async () => {
    await app.close();
  });

  it('protects audit logs: 401 anonymous, 403 user, 200 admin', async () => {
    await http(app).get('/admin/audit-logs').expect(401);
    await http(app)
      .get('/admin/audit-logs')
      .set(bearer(user.token))
      .expect(403);
    await http(app)
      .get('/admin/audit-logs')
      .set(bearer(admin.token))
      .expect(200);
  });

  it('records auth activity in audit logs visible to admins', async () => {
    await http(app)
      .post('/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    const res = await http(app)
      .get('/admin/audit-logs')
      .set(bearer(admin.token))
      .expect(200);
    expect(JSON.stringify(res.body)).toContain(user.id);
  });

  it('protects demo-data bootstrap behind the admin role', async () => {
    await http(app)
      .post('/crowdfund/admin/bootstrap-demo-data')
      .set(bearer(user.token))
      .expect(403);
    const res = await http(app)
      .post('/crowdfund/admin/bootstrap-demo-data')
      .set(bearer(admin.token));
    expect([200, 201, 403, 404]).toContain(res.status);
    expect(res.status).not.toBe(401);
  });

  it('enforces role changes made in the database on the next login', async () => {
    const other = await createUser(app, 'adm-promote');
    await http(app)
      .get('/admin/audit-logs')
      .set(bearer(other.token))
      .expect(403);
    await app
      .get(DataSource)
      .query("UPDATE users SET role = 'admin' WHERE id = $1", [other.id]);
    const login = await http(app)
      .post('/auth/login')
      .send({ email: other.email, password: PASSWORD })
      .expect(200);
    await http(app)
      .get('/admin/audit-logs')
      .set(bearer((login.body as { access_token: string }).access_token))
      .expect(200);
  });
});
