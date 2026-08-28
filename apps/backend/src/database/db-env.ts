import { z } from 'zod';

const dbEnvSchema = z.object({
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535),
  DB_USERNAME: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_DATABASE: z.string().min(1),
});

const result = dbEnvSchema.safeParse(process.env);

if (!result.success) {
  const details = result.error.issues
    .map((issue) => {
      const variable = issue.path.length > 0 ? issue.path.join('.') : 'ENVIRONMENT';
      return `${variable}: ${issue.message}`;
    })
    .join('\n');

  throw new Error(
    `Database configuration validation failed. Fix the following variables:\n${details}`,
  );
}

export const dbConfig = Object.freeze({
  host: result.data.DB_HOST,
  port: result.data.DB_PORT,
  username: result.data.DB_USERNAME,
  password: result.data.DB_PASSWORD,
  database: result.data.DB_DATABASE,
});

export type DbConfig = typeof dbConfig;
