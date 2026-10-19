import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRIPT_PATH = path.resolve('scripts/audit-dependencies.mjs');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
}

test('audit scanner: passes when all high/critical findings are allowlisted', () => {
  const tmpDir = createTempDir();
  const mockAudit = {
    auditReportVersion: 2,
    vulnerabilities: {
      foo: {
        name: 'foo',
        severity: 'high',
        via: [
          {
            name: 'foo',
            severity: 'high',
            url: 'https://github.com/advisories/GHSA-1111-2222-3333',
            title: 'Test High Vulnerability',
            range: '<1.0.0'
          }
        ]
      },
      bar: {
        name: 'bar',
        severity: 'moderate',
        via: [
          {
            name: 'bar',
            severity: 'moderate',
            url: 'https://github.com/advisories/GHSA-4444-5555-6666',
            title: 'Test Moderate Vulnerability',
            range: '<2.0.0'
          }
        ]
      }
    }
  };

  const auditPath = path.join(tmpDir, 'audit.json');
  fs.writeFileSync(auditPath, JSON.stringify(mockAudit));

  const allowlist = {
    allowlist: [
      {
        id: 'GHSA-1111-2222-3333',
        package: 'foo',
        reason: 'Temporary exception for testing',
        expiresAt: '2099-01-01'
      }
    ]
  };
  const allowlistPath = path.join(tmpDir, 'allowlist.json');
  fs.writeFileSync(allowlistPath, JSON.stringify(allowlist));

  const result = spawnSync('node', [
    SCRIPT_PATH,
    '--json-input', auditPath,
    '--allowlist', allowlistPath
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, `Expected exit code 0, got ${result.status}\nStdout: ${result.stdout}\nStderr: ${result.stderr}`);
  assert.match(result.stdout, /ALLOWLISTED/);
  assert.match(result.stdout + result.stderr, /::warning/);
  assert.match(result.stdout, /Vulnerability audit passed cleanly/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('audit scanner: fails when high/critical finding is not allowlisted', () => {
  const tmpDir = createTempDir();
  const mockAudit = {
    auditReportVersion: 2,
    vulnerabilities: {
      foo: {
        name: 'foo',
        severity: 'high',
        via: [
          {
            name: 'foo',
            severity: 'high',
            url: 'https://github.com/advisories/GHSA-unallowlisted-1234',
            title: 'Unallowlisted High Vulnerability',
            range: '<1.0.0'
          }
        ]
      }
    }
  };

  const auditPath = path.join(tmpDir, 'audit.json');
  fs.writeFileSync(auditPath, JSON.stringify(mockAudit));

  const allowlistPath = path.join(tmpDir, 'allowlist.json');
  fs.writeFileSync(allowlistPath, JSON.stringify({ allowlist: [] }));

  const result = spawnSync('node', [
    SCRIPT_PATH,
    '--json-input', auditPath,
    '--allowlist', allowlistPath
  ], { encoding: 'utf8' });

  assert.equal(result.status, 1, `Expected exit code 1, got ${result.status}`);
  assert.match(result.stderr, /::error file=package-lock\.json::\[FAIL\] HIGH/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('audit scanner: fails when an allowlist entry has expired', () => {
  const tmpDir = createTempDir();
  const mockAudit = {
    auditReportVersion: 2,
    vulnerabilities: {
      foo: {
        name: 'foo',
        severity: 'critical',
        via: [
          {
            name: 'foo',
            severity: 'critical',
            url: 'https://github.com/advisories/GHSA-expired-9999',
            title: 'Critical Vulnerability with Expired Allowlist',
            range: '<1.0.0'
          }
        ]
      }
    }
  };

  const auditPath = path.join(tmpDir, 'audit.json');
  fs.writeFileSync(auditPath, JSON.stringify(mockAudit));

  const allowlist = {
    allowlist: [
      {
        id: 'GHSA-expired-9999',
        package: 'foo',
        reason: 'Expired exception',
        expiresAt: '2020-01-01'
      }
    ]
  };
  const allowlistPath = path.join(tmpDir, 'allowlist.json');
  fs.writeFileSync(allowlistPath, JSON.stringify(allowlist));

  const result = spawnSync('node', [
    SCRIPT_PATH,
    '--json-input', auditPath,
    '--allowlist', allowlistPath
  ], { encoding: 'utf8' });

  assert.equal(result.status, 1, `Expected exit code 1, got ${result.status}`);
  assert.match(result.stderr, /EXPIRED ALLOWLIST/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('audit scanner: warns on obsolete allowlist entry but does not fail if findings are clean', () => {
  const tmpDir = createTempDir();
  const mockAudit = {
    auditReportVersion: 2,
    vulnerabilities: {}
  };

  const auditPath = path.join(tmpDir, 'audit.json');
  fs.writeFileSync(auditPath, JSON.stringify(mockAudit));

  const allowlist = {
    allowlist: [
      {
        id: 'GHSA-obsolete-entry',
        package: 'old-pkg',
        reason: 'Was fixed in upstream',
        expiresAt: '2099-01-01'
      }
    ]
  };
  const allowlistPath = path.join(tmpDir, 'allowlist.json');
  fs.writeFileSync(allowlistPath, JSON.stringify(allowlist));

  const result = spawnSync('node', [
    SCRIPT_PATH,
    '--json-input', auditPath,
    '--allowlist', allowlistPath
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, `Expected exit code 0, got ${result.status}`);
  assert.match(result.stdout, /::notice/);
  assert.match(result.stdout, /may be obsolete/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
