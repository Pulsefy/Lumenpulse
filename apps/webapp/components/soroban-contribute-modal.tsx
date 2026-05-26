"use client";

import { useState } from "react";
import { 
  X, 
  Wallet, 
  HelpCircle, 
  ArrowRight, 
  Loader2, 
  CheckCircle, 
  AlertTriangle,
  ExternalLink,
  ChevronDown,
  Info
} from "lucide-react";
import { useStellarWallet } from "@/app/providers";
import {
  TransactionBuilder,
  rpc,
  Address,
  Networks,
  StrKey,
  nativeToScVal,
  Operation,
} from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";

interface SorobanContributeModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
}

type TxStep = 
  | 'idle'
  | 'simulating'
  | 'signing'
  | 'submitting'
  | 'polling'
  | 'success'
  | 'error';

const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";

// Standard testnet crowdfund vault contract ID, overridable per deployment.
const DEFAULT_CROWDFUND_CONTRACT_ID =
  process.env.NEXT_PUBLIC_CROWDFUND_CONTRACT_ID ??
  "CA3D5KXM5WQD2SZ4CSNORTFD73VLIIGJ36YEZIJ4ZKND2AW6A2KGO5Z4";
const STROOPS_PER_XLM = BigInt(10000000);

function getErrorMessage(error: unknown, fallback: string): string {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return fallback;
}

function parseXlmToStroops(value: string): bigint {
  const trimmed = value.trim();
  const match = /^(\d+)(?:\.(\d{0,7})?)?$/.exec(trimmed);

  if (!match) {
    throw new Error("Enter a valid XLM amount with up to 7 decimal places.");
  }

  const whole = BigInt(match[1]);
  const fraction = (match[2] ?? "").padEnd(7, "0");
  const stroops = whole * STROOPS_PER_XLM + BigInt(fraction || "0");

  if (stroops <= BigInt(0)) {
    throw new Error("Please enter a valid amount greater than 0.");
  }

  return stroops;
}

export default function SorobanContributeModal({
  isOpen,
  onClose,
  projectId,
}: SorobanContributeModalProps) {
  const { publicKey, status, connect } = useStellarWallet();
  
  const [amount, setAmount] = useState("10");
  const [contractId, setContractId] = useState(DEFAULT_CROWDFUND_CONTRACT_ID);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [step, setStep] = useState<TxStep>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleContribute = async () => {
    if (!publicKey) {
      setErrorMsg("Please connect your Stellar wallet first.");
      setStep('error');
      return;
    }

    let amountStroops: bigint;
    try {
      amountStroops = parseXlmToStroops(amount);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Please enter a valid amount greater than 0.");
      setStep('error');
      return;
    }

    const targetContractId = contractId.trim();

    if (!StrKey.isValidContract(targetContractId)) {
      setErrorMsg("Please enter a valid Soroban Contract ID (56 characters starting with 'C').");
      setStep('error');
      return;
    }

    setStep('simulating');
    setErrorMsg(null);
    setTxHash(null);

    try {
      // 1. Initialize RPC Server
      const rpcServer = new rpc.Server(SOROBAN_RPC_URL);

      // 2. Fetch the source account
      let sourceAccount;
      try {
        sourceAccount = await rpcServer.getAccount(publicKey);
      } catch (err) {
        throw new Error(
          "Failed to fetch account info from testnet. Please make sure your account is funded. You can fund it at: https://laboratory.stellar.org/#create-account"
        );
      }

      // 3. Build the contribution transaction
      const tx = new TransactionBuilder(sourceAccount, {
        fee: "1000",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.invokeContractFunction({
            contract: targetContractId,
            function: "deposit",
            args: [
              new Address(publicKey).toScVal(),
              nativeToScVal(BigInt(projectId), { type: "u64" }),
              nativeToScVal(amountStroops, { type: "i128" }),
            ],
          })
        )
        .setTimeout(30)
        .build();

      // 4. Simulate transaction
      const simulation = await rpcServer.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(simulation)) {
        throw new Error(`Simulation failed: ${simulation.error}`);
      }

      // Assemble the transaction with the simulated resources and footprints
      const assembledTx = rpc.assembleTransaction(tx, simulation).build();
      const txXdr = assembledTx.toXDR();

      // 5. Signing
      setStep('signing');
      let signedTxXdr: string;
      try {
        const signed = await signTransaction(txXdr, {
          address: publicKey,
          networkPassphrase: Networks.TESTNET,
        });

        if (signed.error || !signed.signedTxXdr) {
          throw new Error(
            getErrorMessage(
              signed.error,
              "Transaction signing rejected or failed in Freighter extension."
            )
          );
        }

        signedTxXdr = signed.signedTxXdr;
      } catch (err) {
        throw new Error(
          err instanceof Error
            ? err.message
            : "Transaction signing rejected or failed in Freighter extension."
        );
      }

      // 6. Submitting
      setStep('submitting');
      const transaction = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
      const submission = await rpcServer.sendTransaction(transaction);
      if (submission.hash) {
        setTxHash(submission.hash);
      }

      if (submission.status === "ERROR") {
        throw new Error(
          `Transaction submission failed: ${
            submission.errorResult?.toXDR("base64") ?? "network rejected the transaction"
          }`
        );
      }

      if (submission.status !== "PENDING" && submission.status !== "DUPLICATE") {
        throw new Error(`Transaction submission returned ${submission.status}. Please try again.`);
      }

      const hash = submission.hash;
      setTxHash(hash);

      // 7. Polling
      setStep('polling');
      let status = "PENDING";
      let retries = 0;
      const maxRetries = 20;

      while (status === "PENDING" && retries < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        retries++;
        
        const txResponse = await rpcServer.getTransaction(hash);
        if (txResponse.status === "SUCCESS") {
          status = "SUCCESS";
          setStep('success');
          break;
        } else if (txResponse.status === "FAILED") {
          throw new Error("Transaction failed in the ledger. Make sure the project is active and target is not exceeded.");
        }
      }

      if (status === "PENDING") {
        throw new Error("Transaction polling timed out. Please check the hash on StellarExpert.");
      }

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "An unexpected error occurred during contribution.");
      setStep('error');
    }
  };

  const isPending = ['simulating', 'signing', 'submitting', 'polling'].includes(step);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div 
        className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d0d0f] shadow-2xl overflow-hidden"
        style={{
          boxShadow: '0 0 0 1px rgba(219,116,207,0.15), 0 32px 64px -16px rgba(0,0,0,0.9), 0 0 48px rgba(219,116,207,0.08)'
        }}
      >
        {/* Glow Effects */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#db74cf]/[0.05] via-transparent to-primary/[0.05]" />
        
        {/* Header */}
        <div className="relative flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#db74cf] to-primary shadow-lg">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white leading-tight">
                Contribute via Soroban
              </h2>
              <p className="text-xs text-white/40 mt-0.5">
                Support Project #{projectId} with secure onchain testnet funding
              </p>
            </div>
          </div>
          <button
            onClick={isPending ? undefined : onClose}
            disabled={isPending}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/[0.08] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="px-6 py-6 space-y-6">
          
          {/* STEP: Idle / Input */}
          {step === 'idle' && (
            <div className="space-y-4">
              {/* Wallet connection check */}
              {status !== 'connected' ? (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex flex-col items-center text-center gap-3">
                  <AlertTriangle className="w-8 h-8 text-amber-400" />
                  <div>
                    <h4 className="text-sm font-semibold text-white">Wallet Disconnected</h4>
                    <p className="text-xs text-white/50 mt-1 max-w-sm">
                      You must connect your Stellar Freighter wallet to sign and submit this Soroban transaction.
                    </p>
                  </div>
                  <button
                    onClick={connect}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-500 text-black hover:bg-amber-400 transition-colors"
                  >
                    Connect Freighter Wallet
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 flex items-center justify-between text-xs">
                  <span className="text-white/50">Wallet Address</span>
                  <span className="font-mono text-emerald-400">
                    {publicKey?.slice(0, 6)}...{publicKey?.slice(-6)}
                  </span>
                </div>
              )}

              {/* Amount input */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/60 flex items-center justify-between">
                  <span>Contribution Amount (XLM)</span>
                  <span className="text-[10px] text-white/30">1 XLM = 10,000,000 Stroops</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    disabled={status !== 'connected'}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/20 focus:border-[#db74cf] focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    placeholder="Enter amount (e.g. 10)"
                  />
                  <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-xs text-white/40 font-semibold">
                    XLM
                  </div>
                </div>
              </div>

              {/* Advanced configuration / Contract ID */}
              <div className="border border-white/5 rounded-xl bg-white/[0.01]">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-white/50 hover:text-white transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    Advanced Contract Settings
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 transform transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                </button>
                
                {showAdvanced && (
                  <div className="px-4 pb-4 space-y-3 pt-1 border-t border-white/5">
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-white/40">Soroban Contract ID</label>
                      <input
                        type="text"
                        value={contractId}
                        onChange={(e) => setContractId(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[11px] font-mono text-white/70 placeholder-white/20 focus:border-[#db74cf] focus:outline-none transition-colors"
                        placeholder="Enter 56-character contract ID"
                      />
                    </div>
                    <div className="flex gap-2 p-2 rounded-lg bg-[#db74cf]/5 border border-[#db74cf]/10 text-[10px] text-white/60">
                      <Info className="w-3.5 h-3.5 text-[#db74cf] flex-shrink-0 mt-0.5" />
                      <p className="leading-relaxed">
                        Calling <code>deposit(user: Address, project_id: u64, amount: i128)</code> on the specified crowdfunding vault contract.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Submit button */}
              <button
                type="button"
                onClick={handleContribute}
                disabled={status !== 'connected' || parseFloat(amount) <= 0}
                className="w-full rounded-xl py-3 font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-300 bg-primary hover:bg-[#c05db4] disabled:opacity-50 disabled:cursor-not-allowed text-white shadow-lg"
              >
                Sign and Send Transaction
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* STEP: Loading States */}
          {isPending && (
            <div className="py-8 flex flex-col items-center justify-center text-center gap-4">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-white">
                  {step === 'simulating' && "Simulating transaction..."}
                  {step === 'signing' && "Awaiting signature..."}
                  {step === 'submitting' && "Submitting to testnet..."}
                  {step === 'polling' && "Verifying ledger confirmation..."}
                </h4>
                <p className="text-xs text-white/50 max-w-xs leading-relaxed">
                  {step === 'simulating' && "Retrieving transaction footprint and gas limits from Soroban RPC."}
                  {step === 'signing' && "Please open Freighter and approve the transaction signing request."}
                  {step === 'submitting' && "Broadcasting the signed Soroban envelope to the Stellar network."}
                  {step === 'polling' && "Polling Soroban RPC for ledger entry consensus updates."}
                </p>
              </div>

              {/* Progress step dots */}
              <div className="flex items-center gap-2 mt-2">
                <span className={`h-1.5 w-1.5 rounded-full ${step === 'simulating' ? 'bg-primary scale-125' : 'bg-white/20'}`} />
                <span className={`h-1.5 w-1.5 rounded-full ${step === 'signing' ? 'bg-primary scale-125' : 'bg-white/20'}`} />
                <span className={`h-1.5 w-1.5 rounded-full ${step === 'submitting' ? 'bg-primary scale-125' : 'bg-white/20'}`} />
                <span className={`h-1.5 w-1.5 rounded-full ${step === 'polling' ? 'bg-primary scale-125' : 'bg-white/20'}`} />
              </div>
            </div>
          )}

          {/* STEP: Success */}
          {step === 'success' && (
            <div className="py-6 flex flex-col items-center justify-center text-center gap-4">
              <CheckCircle className="w-12 h-12 text-emerald-400" />
              <div className="space-y-1">
                <h4 className="text-base font-bold text-white">Contribution Successful!</h4>
                <p className="text-xs text-white/50 max-w-sm mt-1 leading-relaxed">
                  Your donation of <span className="text-white font-bold">{amount} XLM</span> was successfully contributed onchain to Project #{projectId}.
                </p>
              </div>

              {/* Transaction receipt panel */}
              {txHash && (
                <div className="w-full rounded-xl border border-white/5 bg-white/[0.02] p-4 text-left space-y-2 mt-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-white/40">Status</span>
                    <span className="text-emerald-400 font-semibold">Confirmed</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/40">Project ID</span>
                    <span className="text-white font-medium">#{projectId}</span>
                  </div>
                  <div className="flex justify-between items-center gap-4">
                    <span className="text-white/40 flex-shrink-0">Transaction Hash</span>
                    <span className="text-white/80 font-mono truncate select-all">{txHash}</span>
                  </div>
                  <div className="pt-2 border-t border-white/5 mt-2 flex justify-center">
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[#db74cf] hover:text-white transition-colors"
                    >
                      View on StellarExpert
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-xl py-3 font-semibold text-sm bg-white/10 hover:bg-white/20 text-white mt-4 transition-colors"
              >
                Close Window
              </button>
            </div>
          )}

          {/* STEP: Error */}
          {step === 'error' && (
            <div className="py-4 flex flex-col items-center justify-center text-center gap-4">
              <AlertTriangle className="w-12 h-12 text-red-400" />
              <div className="space-y-1">
                <h4 className="text-base font-bold text-white">Transaction Failed</h4>
                <p className="text-xs text-red-300 max-w-sm mt-1 leading-relaxed">
                  {errorMsg}
                </p>
              </div>

              {txHash && (
                <div className="w-full rounded-xl border border-white/5 bg-white/[0.02] p-3 text-left space-y-1 text-[11px] mt-2 font-mono">
                  <span className="text-white/40">Hash: </span>
                  <span className="text-white/70 select-all">{txHash}</span>
                </div>
              )}

              <div className="flex gap-3 w-full mt-4">
                <button
                  type="button"
                  onClick={() => setStep('idle')}
                  className="flex-1 rounded-xl py-2.5 font-semibold text-xs bg-primary hover:bg-[#c05db4] text-white transition-colors"
                >
                  Adjust Parameters & Retry
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl px-4 py-2.5 font-semibold text-xs bg-white/5 hover:bg-white/10 text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
