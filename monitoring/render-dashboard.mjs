#!/usr/bin/env node
// Rewrites lumenpulse-grafana-dashboard.json (an import-style export that uses
// ${DS_PROMETHEUS} and __inputs) into a provisionable dashboard that targets the
// provisioned datasource with uid "prometheus".
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function renderDashboard(source) {
  const text = JSON.stringify(source).split('${DS_PROMETHEUS}').join('prometheus');
  const dashboard = JSON.parse(text);
  delete dashboard.__inputs;
  dashboard.id = null;
  dashboard.templating = { list: (dashboard.templating?.list ?? []).filter((v) => v.name !== 'DS_PROMETHEUS') };
  return dashboard;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(root, 'monitoring/grafana/dashboards/lumenpulse-pipeline-metrics.json');
  mkdirSync(dirname(out), { recursive: true });
  const source = JSON.parse(readFileSync(join(root, 'lumenpulse-grafana-dashboard.json'), 'utf8'));
  writeFileSync(out, JSON.stringify(renderDashboard(source), null, 2) + '\n');
  console.log(`wrote ${out}`);
}
