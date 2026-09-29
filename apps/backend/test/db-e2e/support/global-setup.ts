import 'reflect-metadata';
import { join } from 'path';
import { Keypair } from '@stellar/stellar-sdk';
import { DataSource } from 'typeorm';
import { adminConn, createDatabase, dropDatabase, ephemeralDbName } from './db';

const SRC = join(__dirname, '..', '..', '..', 'src');

/**
 * Creates a disposable Postgres database, enables required extensions and runs
 * every migration against it. Test workers inherit DB_DATABASE, so AppModule
 * boots against this database only. Torn down in global-teardown (which Jest
 * runs on test success or failure); if setup itself fails we drop it here.
 */
export default async function globalSetup(): Promise<void> {
  const started = Date.now();
  // The shared test default is not a valid Stellar secret; StellarService decodes it on boot.
  process.env.STELLAR_SERVER_SECRET ||= Keypair.random().secret();
  // Dummy S3 settings: UploadService reads these on init but no request hits S3.
  Object.assign(process.env, {
    AWS_BUCKET_NAME: process.env.AWS_BUCKET_NAME || 'e2e-bucket',
    AWS_REGION: process.env.AWS_REGION || 'us-east-1',
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || 'e2e',
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || 'e2e',
  });
  const name = ephemeralDbName();
  await createDatabase(name);

  try {
    const conn = adminConn();
    const ds = new DataSource({
      type: 'postgres',
      host: conn.host,
      port: conn.port,
      username: conn.user,
      password: conn.password,
      database: name,
      entities: [join(SRC, '**', '*.entity.ts')],
      migrations: [join(SRC, 'database', 'migrations', '*.ts')],
      migrationsTransactionMode: 'each',
    });
    await ds.initialize();
    await ds.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    const applied = await ds.runMigrations();
    await ds.destroy();

    process.env.DB_DATABASE = name;
    (globalThis as Record<string, unknown>).__E2E__ = {
      name,
      started,
      migrationsMs: Date.now() - started,
      migrations: applied.length,
    };
    console.log(
      `\n[db-e2e] ephemeral DB ${name}: ${applied.length} migrations in ${Date.now() - started}ms`,
    );
  } catch (err) {
    await dropDatabase(name).catch(() => undefined);
    throw err;
  }
}
