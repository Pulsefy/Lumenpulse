#!/usr/bin/env node
/*
 * Emergency Pause Drill — Testnet (automated)
 *
 * Implements docs/EMERGENCY_PAUSE_DRILL.md against Stellar testnet using the
 * `stellar` CLI. For each pause scope (Contribution, Payout, Governance):
 *   1. pause_scope
 *   2. assert is_paused(scope) === true and the other two scopes === false
 *   3. assert the scope's blocked operation(s) fail with the expected
 *      contract error code (19 = ContributionScopePaused,
 *                        20 = PayoutScopePaused,
 *                        21 = GovernanceScopePaused)
 *   4. assert an operation outside the scope still succeeds
 *   5. unpause_scope (always, even when an earlier step fails)
 *   6. assert is_paused(scope) === false and the previously blocked op now succeeds
 *
 * Emits a dated evidence record JSON.
 *
 * Prerequisites (see docs/EMERGENCY_PAUSE_DRILL.md):
 *   - `stellar` CLI installed with the `testnet` network configured.
 *   - A local key (default `testnet-admin`) whose public key is the
 *     matching-pool admin from apps/onchain/testnet-manifest.json.
 *   - A disposable active round with an eligible project on testnet; supply its
 *     identifiers via --state (see scripts/drill-state.example.json).
 *
 * Usage:
 *   node scripts/run-emergency-pause-drill.mjs \
 *     --state scripts/drill-state.example.json \
 *     [--contract <id>] [--admin-key <name>] [--network <name>] [--evidence <path>]
 *
 * Exit codes: 0 = drill passed; 1 = failure (the failing scope + operation are named).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const MANIFEST_PATH = join(REPO_ROOT, 'apps', 'onchain', 'testnet-manifest.json');

const EXPECTED_ERRORS = {
    Contribution: { code: 19, name: 'ContributionScopePaused' },
    Payout: { code: 20, name: 'PayoutScopePaused' },
    Governance: { code: 21, name: 'GovernanceScopePaused' },
};

const SCOPE_ORDER = ['Contribution', 'Payout', 'Governance'];

function die(message) {
    console.error(`❌ ${message}`);
    process.exit(1);
}

function nowIso() {
    return new Date().toISOString();
}

// Run an arbitrary command, capturing output regardless of exit code.
function run(cmd, args) {
    try {
        const stdout = execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
        return { ok: true, code: 0, stdout: String(stdout), stderr: '' };
    } catch (err) {
        return {
            ok: false,
            code: err.status != null ? Number(err.status) : 1,
            stdout: err.stdout != null ? String(err.stdout) : '',
            stderr: err.stderr != null ? String(err.stderr) : '',
        };
    }
}

function stellar(contractId, network, source, method, args = {}, includeAdmin = false) {
    const adminAddress = globalThis.__DRILL_ADMIN_ADDRESS__;
    const argv = ['contract', 'invoke', '--id', contractId, '--network', network];
    if (source) argv.push('--source', source);
    if (includeAdmin && adminAddress) argv.push('--admin', adminAddress);
    argv.push('--', method);
    for (const [key, value] of Object.entries(args)) {
        if (value === undefined || value === null) continue;
        argv.push(`--${key}`, String(value));
    }
    return run('stellar', argv);
}

function readBool(result) {
    return result.stdout.trim() === 'true';
}

function extractContractErrorCode(output) {
    const combined = (output.stdout || '') + '\n' + (output.stderr || '');
    const m = combined.match(/Error\(Contract,\s*#(\d+)\)/);
    return m ? Number(m[1]) : null;
}

function extractTxHash(output) {
    const combined = (output.stdout || '') + '\n' + (output.stderr || '');
    const m = combined.match(/\b[A-Z0-9]{56}\b/);
    return m ? m[0] : null;
}

function loadManifest() {
    if (!require('node:fs').existsSync(MANIFEST_PATH)) {
        die(`Manifest not found: ${MANIFEST_PATH}`);
    }
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--contract' || a === '--contract-id') args.contract = argv[++i];
        else if (a === '--admin-key') args.adminKey = argv[++i];
        else if (a === '--network') args.network = argv[++i];
        else if (a === '--state') args.state = argv[++i];
        else if (a === '--evidence') args.evidence = argv[++i];
        else if (a === '--dry-run') args.dryRun = true;
        else if (a === '--help' || a === '-h') {
            console.log(readFileSync(__filename, 'utf8').split('\n').slice(0, 46).join('\n'));
            process.exit(0);
        }
    }
    return args;
}

function buildMatrix(state, adminAddress) {
    const {
        round_id, project_id, token, contributor, amount,
        round_name, round_start, round_end,
    } = state;
    return [
        {
            scope: 'Contribution',
            blocked: [
                { method: 'record_contribution', args: { round: round_id, project: project_id, contributor, amount }, label: 'record_contribution' },
            ],
            outside: [
                { method: 'get_round', args: { round: round_id }, label: 'get_round (read-only)' },
                { method: 'get_pool_balance', args: { round: round_id }, label: 'get_pool_balance (read-only)' },
            ],
        },
        {
            scope: 'Payout',
            blocked: [
                { method: 'distribute_matching_funds', args: { round: round_id, owners: contributor }, label: 'distribute_matching_funds', admin: true },
            ],
            outside: [
                { method: 'record_contribution', args: { round: round_id, project: project_id, contributor, amount }, label: 'record_contribution' },
                { method: 'get_round', args: { round: round_id }, label: 'get_round (read-only)' },
            ],
        },
        {
            scope: 'Governance',
            blocked: [
                { method: 'create_round', args: { name: round_name, token, start: round_start, end: round_end }, label: 'create_round', admin: true },
            ],
            outside: [
                { method: 'record_contribution', args: { round: round_id, project: project_id, contributor, amount }, label: 'record_contribution' },
                { method: 'get_round', args: { round: round_id }, label: 'get_round (read-only)' },
            ],
        },
    ];
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const manifest = loadManifest();

    const network = args.network || manifest.network || 'testnet';
    const contractId = args.contract || manifest.contracts?.matching_pool?.id;
    const adminKey = args.adminKey || 'testnet-admin';
    const statePath = args.state;

    if (!contractId) die('No matching-pool contract ID: set --contract or apps/onchain/testnet-manifest.json contracts.matching_pool.id');
    if (!/^C[0-9A-Z]{55}$/.test(contractId)) die(`Invalid matching-pool contract ID: ${contractId}`);
    if (!statePath) die('Missing --state <path> (see scripts/drill-state.example.json).');

    // --- Prerequisite checks -----------------------------------------------
    const stellarCli = run('stellar', ['--version']);
    if (!stellarCli.ok) die('`stellar` CLI is not installed or not on PATH.');

    const keysOut = run('stellar', ['keys', 'ls']);
    if (!keysOut.ok || !keysOut.stdout.split(/\s+/).includes(adminKey)) {
        die(`Stellar key "${adminKey}" is not configured. Run: stellar keys add ${adminKey}`);
    }

    const networksOut = run('stellar', ['network', 'ls']);
    if (!networksOut.ok || !networksOut.stdout.split(/\s+/).includes(network)) {
        die(`Stellar network "${network}" is not configured.`);
    }

    const addrOut = run('stellar', ['keys', 'address', adminKey]);
    if (!addrOut.ok) die(`Could not resolve address for key "${adminKey}".`);
    const adminAddress = addrOut.stdout.trim();
    globalThis.__DRILL_ADMIN_ADDRESS__ = adminAddress;

    const manifestAdmin = manifest.admin_address;
    if (manifestAdmin && adminAddress !== manifestAdmin) {
        die(`Admin key "${adminKey}" resolves to ${adminAddress}, but manifest admin is ${manifestAdmin}. Confirm the key matches the deployment before changing pause state.`);
    }

    let state;
    try {
        state = JSON.parse(readFileSync(statePath, 'utf8'));
    } catch (err) {
        die(`Failed to read --state file "${statePath}": ${err.message}`);
    }

    const requiredStateFields = ['round_id', 'project_id', 'token', 'contributor', 'amount', 'round_name', 'round_start', 'round_end'];
    const missing = requiredStateFields.filter((f) => state[f] == null);
    if (missing.length > 0) die(`--state is missing required fields: ${missing.join(', ')}`);

    if (args.dryRun) {
        console.log(`[dry-run] Would run emergency pause drill against ${network} contract ${contractId} as ${adminKey} (${adminAddress})`);
        console.log(`[dry-run] Scopes: ${SCOPE_ORDER.join(', ')}`);
        console.log(`[dry-run] State: ${statePath}`);
        console.log('[dry-run] Prerequisites OK. Exiting without invoking.');
        return;
    }

    const startedAt = nowIso();
    const evidence = {
        drill: 'emergency-pause',
        contract_id: contractId,
        network,
        admin_key: adminKey,
        admin_address: adminAddress,
        started_at: startedAt,
        ended_at: null,
        scopes: [],
        overall_ok: true,
    };

    let overallOk = true;

    // --- Per-scope drill ----------------------------------------------------
    for (const scopeName of SCOPE_ORDER) {
        const expected = EXPECTED_ERRORS[scopeName];
        const scopeRecord = {
            scope: scopeName,
            expected_error_code: expected.code,
            error_name: expected.name,
            paused_at: null,
            unpaused_at: null,
            pause_tx: null,
            unpause_tx: null,
            pause_output: null,
            unpause_output: null,
            checks: [],
            post_unpause_blocked_ok: null,
            ok: false,
        };

        const recordCheck = (checkName, ok, output, error = null) => {
            scopeRecord.checks.push({ name: checkName, ok, output: output.stdout || output.stderr || '', error, tx_hash: extractTxHash(output) });
        };

        const matrix = buildMatrix(state, adminAddress);
        const entry = matrix.find((e) => e.scope === scopeName);

        // 1. Pause the scope.
        const pauseOut = stellar(contractId, network, adminKey, 'pause_scope', { admin: adminAddress, scope: scopeName }, true);
        scopeRecord.paused_at = nowIso();
        scopeRecord.pause_tx = extractTxHash(pauseOut);
        scopeRecord.pause_output = pauseOut.stdout || pauseOut.stderr;
        const pauseOk = pauseOut.ok;
        recordCheck('pause_scope', pauseOk, pauseOut, pauseOk ? null : `pause_scope failed for ${scopeName}: ${pauseOut.stderr || pauseOut.stdout}`);

        try {
            if (pauseOk) {
                // 2. Scope reports paused; the other two scopes do not.
                const isPausedOut = stellar(contractId, network, null, 'is_paused', { scope: scopeName }, false);
                const scopePaused = readBool(isPausedOut);
                recordCheck(`is_paused ${scopeName} === true`, scopePaused, isPausedOut, scopePaused ? null : `is_paused(${scopeName}) returned ${isPausedOut.stdout.trim()}, expected true`);

                for (const other of ['Contribution', 'Payout', 'Governance'].filter((s) => s !== scopeName)) {
                    const o = stellar(contractId, network, null, 'is_paused', { scope: other }, false);
                    const paused = readBool(o);
                    recordCheck(`is_paused ${other} === false`, !paused, o, paused ? `is_paused(${other}) returned true, expected false` : null);
                }

                // 3. Blocked operations fail with the expected scope-specific error.
                for (const op of entry.blocked) {
                    const opOut = stellar(contractId, network, adminKey, op.method, op.args, op.admin);
                    const code = extractContractErrorCode(opOut);
                    const correctlyBlocked = !opOut.ok && code === expected.code;
                    recordCheck(`blocked ${op.label} fails with #${expected.code}`, correctlyBlocked, opOut, correctlyBlocked ? null : `expected failure #${expected.code} (${expected.name}), got exit ${opOut.code}, diagnostic: ${opOut.stderr || opOut.stdout}`);
                }

                // 4. Operations outside the scope still succeed.
                for (const op of entry.outside) {
                    const opOut = stellar(contractId, network, adminKey, op.method, op.args, op.admin);
                    recordCheck(`outside ${op.label} succeeds`, opOut.ok, opOut, opOut.ok ? null : `expected success, got exit ${opOut.code}: ${opOut.stderr || opOut.stdout}`);
                }
            }
        } finally {
            // 5. Always unpause, even if an earlier verification failed.
            const unpauseOut = stellar(contractId, network, adminKey, 'unpause_scope', { admin: adminAddress, scope: scopeName }, true);
            scopeRecord.unpaused_at = nowIso();
            scopeRecord.unpause_tx = extractTxHash(unpauseOut);
            scopeRecord.unpause_output = unpauseOut.stdout || unpauseOut.stderr;
            recordCheck(`unpause_scope ${scopeName}`, unpauseOut.ok, unpauseOut, unpauseOut.ok ? null : `unpause_scope failed: ${unpauseOut.stderr || unpauseOut.stdout}`);

            // 6. Scope reports unpaused; the previously blocked op now succeeds.
            const afterOut = stellar(contractId, network, null, 'is_paused', { scope: scopeName }, false);
            const stillPaused = readBool(afterOut);
            recordCheck(`is_paused ${scopeName} === false after unpause`, !stillPaused, afterOut, stillPaused ? `is_paused(${scopeName}) still true after unpause` : null);

            const blocked = entry.blocked[0];
            const recoveryOut = stellar(contractId, network, adminKey, blocked.method, blocked.args, blocked.admin);
            scopeRecord.post_unpause_blocked_ok = recoveryOut.ok;
            recordCheck(`post-unpause ${blocked.label} succeeds`, recoveryOut.ok, recoveryOut, recoveryOut.ok ? null : `expected ${blocked.label} to succeed after unpause, got exit ${recoveryOut.code}: ${recoveryOut.stderr || recoveryOut.stdout}`);
        }

        scopeRecord.ok = scopeRecord.checks.every((c) => c.ok);
        if (!scopeRecord.ok) overallOk = false;
        evidence.scopes.push(scopeRecord);
    }

    evidence.ended_at = nowIso();
    evidence.overall_ok = overallOk;

    // --- Write dated evidence record ---------------------------------------
    const dateStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const evidenceDir = join(REPO_ROOT, 'drill-evidence');
    mkdirSync(evidenceDir, { recursive: true });
    const evidencePath = join(evidenceDir, `emergency-pause-drill-${dateStamp}.json`);
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');

    console.log(`\nEmergency pause drill ${overallOk ? 'PASSED' : 'FAILED'}.`);
    console.log(`Contract: ${contractId} (${network})`);
    console.log(`Admin: ${adminKey} (${adminAddress})`);
    console.log(`Evidence: ${evidencePath}`);
    for (const s of evidence.scopes) {
        console.log(`  ${s.scope}: ${s.ok ? 'OK' : 'FAILED'} (pause_tx=${s.pause_tx}, unpause_tx=${s.unpause_tx})`);
    }

    if (!overallOk) process.exit(1);
}

main().catch((err) => {
    console.error(`❌ Drill error: ${err.message}`);
    process.exit(1);
});
