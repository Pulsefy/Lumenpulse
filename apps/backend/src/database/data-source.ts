import { DataSource } from 'typeorm';
import { config } from 'dotenv';

config();

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'lumenpulse',

  entities: ['dist/**/*.entity.js', 'src/**/*.entity.ts'],

  migrations: ['dist/database/migrations/*.js', 'src/database/migrations/*.ts'],

  logging: true,
});
