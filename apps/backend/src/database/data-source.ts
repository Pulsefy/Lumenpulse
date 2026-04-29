import { DataSource } from 'typeorm';
import { config } from '../lib/config';

export default new DataSource({
  type: 'postgres',
  host: config.database.host,
  port: config.database.port,
  username: config.database.username,
  // TypeORM expects a plain credential string for the connection handshake.
  password: config.database.password.reveal(),
  database: config.database.database,

  entities: ['dist/**/*.entity.js', 'src/**/*.entity.ts'],

  migrations: ['dist/database/migrations/*.js', 'src/database/migrations/*.ts'],

  logging: true,
});
