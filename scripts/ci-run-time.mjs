#!/usr/bin/env node
// Collects CI run-time statistics from the GitHub Actions API and checks them
// against the budgets in .github/ci-budgets.json (issue #1724).
//
//   GITHUB_TOKEN=<token> node scripts/ci-run-time.mjs [options]
//
//   --repo owner/name      default: $GITHUB_REPOSITORY or Pulsefy/Lumenpulse
//   --limit N              successful runs sampled per workflow (default 30)
//   --budgets <file>       default .github/ci-budgets.json
//   --json <file>          write the machine-readable result (the baseline)
//   --markdown <file>      write the markdown report
//   --enforce              exit 1 when a budget is exceeded (default: warn only)
//
// Durations are wall-clock minutes between a job's started_at and
// completed_at, so queue time is excluded. Only successful runs are sampled:
// failed and cancelled runs end early and would understate the real cost.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// ── pure helpers (unit-tested) ───────────────────────────────────────────────

/** Nearest-rank percentile of an array of numbers. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function round1(n) {
  return n === null || n === undefined ? null : Math.round(n * 10) / 10;
}

export function summarize(values) {
  return {
    samples: values.length,
    p50: round1(percentile(values, 50)),
    p90: round1(percentile(values, 90)),
    max: round1(values.length ? Math.max(...values) : null),
  };
}

export function minutesBetween(start, end) {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms / 60000 : null;
}

/**
 * Compares measured p90 values with budgets.
 * budgets: { workflows: { "<file>": { p90Minutes } }, jobs: { "<file>/<job>": { p90Minutes } } }
 * Returns one finding per exceeded budget.
 */
export function evaluateBudgets(stats, budgets) {
  const findings = [];
  for (const [file, budget] of Object.entries(budgets.workflows ?? {})) {
    const measured = stats.workflows[file]?.p90;
    if (measured != null && measured > budget.p90Minutes) {
      findings.push({ scope: 'workflow', name: file, measured, budget: budget.p90Minutes });
    }
  }
  for (const [key, budget] of Object.entries(budgets.jobs ?? {})) {
    const measured = stats.jobs[key]?.p90;
    if (measured != null && measured > budget.p90Minutes) {
      findings.push({ scope: 'job', name: key, measured, budget: budget.p90Minutes });
    }
  }
  return findings;
}

export function slowestJobs(stats, count = 3) {
  return Object.entries(stats.jobs)
    .filter(([, s]) => s.p90 != null)
    .sort((a, b) => b[1].p90 - a[1].p90)
    .slice(0, count)
    .map(([name, s]) => ({ name, ...s }));
}

export function renderMarkdown(result, findings) {
  const lines = [];
  lines.push('## CI run time');
  lines.push('');
  lines.push(`Sampled ${result.sampledRuns} successful runs per workflow on ${result.collectedAt.slice(0, 10)}. Minutes, queue time excluded.`);
  lines.push('');
  lines.push('| Workflow | Samples | p50 | p90 | max |');
  lines.push('|---|---|---|---|---|');
  for (const [file, s] of Object.entries(result.workflows)) {
    lines.push(`| \`${file}\` | ${s.samples} | ${s.p50} | ${s.p90} | ${s.max} |`);
  }
  lines.push('');
  lines.push('| Job | Samples | p50 | p90 | max |');
  lines.push('|---|---|---|---|---|');
  for (const [key, s] of Object.entries(result.jobs)) {
    lines.push(`| \`${key}\` | ${s.samples} | ${s.p50} | ${s.p90} | ${s.max} |`);
  }
  lines.push('');
  lines.push('Slowest three jobs by p90: ' + slowestJobs(result).map((j) => `\`${j.name}\` (${j.p90} min)`).join(', ') + '.');
  lines.push('');
  if (findings.length === 0) {
    lines.push('All budgets respected.');
  } else {
    lines.push('### Budgets exceeded');
    for (const f of findings) {
      lines.push(`- ${f.scope} \`${f.name}\`: p90 ${f.measured} min > budget ${f.budget} min`);
    }
  }
  return lines.join('\n') + '\n';
}

// ── API collection ───────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
  };
  const repo = arg('--repo', process.env.GITHUB_REPOSITORY || 'Pulsefy/Lumenpulse');
  const limit = Number(arg('--limit', '30'));
  const budgetsFile = arg('--budgets', '.github/ci-budgets.json');
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    console.error('Set GITHUB_TOKEN (or GH_TOKEN) to a token with actions:read.');
    process.exit(2);
  }

  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'lumenpulse-ci-run-time',
  };
  const api = async (path, attempt = 0) => {
    const res = await fetch(`https://api.github.com${path}`, { headers });
    if ((res.status === 403 || res.status === 429) && attempt < 4) {
      await new Promise((r) => setTimeout(r, Number(res.headers.get('retry-after') || 10) * 1000));
      return api(path, attempt + 1);
    }
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  };

  const { workflows } = await api(`/repos/${repo}/actions/workflows?per_page=100`);
  // Skip workflows whose file no longer exists in this checkout (deleted
  // workflows stay listed by the API with their old runs).
  const tracked = workflows.filter(
    (w) => w.path.startsWith('.github/workflows/') && w.state === 'active' && fs.existsSync(w.path),
  );

  const workflowDurations = {};
  const jobDurations = {};

  for (const wf of tracked) {
    const file = wf.path.split('/').pop();
    const { workflow_runs: runs } = await api(
      `/repos/${repo}/actions/workflows/${wf.id}/runs?status=success&per_page=${Math.min(limit, 100)}`,
    );
    for (const run of runs.slice(0, limit)) {
      const wall = minutesBetween(run.run_started_at, run.updated_at);
      if (wall !== null) (workflowDurations[file] ??= []).push(wall);
      const { jobs } = await api(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`);
      for (const job of jobs) {
        if (job.conclusion !== 'success' || !job.completed_at) continue;
        const d = minutesBetween(job.started_at, job.completed_at);
        if (d !== null) (jobDurations[`${file}/${job.name}`] ??= []).push(d);
      }
    }
  }

  const result = {
    repo,
    collectedAt: new Date().toISOString(),
    sampledRuns: limit,
    workflows: Object.fromEntries(Object.entries(workflowDurations).map(([k, v]) => [k, summarize(v)])),
    jobs: Object.fromEntries(Object.entries(jobDurations).map(([k, v]) => [k, summarize(v)])),
  };

  const budgets = fs.existsSync(budgetsFile) ? JSON.parse(fs.readFileSync(budgetsFile, 'utf8')) : {};
  const findings = evaluateBudgets(result, budgets);
  const markdown = renderMarkdown(result, findings);

  const jsonOut = arg('--json', null);
  const mdOut = arg('--markdown', null);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2) + '\n');
  if (mdOut) fs.writeFileSync(mdOut, markdown);
  process.stdout.write(markdown);

  for (const f of findings) {
    console.log(`::warning title=CI budget exceeded::${f.scope} ${f.name} p90 ${f.measured} min exceeds the ${f.budget} min budget (docs/ci-run-time.md).`);
  }
  if (findings.length && args.includes('--enforce')) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
