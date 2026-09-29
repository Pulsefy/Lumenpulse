import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';

export interface AdminConn {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** Admin connection (to the maintenance DB) used to create/drop the disposable DB. */
export function adminConn(): AdminConn {
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.E2E_ADMIN_DB ?? 'postgres',
  };
}

export function ephemeralDbName(): string {
  return `lumenpulse_e2e_${randomBytes(4).toString('hex')}`;
}

export async function withAdmin<T>(
  fn: (ds: DataSource) => Promise<T>,
): Promise<T> {
  const a = adminConn();
  const ds = new DataSource({
    type: 'postgres',
    host: a.host,
    port: a.port,
    username: a.user,
    password: a.password,
    database: a.database,
  });
  await ds.initialize();
  try {
    return await fn(ds);
  } finally {
    await ds.destroy();
  }
}

export const createDatabase = async (name: string): Promise<void> => {
  await withAdmin((c) => c.query(`CREATE DATABASE "${name}"`));
};

export const dropDatabase = async (name: string): Promise<void> => {
  await withAdmin((c) =>
    c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
  );
};
