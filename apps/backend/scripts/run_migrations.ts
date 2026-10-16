import dataSource from '../src/database/data-source';
import { DataSource } from 'typeorm';

// Allow the migration runner to be used as part of the one-command local stack
// (e.g. `docker compose up` / CI integration tests) without interactive prompts.
if (process.env.NODE_ENV === undefined) {
  process.env.NODE_ENV = 'development';
}

(async () => {
  try {
    console.log('Initializing DataSource...');
    await dataSource.initialize();
    console.log('DataSource initialized');

    // Wrap DataSource.createQueryRunner to log SQL executed during migrations
    const ds = dataSource as unknown as DataSource & { createQueryRunner: any };
    const origCreateQU = ds.createQueryRunner.bind(ds);
    ds.createQueryRunner = function (mode?: any) {
      const runner = origCreateQU(mode);
      const origQuery = runner.query.bind(runner);
      runner.query = async function (query: string, parameters?: any[]) {
        console.log('\n--- SQL ----');
        console.log(query);
        if (parameters && parameters.length) console.log('params:', parameters);
        try {
          const result = await origQuery(query, parameters);
          console.log('--- OK ----\n');
          return result;
        } catch (err) {
          console.error('--- SQL ERROR ----');
          console.error(err);
          throw err;
        }
      };
      return runner;
    };

    const pending = await dataSource.showMigrations();
    console.log('showMigrations() ->', pending);

    console.log('Running migrations...');
    const res = await dataSource.runMigrations();
    console.log('runMigrations() result length:', Array.isArray(res) ? res.length : res);

    await dataSource.destroy();
    console.log('Done');

    // Exit explicitly so the one-command local stack / CI can rely on a clean
    // exit code once migrations have been applied.
    process.exit(0);
  } catch (e) {
    console.error('Migration script error:');
    console.error(e);
    process.exit(1);
  }
})();
