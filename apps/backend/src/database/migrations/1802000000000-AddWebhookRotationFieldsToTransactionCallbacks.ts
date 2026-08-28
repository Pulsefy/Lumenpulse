import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddWebhookRotationFieldsToTransactionCallbacks1802000000000 implements MigrationInterface {
  name = 'AddWebhookRotationFieldsToTransactionCallbacks1802000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'transaction_callbacks',
      new TableColumn({
        name: 'secretId',
        type: 'varchar',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'transaction_callbacks',
      new TableColumn({
        name: 'previousSecretId',
        type: 'varchar',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'transaction_callbacks',
      new TableColumn({
        name: 'lastDeliveryStatus',
        type: 'varchar',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'transaction_callbacks',
      new TableColumn({
        name: 'lastSignature',
        type: 'varchar',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'transaction_callbacks',
      new TableColumn({
        name: 'lastResponseStatusCode',
        type: 'int',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'transaction_callbacks',
      new TableColumn({
        name: 'lastDeliveredAt',
        type: 'timestamptz',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'transaction_callbacks',
      new TableColumn({
        name: 'lastDeliveryError',
        type: 'text',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'transaction_callbacks',
      new TableColumn({
        name: 'deliveryHistory',
        type: 'jsonb',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('transaction_callbacks', 'deliveryHistory');
    await queryRunner.dropColumn('transaction_callbacks', 'lastDeliveryError');
    await queryRunner.dropColumn('transaction_callbacks', 'lastDeliveredAt');
    await queryRunner.dropColumn(
      'transaction_callbacks',
      'lastResponseStatusCode',
    );
    await queryRunner.dropColumn('transaction_callbacks', 'lastSignature');
    await queryRunner.dropColumn('transaction_callbacks', 'lastDeliveryStatus');
    await queryRunner.dropColumn('transaction_callbacks', 'previousSecretId');
    await queryRunner.dropColumn('transaction_callbacks', 'secretId');
  }
}
