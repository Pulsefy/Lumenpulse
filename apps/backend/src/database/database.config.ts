import { registerAs } from '@nestjs/config';
import { config } from '../lib/config';

export default registerAs('database', () => ({
  type: 'postgres' as const,
  host: config.database.host,
  port: config.database.port,
  username: config.database.username,
  // Database drivers require the raw password string.
  password: config.database.password.reveal(),
  database: config.database.database,
  synchronize: false,
  logging: config.database.logging,
}));
