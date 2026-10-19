import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDashboard } from '../monitoring/render-dashboard.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('rendered dashboard has no unresolved datasource placeholders', () => {
  const out = JSON.stringify(renderDashboard(JSON.parse(read('lumenpulse-grafana-dashboard.json'))));
  assert.ok(!out.includes('DS_PROMETHEUS'));
  assert.ok(!out.includes('__inputs'));
});

test('committed dashboard matches the rendered source', () => {
  const rendered = renderDashboard(JSON.parse(read('lumenpulse-grafana-dashboard.json')));
  const committed = JSON.parse(read('monitoring/grafana/dashboards/lumenpulse-pipeline-metrics.json'));
  assert.deepEqual(committed, rendered);
});

test('prometheus points at alertmanager and compose runs the full stack', () => {
  assert.match(read('prometheus.yml'), /^\s+- 'alertmanager:9093'/m);
  const compose = read('docker-compose.monitoring.yml');
  for (const svc of ['prometheus:', 'alertmanager:', 'grafana:']) assert.ok(compose.includes(`  ${svc}`));
  assert.ok(compose.includes('expand-external-labels'));
  assert.ok(compose.includes('prometheus-data:'));
});
