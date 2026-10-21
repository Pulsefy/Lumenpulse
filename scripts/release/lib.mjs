// Pure helpers for the release workflow (issue #1725): version arithmetic,
// merge-commit parsing, grouping changes by app, and changelog rendering. No
// git or network access here so everything is unit-testable.

/** Matches the product tag scheme: vMAJOR.MINOR.PATCH, optional -rc.N. */
export const TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/;

export function parseTag(tag) {
  const m = TAG_PATTERN.exec(tag);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), rc: m[4] ? Number(m[4]) : null };
}

/**
 * Next version after `currentTag` for a `bump` of major|minor|patch.
 * With no previous tag the first release is v0.1.0 (any bump).
 */
export function nextVersion(currentTag, bump) {
  if (!currentTag) return 'v0.1.0';
  const v = parseTag(currentTag);
  if (!v) throw new Error(`Not a release tag: ${currentTag}`);
  if (bump === 'major') return `v${v.major + 1}.0.0`;
  if (bump === 'minor') return `v${v.major}.${v.minor + 1}.0`;
  if (bump === 'patch') return `v${v.major}.${v.minor}.${v.patch + 1}`;
  throw new Error(`Unknown bump "${bump}" (expected major, minor or patch)`);
}

/** Highest stable release tag from a list (release candidates are ignored). */
export function latestTag(tags) {
  const stable = tags
    .map((t) => ({ tag: t, v: parseTag(t) }))
    .filter((x) => x.v && x.v.rc === null)
    .sort((a, b) => a.v.major - b.v.major || a.v.minor - b.v.minor || a.v.patch - b.v.patch);
  return stable.length ? stable[stable.length - 1].tag : null;
}

/**
 * Parses a GitHub merge commit subject/body into a pull request.
 *   "Merge pull request #1763 from user/branch" + body "feat(webapp): add ..."
 * Squash merges ("feat: add thing (#1763)") are understood too.
 */
export function parseMerge(subject, body = '') {
  let m = /^Merge pull request #(\d+) from \S+/.exec(subject);
  if (m) {
    const title = body.split('\n').map((l) => l.trim()).find(Boolean) || subject;
    return { number: Number(m[1]), title };
  }
  m = /^(.*) \(#(\d+)\)$/.exec(subject);
  if (m) return { number: Number(m[2]), title: m[1] };
  return null;
}

export const APP_ORDER = ['Backend', 'Webapp', 'Mobile', 'Data processing', 'Contracts', 'CI and tooling', 'Documentation', 'Other'];

/** Maps a changed file path to the app it belongs to. */
export function appForFile(file) {
  if (file.startsWith('apps/backend/')) return 'Backend';
  if (file.startsWith('apps/webapp/')) return 'Webapp';
  if (file.startsWith('apps/mobile/')) return 'Mobile';
  if (file.startsWith('apps/data-processing/')) return 'Data processing';
  if (file.startsWith('apps/onchain/')) return 'Contracts';
  if (file.startsWith('.github/') || file.startsWith('scripts/') || file.startsWith('monitoring/')) return 'CI and tooling';
  if (file.startsWith('docs/') || file.endsWith('.md')) return 'Documentation';
  return 'Other';
}

/** Apps touched by a set of files (a change can belong to several). */
export function appsForFiles(files) {
  const apps = new Set(files.map(appForFile));
  // A change that is only docs plus code is reported under the code, not docs.
  if (apps.size > 1) apps.delete('Documentation');
  if (apps.size > 1) apps.delete('Other');
  return [...apps];
}

/** changes: [{ number, title, files: string[] }] -> { App: [{number,title}] } */
export function groupByApp(changes) {
  const groups = {};
  for (const change of changes) {
    for (const app of appsForFiles(change.files.length ? change.files : ['README.md'])) {
      (groups[app] ??= []).push({ number: change.number, title: change.title });
    }
  }
  return groups;
}

export function renderChangelog({ version, date, previous, groups, repo = 'Pulsefy/Lumenpulse' }) {
  const lines = [`## ${version} - ${date}`, ''];
  if (previous) lines.push(`Changes since ${previous}: https://github.com/${repo}/compare/${previous}...${version}`, '');
  let any = false;
  for (const app of APP_ORDER) {
    const entries = groups[app];
    if (!entries?.length) continue;
    any = true;
    lines.push(`### ${app}`, '');
    for (const e of [...entries].sort((a, b) => a.number - b.number)) {
      lines.push(`- ${e.title} ([#${e.number}](https://github.com/${repo}/pull/${e.number}))`);
    }
    lines.push('');
  }
  if (!any) lines.push('No merged pull requests since the previous release.', '');
  return lines.join('\n');
}
