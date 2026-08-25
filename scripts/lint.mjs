import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const apps = [
  { name: 'backend', path: 'apps/backend' },
  { name: 'webapp', path: 'apps/webapp' },
  { name: 'mobile', path: 'apps/mobile' },
];

let ranAny = false;
let failed = false;

for (const app of apps) {
  const nodeModules = join(app.path, 'node_modules');
  if (!existsSync(nodeModules)) {
    console.warn(
      `[lint] Skipping ${app.name}: dependencies not installed. Run: npm install --prefix ${app.path}`,
    );
    continue;
  }

  ranAny = true;
  console.log(`[lint] Running ${app.name}...`);
  const result = spawnSync('npm', ['run', 'lint'], {
    cwd: app.path,
    stdio: 'inherit',
    shell: true,
  });

  if (result.status !== 0) {
    failed = true;
    break;
  }
}

if (!ranAny) {
  console.error(
    '[lint] No app dependencies found. Install at least one app first, e.g. npm run install:apps',
  );
  process.exit(1);
}

process.exit(failed ? 1 : 0);
