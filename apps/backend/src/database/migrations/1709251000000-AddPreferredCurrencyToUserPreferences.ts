import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPreferredCurrencyToUserPreferences1709251000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update existing users to have preferredCurrency in their preferences
    await queryRunner.query(`
      UPDATE users 
      SET preferences = jsonb_set(
        COALESCE(preferences, '{"notifications":{"priceAlerts":true,"newsAlerts":true,"securityAlerts":true}}'::jsonb),
        '{preferredCurrency}',
        '"USD"'::jsonb
      )
      WHERE preferences#>>'{preferredCurrency}' IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove preferredCurrency from user preferences
    await queryRunner.query(`
      UPDATE users 
      SET preferences = preferences - 'preferredCurrency'
      WHERE preferences ? 'preferredCurrency'
    `);
  }
}
