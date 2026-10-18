#!/usr/bin/env node
/**
 * Dependency Vulnerability Scanner with Time-Limited Allowlist
 *
 * Scans dependencies using `npm audit --json`.
 * - Fails the build on High and Critical findings unless explicitly allowlisted.
 * - Warns on Moderate, Low, and Info findings.
 * - Enforces explicit, time-limited allowlist with stated technical reasons.
 * - Emits GitHub Actions error/warning annotations and summary markdown.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    allowlistPath: './audit-allowlist.json',
    failOn: ['high', 'critical'],
    warnOn: ['moderate', 'low', 'info'],
    jsonInputPath: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--allowlist' && args[i + 1]) {
      options.allowlistPath = args[++i];
    } else if (arg === '--fail-on' && args[i + 1]) {
      options.failOn = args[++i].toLowerCase().split(',').map(s => s.trim());
    } else if (arg === '--warn-on' && args[i + 1]) {
      options.warnOn = args[++i].toLowerCase().split(',').map(s => s.trim());
    } else if (arg === '--json-input' && args[i + 1]) {
      options.jsonInputPath = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node audit-dependencies.mjs [options]

Options:
  --allowlist <path>      Path to audit-allowlist.json (default: ./audit-allowlist.json)
  --fail-on <levels>      Comma-separated severities that fail the build (default: high,critical)
  --warn-on <levels>      Comma-separated severities that warn (default: moderate,low,info)
  --json-input <path>     Path to pre-generated npm audit JSON file (optional)
  --help, -h              Show this help message
`);
      process.exit(0);
    }
  }

  return options;
}

function loadAuditData(jsonInputPath) {
  if (jsonInputPath) {
    if (!fs.existsSync(jsonInputPath)) {
      console.error(`Error: Audit JSON file not found at ${jsonInputPath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(jsonInputPath, 'utf8');
    return JSON.parse(content);
  }

  console.log('Running npm audit --json in current working directory...');
  const result = spawnSync('npm', ['audit', '--json'], {
    shell: true,
    maxBuffer: 50 * 1024 * 1024,
    encoding: 'utf8',
  });

  if (!result.stdout || result.stdout.trim().length === 0) {
    if (result.stderr) {
      console.error('npm audit stderr:', result.stderr);
    }
    console.error('Error: npm audit produced no output.');
    process.exit(1);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (err) {
    console.error('Error parsing npm audit JSON output:', err.message);
    if (result.stderr) {
      console.error('npm audit stderr:', result.stderr);
    }
    process.exit(1);
  }
}

function loadAllowlist(allowlistPath) {
  const resolved = path.resolve(process.cwd(), allowlistPath);
  if (!fs.existsSync(resolved)) {
    return { allowlist: [], path: resolved, exists: false };
  }

  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (parsed.allowlist || []);
    return { allowlist: list, path: resolved, exists: true };
  } catch (err) {
    console.error(`Error reading allowlist at ${resolved}:`, err.message);
    process.exit(1);
  }
}

function normalizeAdvisoryId(item) {
  if (item.url) {
    const segments = item.url.split('/');
    const last = segments[segments.length - 1];
    if (last) return last;
  }
  if (item.source) return item.source.toString();
  return item.name;
}

function run() {
  const options = parseArgs();
  console.log('====================================================');
  console.log('       DEPENDENCY VULNERABILITY AUDIT SCANNER       ');
  console.log('====================================================');
  console.log(`Directory:   ${process.cwd()}`);
  console.log(`Allowlist:   ${options.allowlistPath}`);
  console.log(`Fail levels: ${options.failOn.join(', ')}`);
  console.log(`Warn levels: ${options.warnOn.join(', ')}`);
  console.log('----------------------------------------------------');

  const auditData = loadAuditData(options.jsonInputPath);
  const { allowlist, exists: allowlistExists } = loadAllowlist(options.allowlistPath);

  // Validate allowlist entries
  const now = new Date();
  const allowlistMap = new Map();
  for (const entry of allowlist) {
    if (!entry.id) {
      console.error('::error::Invalid allowlist entry missing "id":', JSON.stringify(entry));
      process.exit(1);
    }
    if (!entry.reason || typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      console.error(`::error::Allowlist entry for ${entry.id} is missing an explicit, stated "reason"`);
      process.exit(1);
    }
    if (!entry.expiresAt) {
      console.error(`::error::Allowlist entry for ${entry.id} is missing a time-limited "expiresAt" date`);
      process.exit(1);
    }

    const expiryDate = new Date(entry.expiresAt);
    if (isNaN(expiryDate.getTime())) {
      console.error(`::error::Allowlist entry for ${entry.id} has invalid "expiresAt" date: ${entry.expiresAt}`);
      process.exit(1);
    }

    const isExpired = now.getTime() > expiryDate.getTime();
    allowlistMap.set(entry.id, {
      ...entry,
      isExpired,
      used: false,
    });
  }

  // Extract all unique advisories
  const rawVulnerabilities = auditData.vulnerabilities || {};
  const uniqueAdvisories = new Map();

  for (const [pkgName, pkgInfo] of Object.entries(rawVulnerabilities)) {
    for (const viaItem of pkgInfo.via || []) {
      if (typeof viaItem === 'object') {
        const advId = normalizeAdvisoryId(viaItem);
        if (!uniqueAdvisories.has(advId)) {
          uniqueAdvisories.set(advId, {
            id: advId,
            name: viaItem.name || pkgName,
            severity: (viaItem.severity || pkgInfo.severity || 'high').toLowerCase(),
            title: viaItem.title || 'Unknown advisory',
            url: viaItem.url || '',
            range: viaItem.range || '',
            cwe: viaItem.cwe || [],
          });
        }
      }
    }
  }

  // Categorize findings
  const failedFindings = [];
  const allowlistedFindings = [];
  const expiredFindings = [];
  const warningFindings = [];

  for (const [advId, adv] of uniqueAdvisories.entries()) {
    const isFailSeverity = options.failOn.includes(adv.severity);
    const isWarnSeverity = options.warnOn.includes(adv.severity);
    const allowEntry = allowlistMap.get(advId);

    if (allowEntry) {
      allowEntry.used = true;
      if (allowEntry.isExpired) {
        expiredFindings.push({ adv, allowEntry });
        console.error(`::error file=${options.allowlistPath}::[EXPIRED ALLOWLIST] ${adv.severity.toUpperCase()}: ${adv.id} in ${adv.name} expired on ${allowEntry.expiresAt}. Reason: ${allowEntry.reason}`);
        if (isFailSeverity) {
          failedFindings.push({ adv, reason: `Allowlist entry expired on ${allowEntry.expiresAt}` });
        }
      } else {
        allowlistedFindings.push({ adv, allowEntry });
        console.log(`[ALLOWLISTED] ${adv.severity.toUpperCase()}: ${adv.id} in ${adv.name} (Expires: ${allowEntry.expiresAt}) - ${allowEntry.reason}`);
      }
    } else if (isFailSeverity) {
      failedFindings.push({ adv, reason: 'Un-allowlisted high/critical finding' });
      console.error(`::error file=package-lock.json::[FAIL] ${adv.severity.toUpperCase()}: ${adv.id} in ${adv.name} (${adv.range}) - ${adv.title} - ${adv.url}`);
    } else if (isWarnSeverity) {
      warningFindings.push(adv);
      console.warn(`::warning file=package-lock.json::[WARN] ${adv.severity.toUpperCase()}: ${adv.id} in ${adv.name} (${adv.range}) - ${adv.title}`);
    }
  }

  // Check for obsolete allowlist entries
  const obsoleteAllowlist = [];
  for (const [id, entry] of allowlistMap.entries()) {
    if (!entry.used) {
      obsoleteAllowlist.push(entry);
      console.log(`::notice file=${options.allowlistPath}::Allowlist entry ${id} (${entry.package || 'package'}) was not detected in audit. It may be obsolete and removable.`);
    }
  }

  // Summary Table
  console.log('\n====================================================');
  console.log('              VULNERABILITY AUDIT SUMMARY           ');
  console.log('====================================================');
  console.log(`Total Unique Advisories Detected:     ${uniqueAdvisories.size}`);
  console.log(`High/Critical (Failed / Actionable):  ${failedFindings.length}`);
  console.log(`High/Critical (Allowlisted & Active): ${allowlistedFindings.length}`);
  console.log(`Expired Allowlist Entries:           ${expiredFindings.length}`);
  console.log(`Warnings (Moderate / Low / Info):     ${warningFindings.length}`);
  console.log(`Obsolete Allowlist Entries:           ${obsoleteAllowlist.length}`);
  console.log('====================================================\n');

  // GitHub Actions Step Summary (if available)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const summaryMd = [
      '# Dependency Vulnerability Audit Report',
      '',
      `**Status:** ${failedFindings.length === 0 ? 'Passed :white_check_mark:' : 'Failed :x:'}`,
      '',
      '| Category | Count | Status |',
      '| --- | --- | --- |',
      `| Actionable High / Critical | ${failedFindings.length} | ${failedFindings.length === 0 ? 'Passed' : 'Failing'} |`,
      `| Allowlisted High / Critical | ${allowlistedFindings.length} | Active |`,
      `| Expired Allowlist Entries | ${expiredFindings.length} | ${expiredFindings.length === 0 ? 'None' : 'Action Required'} |`,
      `| Warnings (Moderate / Low / Info) | ${warningFindings.length} | Informational |`,
      `| Obsolete Allowlist Entries | ${obsoleteAllowlist.length} | Cleanup Candidate |`,
      '',
    ];

    if (failedFindings.length > 0) {
      summaryMd.push('### :x: Failed Findings');
      summaryMd.push('| Severity | Advisory ID | Package | Title | Issue |');
      summaryMd.push('| --- | --- | --- | --- | --- |');
      for (const item of failedFindings) {
        summaryMd.push(`| ${item.adv.severity.toUpperCase()} | [${item.adv.id}](${item.adv.url}) | \`${item.adv.name}\` | ${item.adv.title} | ${item.reason} |`);
      }
      summaryMd.push('');
    }

    if (allowlistedFindings.length > 0) {
      summaryMd.push('### :memo: Active Time-Limited Allowlist');
      summaryMd.push('| Severity | Advisory ID | Package | Expires At | Stated Reason |');
      summaryMd.push('| --- | --- | --- | --- | --- |');
      for (const item of allowlistedFindings) {
        summaryMd.push(`| ${item.adv.severity.toUpperCase()} | [${item.adv.id}](${item.adv.url}) | \`${item.adv.name}\` | ${item.allowEntry.expiresAt} | ${item.allowEntry.reason} |`);
      }
      summaryMd.push('');
    }

    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMd.join('\n'), 'utf8');
    } catch {
      // Ignore if step summary write fails
    }
  }

  if (failedFindings.length > 0) {
    console.error(`Build failed: ${failedFindings.length} un-allowlisted or expired high/critical vulnerability finding(s) detected.`);
    process.exit(1);
  }

  console.log('Vulnerability audit passed cleanly.');
  process.exit(0);
}

run();
