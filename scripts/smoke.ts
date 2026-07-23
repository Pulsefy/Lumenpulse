import * as fs from 'fs';
import * as path from 'path';
import { Address, Contract, Horizon, Networks, TransactionBuilder, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';

type Manifest = { network: string; rpc_url: string; admin_address: string; contracts: Record<string, { id: string }> };
type Check = { contract: string; method: string; args: xdr.ScVal[]; description: string };

const manifestPath = process.env.SMOKE_MANIFEST || path.resolve(__dirname, '../apps/onchain/testnet-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
const rpcUrl = process.env.SOROBAN_RPC_URL || manifest.rpc_url;
const passphrase = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const admin = process.env.SMOKE_ADMIN || manifest.admin_address;
const checksFor = (name: string, id: string): Check => {
  const address = new Address(admin).toScVal();
  const token = manifest.contracts.lumen_token?.id;
  const checks: Record<string, Check> = {
    contributor_registry: { contract: name, method: 'get_next_proposal_id', args: [], description: 'read next proposal id' },
    project_registry: { contract: name, method: 'get_config', args: [], description: 'read registry config' },
    crowdfund_vault: { contract: name, method: 'get_admin', args: [], description: 'read vault admin' },
    matching_pool: { contract: name, method: 'get_admin', args: [], description: 'read matching-pool admin' },
    treasury: { contract: name, method: 'get_admin', args: [], description: 'read treasury admin' },
    lumen_token: { contract: name, method: 'decimals', args: [], description: 'read token decimals' },
    pricing_adapter: { contract: name, method: 'get_asset_decimals', args: [token ? new Address(token).toScVal() : address], description: 'read configured asset decimals' },
  };
  if (!checks[name]) throw new Error(`No smoke check configured for manifest contract ${name}`);
  return checks[name];
};

async function run(check: Check, server: rpc.Server, source: Horizon.AccountResponse) {
  const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: passphrase })
    .addOperation(new Contract(manifest.contracts[check.contract].id).call(check.method, ...check.args))
    .setTimeout(30).build();
  const result = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(result)) throw new Error(result.error);
  if (!result.result) throw new Error('simulation returned no result');
  return scValToNative(result.result.retval);
}

async function main() {
  const server = new rpc.Server(rpcUrl);
  const horizon = new Horizon.Server(process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org');
  const source = await horizon.loadAccount(admin);
  const results: { contract: string; check: string; ok: boolean; value?: unknown; error?: string }[] = [];
  for (const [name, entry] of Object.entries(manifest.contracts)) {
    const check = checksFor(name, entry.id);
    try { results.push({ contract: name, check: check.method, ok: true, value: await run(check, server, source) }); }
    catch (error) { results.push({ contract: name, check: check.method, ok: false, error: error instanceof Error ? error.message : String(error) }); }
  }
  const output = { ok: results.every(r => r.ok), network: manifest.network, rpc_url: rpcUrl, checked_at: new Date().toISOString(), results };
  console.log(JSON.stringify(output, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
  if (!output.ok) process.exitCode = 1;
}

main().catch(error => { console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; });
