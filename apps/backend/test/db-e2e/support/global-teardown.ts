import { appendFileSync } from 'fs';
import { dropDatabase } from './db';

interface E2EState {
  name: string;
  started: number;
  migrationsMs: number;
  migrations: number;
}

/** Drops the disposable DB and reports total suite runtime (setup + specs). */
export default async function globalTeardown(): Promise<void> {
  const state = (globalThis as Record<string, unknown>).__E2E__ as
    | E2EState
    | undefined;
  if (!state) return;

  await dropDatabase(state.name);

  const total = ((Date.now() - state.started) / 1000).toFixed(1);
  const line = `[db-e2e] suite runtime: ${total}s (migrations: ${state.migrations} in ${state.migrationsMs}ms); dropped ${state.name}`;
  console.log(`\n${line}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Backend DB e2e\n${line}\n`,
    );
  }
}
