import { DataSource } from 'typeorm';
import { dbConfig } from './db-env';

export default new DataSource({
  type: 'postgres',
  host: dbConfig.host,
  port: dbConfig.port,
  username: dbConfig.username,
  // TypeORM expects a plain credential string for the connection handshake.
  password: dbConfig.password,
  database: dbConfig.database,

  entities: ['dist/**/*.entity.js', 'src/**/*.entity.ts'],

  migrations: ['dist/database/migrations/*.js', 'src/database/migrations/*.ts'],
  migrationsTransactionMode: 'each',

  logging: true,
});
