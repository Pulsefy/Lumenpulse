import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { globToRegExp, matchesAny } from './lib/glob.mjs';
import { classify, expectedWorkflows, loadConfig } from './ci-coverage.mjs';

const config = loadConfig();

test('glob: ** crosses directories, * does not', () => {
  assert.ok(globToRegExp('apps/backend/**').test('apps/backend/src/main.ts'));
  assert.ok(!globToRegExp('apps/backend/*').test('apps/backend/src/main.ts'));
  assert.ok(globToRegExp('**/*.md').test('README.md'));
  assert.ok(globToRegExp('**/*.md').test('apps/x/README.md'));
  assert.ok(!globToRegExp('docs/**').test('apps/docs/a.md'));
  assert.ok(matchesAny('package.json', ['package.json']));
});

// Parse the `paths:` list under a trigger (push / pull_request) of a workflow.
function pathsOf(workflowFile, trigger) {
  const lines = fs.readFileSync(`.github/workflows/${workflowFile}`, 'utf8').split('\n');
  const start = lines.findIndex((l) => l === `  ${trigger}:`);
  if (start === -1) return null;
  const result = [];
  let inPaths = false;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) || /^  \S/.test(line)) break; // next trigger or top-level key
    if (/^    paths:\s*$/.test(line)) { inPaths = true; continue; }
    if (/^    \S/.test(line)) { inPaths = false; continue; }
    const m = /^      - ['"]?(.+?)['"]?\s*$/.exec(line);
    if (inPaths && m) result.push(m[1]);
  }
  return result;
}

test('workflow path filters mirror .github/ci-paths.json', () => {
  for (const [workflow, globs] of Object.entries(config.workflows)) {
    for (const trigger of ['push', 'pull_request']) {
      const actual = pathsOf(workflow, trigger);
      if (actual === null) continue; // trigger without a path filter
      assert.deepEqual(actual, globs, `${workflow} ${trigger} paths drifted from ci-paths.json`);
    }
    assert.ok(fs.existsSync(`.github/workflows/${workflow}`), `${workflow} is listed but missing`);
  }
});

test('the .ci-trigger sentinel is gone everywhere', () => {
  for (const workflow of fs.readdirSync('.github/workflows')) {
    assert.ok(!fs.readFileSync(`.github/workflows/${workflow}`, 'utf8').includes('.ci-trigger'), workflow);
  }
});

// The three real pull requests that merged with no CI at all (issue #1723).
test('known case #1763: webapp-only change now triggers Webapp CI', () => {
  const files = ['apps/webapp/app/admin/verification/page.tsx', 'docs/verification-review-workspace.md'];
  assert.ok(expectedWorkflows(files, config).includes('webapp.yml'));
});

test('known cases #1731 / #1710 / #1733: workflow-only changes trigger workflow lint', () => {
  for (const files of [
    ['.github/workflows/onchain.yml'],
    ['.github/workflows/backend.yml'],
    ['.github/actions/job-timeout-guard/action.yml', '.github/dependabot.yml'],
  ]) {
    assert.ok(expectedWorkflows(files, config).includes('workflow-lint.yml'), files.join());
  }
  assert.ok(expectedWorkflows(['.github/workflows/onchain.yml'], config).includes('onchain.yml'));
});

test('known case #1709: scripts-only change triggers Scripts CI', () => {
  const files = ['scripts/run-emergency-pause-drill.mjs', 'scripts/package.json'];
  assert.ok(expectedWorkflows(files, config).includes('scripts-ci.yml'));
});

test('shared root files trigger every dependent workflow', () => {
  assert.ok(expectedWorkflows(['package.json'], config).includes('backend.yml'));
  assert.ok(expectedWorkflows(['pnpm-lock.yaml'], config).includes('mobile.yml'));
  assert.ok(expectedWorkflows(['turbo.json'], config).includes('webapp.yml'));
  assert.ok(expectedWorkflows(['docker-compose.yml'], config).includes('data-processing.yml'));
  assert.ok(expectedWorkflows(['.nvmrc'], config).includes('backend.yml'));
  assert.ok(expectedWorkflows(['.python-version'], config).includes('data-processing.yml'));
  assert.ok(expectedWorkflows(['.github/actions/setup-node-app/action.yml'], config).includes('mobile.yml'));
});

test('classify: docs are exempt, uncovered code under a code root is blocking', () => {
  const r = classify(['docs/ci.md', 'apps/new-service/src/index.ts', 'prometheus.yml', 'apps/backend/src/a.ts'], config);
  assert.deepEqual(r.exempt, ['docs/ci.md']);
  assert.deepEqual(r.uncoveredCode, ['apps/new-service/src/index.ts']);
  assert.deepEqual(r.uncoveredOther, ['prometheus.yml']);
  assert.deepEqual(r.covered, ['apps/backend/src/a.ts']);
});
