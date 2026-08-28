import dataSource from '../src/database/data-source';

/**
 * CI guard that proves the migration set is safe to deploy:
 *
 * 1. Runs every pending migration against a clean database (fails if any
 *    migration errors or references objects that do not exist yet).
 * 2. Compares the resulting database schema against the entity definitions
 *    and fails if any entity table or column is missing (schema drift).
 *
 * Requires a reachable PostgreSQL database configured through the standard
 * DB_* environment variables (see .env.example).
 */
async function main(): Promise<void> {
  try {
    await dataSource.initialize();
    console.log('DataSource initialized');

    const applied = await dataSource.runMigrations();
    console.log(`Applied ${applied.length} migration(s) to clean database`);

    const runner = dataSource.createQueryRunner();
    const tables = await runner.getTables();
    await runner.release();

    const databaseTables = new Map<string, Set<string>>();
    for (const table of tables) {
      databaseTables.set(
        table.name,
        new Set(table.columns.map((column) => column.name)),
      );
    }

    const missing: string[] = [];
    for (const entity of dataSource.entityMetadatas) {
      const tableName = entity.tableName;
      const dbColumns = databaseTables.get(tableName);
      if (!dbColumns) {
        missing.push(`  table "${tableName}" (entity ${entity.name})`);
        continue;
      }

      for (const column of entity.columns) {
        if (column.isVirtual) {
          continue;
        }
        if (!dbColumns.has(column.databaseName)) {
          missing.push(
            `  column "${tableName}"."${column.databaseName}" (entity ${entity.name})`,
          );
        }
      }
    }

    if (missing.length > 0) {
      console.error(
        `Schema drift detected: ${missing.length} entity table/column(s) are ` +
          'missing from the migrated database. Migrations do not produce a ' +
          'schema that matches the entity definitions.',
      );
      for (const entry of missing) {
        console.error(entry);
      }
      await dataSource.destroy();
      process.exit(1);
    }

    console.log(
      'OK: database schema matches entity definitions (no missing tables or columns)',
    );

    // Verify every down() migration runs by reverting the whole chain.
    let reverted = 0;
    try {
      let previousCount = Number.MAX_SAFE_INTEGER;
      for (;;) {
        const rows = await dataSource.query<Array<{ n: number }>>(
          `SELECT count(*)::int AS n FROM migrations`,
        );
        const currentCount = rows[0].n;
        if (currentCount === 0 || currentCount >= previousCount) {
          break;
        }
        previousCount = currentCount;
        await dataSource.undoLastMigration();
        reverted += 1;
      }
    } catch (error) {
      console.error(
        `Down-migration verification failed after ${reverted} revert(s):`,
      );
      console.error(error);
      await dataSource.destroy();
      process.exit(1);
    }

    console.log(
      `OK: reverted ${reverted} migration(s) — every down() ran successfully`,
    );
    await dataSource.destroy();
    process.exit(0);
  } catch (error) {
    console.error('Migration/schema verification failed:');
    console.error(error);
    try {
      if (dataSource.isInitialized) {
        await dataSource.destroy();
      }
    } catch {
      // ignore teardown errors
    }
    process.exit(1);
  }
}

void main();
