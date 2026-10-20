// Soroban RPC client for the upgrade rehearsal (issue #1613). Everything that
// touches the network lives here; rehearsal.mjs drives it through this narrow
// interface so the orchestration can be tested against a fake chain.

import crypto from 'node:crypto';
import {
  Address,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  hash,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { CONTRACT_ERRORS, TESTNET_PASSPHRASE } from './lib.mjs';

const TX_TIMEOUT_SECONDS = 300;
const BASE_FEE = '1000000';

/** JSON-safe rendering of decoded ScVals (bigints and byte buffers). */
export function plain(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (typeof v === 'bigint') return v.toString();
      if (v && v.type === 'Buffer' && Array.isArray(v.data)) return Buffer.from(v.data).toString('hex');
      return v;
    }),
  );
}

export async function createChain({ rpcUrl, passphrase, adminSecret }) {
  if (passphrase !== TESTNET_PASSPHRASE) {
    throw new Error(`refusing to run: NETWORK_PASSPHRASE must be the testnet passphrase ("${TESTNET_PASSPHRASE}")`);
  }
  if (!adminSecret) throw new Error('ADMIN_SECRET (a testnet secret key) is required');
  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
  const network = await server.getNetwork();
  if (network.passphrase !== TESTNET_PASSPHRASE) {
    throw new Error(`refusing to run: ${rpcUrl} serves "${network.passphrase}", not testnet`);
  }
  const admin = Keypair.fromSecret(adminSecret);
  const adminAddress = admin.publicKey();

  const build = async (operation) =>
    new TransactionBuilder(await server.getAccount(adminAddress), { fee: BASE_FEE, networkPassphrase: passphrase })
      .addOperation(operation)
      .setTimeout(TX_TIMEOUT_SECONDS)
      .build();

  const invokeOp = (contractId, fn, args = []) => Operation.invokeContractFunction({ contract: contractId, function: fn, args });

  async function ledgerCloseTime(sequence) {
    const { ledgers } = await server.getLedgers({ startLedger: sequence, pagination: { limit: 1 } });
    if (!ledgers.length) throw new Error(`ledger ${sequence} not available from RPC`);
    return Number(ledgers[0].ledgerCloseTime);
  }

  /** Read-only call via simulation. Returns { ok, value | error, ledger, ledgerTime }. */
  async function simulate(contractId, fn, args = []) {
    const sim = await server.simulateTransaction(await build(invokeOp(contractId, fn, args)));
    const ledgerTime = await ledgerCloseTime(sim.latestLedger);
    if (rpc.Api.isSimulationError(sim)) return { ok: false, error: sim.error, ledger: sim.latestLedger, ledgerTime };
    return { ok: true, value: plain(scValToNative(sim.result.retval)), ledger: sim.latestLedger, ledgerTime };
  }

  async function read(contractId, fn, args = []) {
    const result = await simulate(contractId, fn, args);
    if (!result.ok) throw new Error(`${fn} failed: ${result.error}`);
    return result.value;
  }

  /**
   * Signs and sends `operation`. `onSubmitted(hash)` runs as soon as the
   * network accepts the transaction and before waiting for it, so a crash
   * after submission can resume by polling instead of resubmitting.
   */
  async function submit(operation, onSubmitted) {
    const tx = await server.prepareTransaction(await build(operation));
    tx.sign(admin);
    const sent = await server.sendTransaction(tx);
    if (sent.status === 'ERROR' || sent.status === 'TRY_AGAIN_LATER') {
      throw new Error(`transaction rejected (${sent.status}): ${sent.errorResult?.toXDR('base64') ?? 'no result'}`);
    }
    await onSubmitted?.(sent.hash);
    return awaitTransaction(sent.hash);
  }

  async function awaitTransaction(txHash) {
    const result = await server.pollTransaction(txHash, { attempts: 60, sleepStrategy: () => 2000 });
    if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(`transaction ${txHash} ended ${result.status}`);
    }
    const events = (result.events?.contractEventsXdr ?? []).flat().map((event) => {
      const body = event.body().v0();
      return { topics: plain(body.topics().map((t) => scValToNative(t))), data: plain(scValToNative(body.data())) };
    });
    return {
      hash: txHash,
      ledger: result.ledger,
      ledgerTime: Number(result.createdAt),
      returnValue: result.returnValue ? plain(scValToNative(result.returnValue)) : null,
      events,
    };
  }

  async function ledgerEntryExists(key) {
    const { entries } = await server.getLedgerEntries(key);
    return entries.length > 0 ? entries[0] : null;
  }

  const instanceKey = (contractId) =>
    xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: new Address(contractId).toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );

  const upgradeAction = (wasmHashHex) =>
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Upgrade'), xdr.ScVal.scvBytes(Buffer.from(wasmHashHex, 'hex'))]);
  const adminArg = () => new Address(adminAddress).toScVal();
  const u32 = (n) => xdr.ScVal.scvU32(n);

  return {
    adminAddress,

    async wasmInstalled(wasmHashHex) {
      const key = xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: Buffer.from(wasmHashHex, 'hex') }));
      return Boolean(await ledgerEntryExists(key));
    },

    async uploadWasm(wasm, onSubmitted) {
      const tx = await submit(Operation.uploadContractWasm({ wasm }), onSubmitted);
      return { ...tx, wasmHash: crypto.createHash('sha256').update(wasm).digest('hex') };
    },

    /** Deterministic contract ID for (admin, salt): lets a re-run find its own instance. */
    contractIdFor(salt) {
      const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
        new xdr.HashIdPreimageContractId({
          networkId: hash(Buffer.from(passphrase)),
          contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
            new xdr.ContractIdPreimageFromAddress({ address: new Address(adminAddress).toScAddress(), salt }),
          ),
        }),
      );
      return StrKey.encodeContract(hash(preimage.toXDR()));
    },

    async contractExists(contractId) {
      return Boolean(await ledgerEntryExists(instanceKey(contractId)));
    },

    async createContract(wasmHashHex, salt, onSubmitted) {
      const op = Operation.createCustomContract({ address: new Address(adminAddress), wasmHash: Buffer.from(wasmHashHex, 'hex'), salt });
      return submit(op, onSubmitted);
    },

    /** The WASM hash the contract instance currently executes, read from the ledger. */
    async currentWasmHash(contractId) {
      const entry = await ledgerEntryExists(instanceKey(contractId));
      if (!entry) throw new Error(`contract ${contractId} not found on the network`);
      const executable = entry.val.contractData().val().instance().executable();
      return Buffer.from(executable.wasmHash()).toString('hex');
    },

    async isInitialized(contractId) {
      return (await simulate(contractId, 'get_admin')).ok;
    },

    init: (contractId, onSubmitted) => submit(invokeOp(contractId, 'init', [adminArg()]), onSubmitted),
    increment: (contractId, onSubmitted) => submit(invokeOp(contractId, 'increment'), onSubmitted),

    /** Read-only state used to prove an upgrade or rollback preserved storage. */
    async snapshot(contractId) {
      const [admin, count, version, contractVersion] = await Promise.all([
        read(contractId, 'get_admin'),
        read(contractId, 'get_count'),
        read(contractId, 'version'),
        read(contractId, 'contract_version'),
      ]);
      return { wasm_hash: await this.currentWasmHash(contractId), admin, count, version, contract_version: contractVersion };
    },

    queueUpgrade: (contractId, wasmHashHex, onSubmitted) =>
      submit(invokeOp(contractId, 'queue_operation', [adminArg(), upgradeAction(wasmHashHex)]), onSubmitted),

    getOperation: (contractId, id) => read(contractId, 'get_operation', [u32(id)]),

    async operationStatus(contractId, id) {
      const result = await simulate(contractId, 'get_operation_status', [u32(id)]);
      if (!result.ok) throw new Error(`get_operation_status failed: ${result.error}`);
      return { status: Array.isArray(result.value) ? result.value[0] : result.value, ledger: result.ledger, ledgerTime: result.ledgerTime };
    },

    /** Simulates execute_operation; used to prove the timelock rejects early execution. */
    async simulateExecute(contractId, id) {
      const result = await simulate(contractId, 'execute_operation', [adminArg(), u32(id)]);
      const notReady = !result.ok && result.error.includes(`Error(Contract, #${CONTRACT_ERRORS.OperationNotReady})`);
      return { ...result, notReady };
    },

    execute: (contractId, id, onSubmitted) =>
      submit(invokeOp(contractId, 'execute_operation', [adminArg(), u32(id)]), onSubmitted),

    awaitTransaction,
  };
}
