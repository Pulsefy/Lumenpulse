import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('mobile startup budget config', () => {
  const root = path.resolve(__dirname, '..', '..');

  it('defines cold, warm, and TTI metrics with warning and max thresholds', () => {
    const budgets = JSON.parse(
      readFileSync(path.join(root, 'mobile-startup-budgets.json'), 'utf8'),
    ) as {
      metrics: Record<string, { baselineMs: number; warningMs: number; maxMs: number }>;
    };

    for (const key of ['coldStartMs', 'warmStartMs', 'timeToInteractiveMs']) {
      const entry = budgets.metrics[key];
      expect(entry).toBeDefined();
      expect(entry.warningMs).toBeLessThan(entry.maxMs);
      expect(entry.baselineMs).toBeLessThanOrEqual(entry.warningMs);
    }
  });

  it('keeps baseline metrics aligned with mobile-startup-baseline.json', () => {
    const budgets = JSON.parse(
      readFileSync(path.join(root, 'mobile-startup-budgets.json'), 'utf8'),
    ) as { metrics: Record<string, { baselineMs: number }> };
    const baseline = JSON.parse(
      readFileSync(path.join(root, 'mobile-startup-baseline.json'), 'utf8'),
    ) as { metrics: Record<string, number> };

    for (const key of Object.keys(baseline.metrics)) {
      expect(budgets.metrics[key]?.baselineMs).toBe(baseline.metrics[key]);
    }
  });
});
