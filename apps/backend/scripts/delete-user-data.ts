/**
 * Operator entry point for the user-data erasure flow.
 *
 * Usage (from apps/backend):
 *
 *   npm run typeorm -- ...            # not used here
 *   npx ts-node scripts/delete-user-data.ts <user-id>
 *   node dist/scripts/delete-user-data.js <user-id>
 *
 * It boots the normal application context so the same `ConfigModule` and
 * database settings as the API are used, then delegates to
 * `UserDataDeletionService`. The run is idempotent and audited; the subject is
 * reported only as a one-way hash.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { UserDataDeletionService } from '../src/data-retention/user-data-deletion.service';

async function main(): Promise<void> {
  const userId = process.argv[2]?.trim();
  if (!userId) {
    console.error('Usage: delete-user-data <user-id>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const result = await app.get(UserDataDeletionService).deleteUserData(userId);
    Logger.log(`Erased user data: ${JSON.stringify(result)}`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error('User-data deletion failed:');
  console.error(error);
  process.exit(1);
});
