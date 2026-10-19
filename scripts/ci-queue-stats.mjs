#!/usr/bin/env node
// Measures queue wait time and wasted-run time from the GitHub Actions API,
// for every workflow in the repository.
//
// Issue #1713 needs a before/after number for queue wait, and issue #1714
// needs the observed job durations that the `timeout-minutes` budgets are
// derived from. Both come out of the same two fields on a workflow run:
//
//   created_at      when the run was queued
//   run_started_at  when a runner picked it up
//   run_updated_at  when it reached a terminal state
//
// so this script is the single source for both numbers. Run it against `main`
// before and after the concurrency change and paste both outputs into the PR.
//
// Usage:
//   GITHUB_TOKEN=<token> node scripts/ci-queue-stats.mjs [--repo owner/name] [--limit 40]

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const repo = argValue('--repo', process.env.GITHUB_REPOSITORY || 'Pulsefy/Lumenpulse');
const limit = Number(argValue('--limit', '40'));
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

if (!token) {
  console.error('Set GITHUB_TOKEN (or GH_TOKEN) to a token with actions:read on the repository.');
  process.exit(1);
}

const headers = {
  accept: 'application/vnd.github+json',
  authorization: `Bearer ${token}`,
  'x-github-api-version': '2022-11-28',
  'user-agent': 'lumenpulse-ci-queue-stats',
};

async function api(path, attempt = 0) {
  const res = await fetch(`https://api.github.com${path}`, { headers });

  // Sampling every job of every run is a few hundred calls; back off rather
  // than fail half way through and lose the report.
  if ((res.status === 403 || res.status === 429) && attempt < 4) {
    const wait = Number(res.headers.get('retry-after') || 10) * 1000;
    process.stderr.write(`rate limited on ${path}; waiting ${wait / 1000}s\n`);
    await new Promise((resolve) => setTimeout(resolve, wait));
    return api(path, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`${path} -> ${res.status} ${res.statusText}`);
  }
  return res.json();
}

const minutes = (a, b) => (new Date(a).getTime() - new Date(b).getTime()) / 60000;

const quantile = (values, q) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(Math.floor(sorted.length * q), sorted.length - 1)];
};

const fmt = (n) => `${n.toFixed(1)} min`;

async function jobDurations(runId) {
  const jobs = await api(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`);
  return jobs.jobs
    .filter((j) => j.started_at && j.completed_at)
    .map((j) => ({ name: j.name, mins: minutes(j.completed_at, j.started_at) }));
}

async function main() {
  const { workflows } = await api(`/repos/${repo}/actions/workflows?per_page=100`);

  // Copilot, CodeQL and Dependency Graph are GitHub-managed and carry no
  // concurrency or timeout of ours, so they are excluded. GitHub also keeps
  // listing workflows whose file has since been deleted, so require the path
  // to still be a real file under .github/workflows/.
  const owned = workflows.filter((wf) => wf.path.startsWith('.github/workflows/'));

  const queueWaits = [];
  const wastedByWorkflow = new Map();
  const jobSamples = new Map();

  for (const wf of owned) {
    const { workflow_runs: runs } = await api(
      `/repos/${repo}/actions/workflows/${wf.id}/runs?per_page=${limit}`,
    );

    const completed = runs.filter(
      (r) => r.status === 'completed' && r.run_started_at && r.created_at,
    );

    // A pull-request run is superseded as soon as a newer run exists on the
    // same head branch. Everything from that point on -- queue wait included --
    // is spent producing a result nobody will read.
    const newestPrRunByBranch = new Map();
    for (const run of completed) {
      if (run.event !== 'pull_request') continue;
      const seen = newestPrRunByBranch.get(run.head_branch);
      if (!seen || new Date(run.created_at) > new Date(seen.created_at)) {
        newestPrRunByBranch.set(run.head_branch, run);
      }
    }

    for (const run of completed) {
      queueWaits.push({
        workflow: wf.name,
        mins: minutes(run.run_started_at, run.created_at),
      });

      if (run.event === 'pull_request' && newestPrRunByBranch.get(run.head_branch)?.id !== run.id) {
        wastedByWorkflow.set(
          `${wf.name}:${run.head_branch}`,
          (wastedByWorkflow.get(`${wf.name}:${run.head_branch}`) || 0) +
            minutes(run.updated_at, run.run_started_at),
        );
      }
    }

    // Job durations back the `timeout-minutes` table in docs/ci-timeouts.md.
    for (const run of completed.slice(0, limit)) {
      for (const job of await jobDurations(run.id)) {
        if (!jobSamples.has(job.name)) jobSamples.set(job.name, []);
        jobSamples.get(job.name).push(job.mins);
      }
    }
  }

  const waits = queueWaits.map((w) => w.mins);
  const wasted = [...wastedByWorkflow.values()].reduce((a, b) => a + b, 0);

  console.log(`# CI queue and runtime report — ${repo}`);
  console.log(
    `# ${queueWaits.length} sampled completed runs across ${owned.length} workflows\n`,
  );

  console.log('## Queue wait (run_started_at - created_at)');
  console.log('| Metric | Value |');
  console.log('|---|---|');
  console.log(`| p50 | ${fmt(quantile(waits, 0.5))} |`);
  console.log(`| p90 | ${fmt(quantile(waits, 0.9))} |`);
  console.log(`| max | ${fmt(waits.length ? Math.max(...waits) : 0)} |`);
  console.log(`| total wasted on superseded PR runs | ${fmt(wasted)} |\n`);

  console.log('## Observed job runtime (backs docs/ci-timeouts.md)');
  console.log('| Job | Samples | p50 | p90 | max |');
  console.log('|---|---|---|---|---|');
  for (const [name, samples] of [...jobSamples.entries()].sort()) {
    console.log(
      `| ${name} | ${samples.length} | ${fmt(quantile(samples, 0.5))} | ` +
        `${fmt(quantile(samples, 0.9))} | ${fmt(Math.max(...samples))} |`,
    );
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});