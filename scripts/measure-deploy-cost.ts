/**
 * measure-deploy-cost.ts
 *
 * Measures what it costs (in XLM) to deploy the Lumenpulse contract suite and
 * breaks the figure down per contract, for three builds of each contract:
 *   raw        — the cargo release WASM as built. With the pinned toolchain
 *                most of these are rejected by the network (reference-types);
 *                rejections are reported, not counted.
 *   baseline   — raw re-emitted with MVP features, no optimization passes.
 *                The cheapest build that is deployable without optimizing.
 *   optimized  — binaryen -Oz output from optimize-wasm.mjs; what deploy.ts
 *                uploads. The reported saving is baseline -> optimized.
 *
 * Deploying one contract is two transactions:
 *   1. upload  — UploadContractWasm, creates the code ledger entry. Cost scales
 *                with WASM size (write bytes, transaction size, rent).
 *   2. create  — CreateContract, creates the instance ledger entry.
 * Initialization is not included: it is an ordinary contract call whose cost
 * depends on the arguments and on the state each contract writes.
 *
 * Modes:
 *   simulate (default) — simulates every upload against Soroban RPC with a
 *       throwaway, unfunded source account. Needs no secrets and spends
 *       nothing. Create cannot be simulated because the code entry does not
 *       exist on-chain yet, so it is reported as n/a.
 *   --execute — actually uploads and instantiates each WASM and records the
 *       fee charged by the network. On testnet the source account is a fresh
 *       friendbot-funded key unless ADMIN_SECRET is set. Never use this on
 *       mainnet unless you intend to pay for the deployment.
 *
 * Usage (from repo root):
 *   cargo build --manifest-path apps/onchain/Cargo.toml --target wasm32-unknown-unknown --release
 *   npm run --prefix scripts wasm:optimize -- --baseline
 *   npm run --prefix scripts deploy:cost                      # simulate
 *   npm run --prefix scripts deploy:cost -- --execute         # real testnet fees
 *   npm run --prefix scripts deploy:cost -- --json ../apps/onchain/deploy-cost-baseline.json
 *
 * Flags:
 *   --execute             Submit transactions instead of simulating.
 *   --artifacts <list>    Comma-separated subset of raw,baseline,optimized (default: all three).
 *   --all                 Measure every built contract, not just the deployed suite.
 *   --json <path>         Also write the results as JSON (path relative to scripts/).
 *
 * Environment:
 *   SOROBAN_RPC_URL, NETWORK_PASSPHRASE, FRIENDBOT_URL, ADMIN_SECRET (optional)
 */

import {
    Account,
    Address,
    Keypair,
    Networks,
    Operation,
    TransactionBuilder,
    hash,
    rpc,
} from '@stellar/stellar-sdk';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { waitForTransaction } from './utils';

dotenv.config();

const STROOPS_PER_XLM = 10_000_000;
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const FRIENDBOT_URL = process.env.FRIENDBOT_URL || 'https://friendbot.stellar.org';
const INCLUSION_FEE = 100;

const ONCHAIN_ROOT = path.resolve(__dirname, '../apps/onchain');
const RELEASE_DIR = path.join(ONCHAIN_ROOT, 'target/wasm32-unknown-unknown/release');
const ARTIFACT_DIRS = {
    raw: RELEASE_DIR,
    baseline: path.join(RELEASE_DIR, 'baseline'),
    optimized: path.join(RELEASE_DIR, 'optimized'),
} as const;
type ArtifactKind = keyof typeof ARTIFACT_DIRS;
const ARTIFACT_LABELS: Record<ArtifactKind, string> = {
    raw: 'Raw release WASM (cargo output, as built)',
    baseline: 'Baseline: raw re-emitted with MVP features, unoptimized',
    optimized: 'Optimized: binaryen -Oz (what deploy.ts uploads)',
};

interface ContractCost {
    contract: string;
    artifact: ArtifactKind;
    wasmBytes: number;
    wasmHash: string;
    /** Stroops. Simulated minimum resource fee + inclusion fee, or fee charged when executed. */
    upload: number | null;
    create: number | null;
    /** Set when the network refuses the WASM; the row is then excluded from totals. */
    rejected?: string;
}

const argv = process.argv.slice(2);
const EXECUTE = argv.includes('--execute');
const ALL = argv.includes('--all');
const flagValue = (name: string) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
};
const kinds = (flagValue('--artifacts') ?? 'raw,baseline,optimized').split(',') as ArtifactKind[];
for (const kind of kinds) {
    if (!(kind in ARTIFACT_DIRS)) {
        console.error(`--artifacts accepts raw, baseline and optimized (got ${kind})`);
        process.exit(1);
    }
}
const jsonOut = flagValue('--json');

const server = new rpc.Server(SOROBAN_RPC_URL, { allowHttp: SOROBAN_RPC_URL.startsWith('http://') });

/** Contracts with a deployed id in testnet-manifest.json make up the suite. */
function suiteContracts(): string[] {
    if (ALL) {
        return fs
            .readdirSync(RELEASE_DIR)
            .filter((f) => f.endsWith('.wasm'))
            .map((f) => f.replace(/\.wasm$/, ''))
            .sort();
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(ONCHAIN_ROOT, 'testnet-manifest.json'), 'utf8'));
    return Object.entries<Record<string, unknown>>(manifest.contracts)
        .filter(([, entry]) => typeof entry.id === 'string')
        .map(([name]) => name)
        .sort();
}

const xlm = (stroops: number) => (stroops / STROOPS_PER_XLM).toFixed(4);

async function sourceKeypair(): Promise<Keypair> {
    if (process.env.ADMIN_SECRET) return Keypair.fromSecret(process.env.ADMIN_SECRET);
    const kp = Keypair.random();
    if (!EXECUTE) return kp;
    if (NETWORK_PASSPHRASE !== Networks.TESTNET && !process.env.FRIENDBOT_URL) {
        throw new Error('--execute outside testnet requires ADMIN_SECRET (or FRIENDBOT_URL for a local network)');
    }
    const res = await fetch(`${FRIENDBOT_URL}?addr=${kp.publicKey()}`);
    if (!res.ok) throw new Error(`Friendbot funding failed: ${res.status} ${await res.text()}`);
    return kp;
}

async function buildTx(source: Keypair, op: ReturnType<typeof Operation.uploadContractWasm>) {
    const account = EXECUTE
        ? await server.getAccount(source.publicKey())
        : new Account(source.publicKey(), '0');
    return new TransactionBuilder(account, { fee: String(INCLUSION_FEE), networkPassphrase: NETWORK_PASSPHRASE })
        .addOperation(op)
        .setTimeout(300)
        .build();
}

/** Simulates or submits a single-operation transaction and returns its cost in stroops. */
async function cost(source: Keypair, op: ReturnType<typeof Operation.uploadContractWasm>): Promise<number> {
    const tx = await buildTx(source, op);
    if (!EXECUTE) {
        const sim = await server.simulateTransaction(tx);
        if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
        return Number(sim.minResourceFee) + INCLUSION_FEE;
    }
    const prepared = await server.prepareTransaction(tx);
    prepared.sign(source);
    const sent = await server.sendTransaction(prepared);
    if (sent.status === 'ERROR') throw new Error(`Submission failed: ${JSON.stringify(sent.errorResult)}`);
    const result = await waitForTransaction(server, sent.hash);
    return Number(result.resultXdr.feeCharged().toBigInt());
}

async function measure(source: Keypair, contract: string, artifact: ArtifactKind): Promise<ContractCost> {
    const wasmPath = path.join(ARTIFACT_DIRS[artifact], `${contract}.wasm`);
    if (!fs.existsSync(wasmPath)) {
        const hint = artifact === 'raw' ? 'cargo build --target wasm32-unknown-unknown --release' : 'npm run --prefix scripts wasm:optimize -- --baseline';
        throw new Error(`Missing ${wasmPath}. Run ${hint} first.`);
    }
    const wasm = fs.readFileSync(wasmPath);
    const wasmHash = crypto.createHash('sha256').update(wasm).digest('hex');

    let upload: number;
    try {
        upload = await cost(source, Operation.uploadContractWasm({ wasm }));
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const reason = message.match(/message: "([^"]+)"/)?.[1] ?? message.split('\n')[0];
        return { contract, artifact, wasmBytes: wasm.length, wasmHash, upload: null, create: null, rejected: reason };
    }
    let create: number | null = null;
    if (EXECUTE) {
        create = await cost(
            source,
            Operation.createCustomContract({
                address: new Address(source.publicKey()),
                wasmHash: hash(wasm),
                salt: crypto.randomBytes(32),
            }),
        );
    }
    return { contract, artifact, wasmBytes: wasm.length, wasmHash, upload, create };
}

const rowCost = (r: ContractCost) => (r.upload ?? 0) + (r.create ?? 0);
const total = (rows: ContractCost[]) => rows.reduce((sum, r) => sum + rowCost(r), 0);

function render(results: ContractCost[]) {
    const lines: string[] = [];
    for (const kind of kinds) {
        const rows = results.filter((r) => r.artifact === kind).sort((a, b) => rowCost(b) - rowCost(a));
        const suiteTotal = total(rows);
        lines.push(`\n### ${ARTIFACT_LABELS[kind]}\n`);
        lines.push('| Contract | WASM size | Upload (XLM) | Create (XLM) | Total (XLM) | Share |');
        lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
        for (const r of rows) {
            if (r.rejected) {
                lines.push(`| ${r.contract} | ${r.wasmBytes.toLocaleString()} B | rejected | | | \`${r.rejected}\` |`);
                continue;
            }
            const rowTotal = rowCost(r);
            lines.push(
                `| ${r.contract} | ${r.wasmBytes.toLocaleString()} B | ${xlm(r.upload ?? 0)} | ${r.create === null ? 'n/a' : xlm(r.create)} | ${xlm(rowTotal)} | ${((rowTotal / suiteTotal) * 100).toFixed(1)}% |`,
            );
        }
        const bytes = rows.reduce((s, r) => s + r.wasmBytes, 0);
        const rejected = rows.filter((r) => r.rejected).length;
        const label = rejected ? `**Suite total** (${rejected} of ${rows.length} rejected, not counted)` : '**Suite total**';
        lines.push(`| ${label} | **${bytes.toLocaleString()} B** | | | **${xlm(suiteTotal)}** | 100% |`);
    }
    if (kinds.includes('baseline') && kinds.includes('optimized')) {
        const before = total(results.filter((r) => r.artifact === 'baseline'));
        const after = total(results.filter((r) => r.artifact === 'optimized'));
        lines.push(
            `\n**Saving from -Oz:** ${xlm(before - after)} XLM per suite deployment (${(((before - after) / before) * 100).toFixed(1)}%), ${xlm(before)} → ${xlm(after)} XLM.`,
        );
    }
    return lines.join('\n');
}

async function main() {
    const contracts = suiteContracts();
    const source = await sourceKeypair();
    const latest = await server.getLatestLedger();
    console.log(`Network: ${NETWORK_PASSPHRASE}`);
    console.log(`RPC: ${SOROBAN_RPC_URL} (ledger ${latest.sequence}, protocol ${latest.protocolVersion})`);
    console.log(`Mode: ${EXECUTE ? 'execute (real fees charged)' : 'simulate (upload only, nothing submitted)'}`);
    console.log(`Contracts: ${contracts.join(', ')}`);

    const results: ContractCost[] = [];
    for (const kind of kinds) {
        for (const contract of contracts) {
            process.stdout.write(`  measuring ${kind}/${contract}...`);
            const r = await measure(source, contract, kind);
            results.push(r);
            console.log(r.rejected ? ` rejected (${r.rejected})` : ` ${xlm(rowCost(r))} XLM`);
        }
    }

    console.log(render(results));

    if (jsonOut) {
        const out = {
            version: 1,
            measuredAt: new Date().toISOString(),
            network: NETWORK_PASSPHRASE,
            rpc: SOROBAN_RPC_URL,
            ledger: latest.sequence,
            protocolVersion: latest.protocolVersion,
            mode: EXECUTE ? 'execute' : 'simulate',
            unit: 'stroops',
            totals: Object.fromEntries(kinds.map((k) => [k, total(results.filter((r) => r.artifact === k))])),
            contracts: results,
        };
        const target = path.resolve(__dirname, jsonOut);
        fs.writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
        console.log(`\nWrote ${target}`);
    }
}

main().catch((err) => {
    console.error('\nDeployment cost measurement failed:', err instanceof Error ? err.message : err);
    process.exit(1);
});
