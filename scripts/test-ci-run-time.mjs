import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBudgets, minutesBetween, percentile, slowestJobs, summarize } from './ci-run-time.mjs';

test('percentile uses the nearest rank', () => {
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(v, 50), 5);
  assert.equal(percentile(v, 90), 9);
  assert.equal(percentile(v, 100), 10);
  assert.equal(percentile([], 90), null);
});

test('summarize rounds to one decimal', () => {
  assert.deepEqual(summarize([1.26, 2.34, 3.45]), { samples: 3, p50: 2.3, p90: 3.5, max: 3.5 });
});

test('minutesBetween measures wall clock and rejects bad input', () => {
  assert.equal(minutesBetween('2026-01-01T00:00:00Z', '2026-01-01T00:03:30Z'), 3.5);
  assert.equal(minutesBetween('2026-01-01T00:03:30Z', '2026-01-01T00:00:00Z'), null);
});

test('evaluateBudgets flags only exceeded budgets', () => {
  const stats = {
    workflows: { 'a.yml': { p90: 5 }, 'b.yml': { p90: 1 } },
    jobs: { 'a.yml/x': { p90: 4 }, 'b.yml/y': { p90: 9 } },
  };
  const budgets = {
    workflows: { 'a.yml': { p90Minutes: 6 }, 'b.yml': { p90Minutes: 2 } },
    jobs: { 'a.yml/x': { p90Minutes: 3 }, 'b.yml/y': { p90Minutes: 10 } },
  };
  assert.deepEqual(evaluateBudgets(stats, budgets), [
    { scope: 'job', name: 'a.yml/x', measured: 4, budget: 3 },
  ]);
});

test('slowestJobs ranks by p90', () => {
  const stats = { jobs: { a: { p90: 1 }, b: { p90: 3 }, c: { p90: 2 }, d: { p90: null } } };
  assert.deepEqual(slowestJobs(stats, 2).map((j) => j.name), ['b', 'c']);
});
