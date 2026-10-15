import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * @irreversible PostgreSQL enum values cannot be removed safely without
 * rebuilding the type, so this migration has no revertible down().
 */
export class AddReplayingStatusToSorobanDeadLetter1811000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "soroban_event_dead_letter_status_enum" ADD VALUE IF NOT EXISTS 'replaying'`,
    );
  }

  async down(): Promise<void> {
    // PostgreSQL enum values cannot be removed safely without rebuilding the type.
  }
}
