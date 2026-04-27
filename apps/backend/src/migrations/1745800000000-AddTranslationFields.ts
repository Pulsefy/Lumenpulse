import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddTranslationFields1745800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add original_language column
    await queryRunner.addColumn(
      'articles',
      new TableColumn({
        name: 'original_language',
        type: 'varchar',
        length: '10',
        isNullable: true,
        comment: 'ISO 639-1 language code of the original content',
      }),
    );

    // Add original_title column
    await queryRunner.addColumn(
      'articles',
      new TableColumn({
        name: 'original_title',
        type: 'text',
        isNullable: true,
        comment: 'Original title before translation',
      }),
    );

    // Add translation_confidence column
    await queryRunner.addColumn(
      'articles',
      new TableColumn({
        name: 'translation_confidence',
        type: 'float',
        isNullable: true,
        comment: 'Confidence score of language detection (0-1)',
      }),
    );

    // Add is_translated column
    await queryRunner.addColumn(
      'articles',
      new TableColumn({
        name: 'is_translated',
        type: 'boolean',
        default: false,
        isNullable: false,
        comment: 'Whether the content was translated to English',
      }),
    );

    // Add normalized_at column
    await queryRunner.addColumn(
      'articles',
      new TableColumn({
        name: 'normalized_at',
        type: 'timestamp',
        isNullable: true,
        comment: 'Timestamp when content was normalized and translated',
      }),
    );

    // Create index on original_language for filtering
    await queryRunner.query(
      `CREATE INDEX "IDX_articles_original_language" ON "articles" ("original_language")`,
    );

    // Create index on is_translated for filtering
    await queryRunner.query(
      `CREATE INDEX "IDX_articles_is_translated" ON "articles" ("is_translated")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX "IDX_articles_is_translated"`);
    await queryRunner.query(`DROP INDEX "IDX_articles_original_language"`);

    // Drop columns
    await queryRunner.dropColumn('articles', 'normalized_at');
    await queryRunner.dropColumn('articles', 'is_translated');
    await queryRunner.dropColumn('articles', 'translation_confidence');
    await queryRunner.dropColumn('articles', 'original_title');
    await queryRunner.dropColumn('articles', 'original_language');
  }
}
