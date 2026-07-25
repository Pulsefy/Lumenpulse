import {
  FeeBumpTransaction,
  rpc,
  StrKey,
  Transaction,
  xdr,
} from '@stellar/stellar-sdk';
import { extractContractErrorCode } from './soroban-error.mapper';

export type SimulationTraceDetailLevel = 'summary' | 'full';

const MAX_ERROR_CHARS = 500;
const MAX_DIAGNOSTIC_EVENTS = 20;
const MAX_CONTRACT_EVENTS = 10;
const MAX_TOPICS = 8;

const SENSITIVE_VALUE_PATTERN =
  /(?:secret|password|authorization|signature|signedauth|seed phrase|jwt|bearer\s)/i;

/** Extract Soroban contract id and method from a built transaction envelope. */
export function extractContractCallFromTransaction(tx: Transaction): {
  contract: string | null;
  method: string | null;
} {
  try {
    const envelope = tx.toEnvelope();
    if (envelope.switch() !== xdr.EnvelopeType.envelopeTypeTx()) {
      return { contract: null, method: null };
    }

    const operations = envelope.v1().tx().operations();
    for (let i = 0; i < operations.length; i++) {
      const body = operations[i].body();
      if (body.switch() !== xdr.OperationType.invokeHostFunction()) {
        continue;
      }

      const hostFn = body.invokeHostFunctionOp().hostFunction();
      if (
        hostFn.switch() !==
        xdr.HostFunctionType.hostFunctionTypeInvokeContract()
      ) {
        continue;
      }

      const invoke = hostFn.invokeContract();
      const contract = StrKey.encodeContract(
        Buffer.from(invoke.contractAddress().contractId()),
      );
      const method = invoke.functionName().toString();
      return { contract, method };
    }
  } catch {
    return { contract: null, method: null };
  }

  return { contract: null, method: null };
}

export function extractContractCallTarget(
  tx: Parameters<rpc.Server['simulateTransaction']>[0],
): { contract: string | null; method: string | null } {
  if (tx instanceof Transaction) {
    return extractContractCallFromTransaction(tx);
  }
  if (tx instanceof FeeBumpTransaction) {
    const inner = tx.innerTransaction;
    if (inner instanceof Transaction) {
      return extractContractCallFromTransaction(inner);
    }
  }
  return { contract: null, method: null };
}

export function sanitizeSimulationMessage(message: string): string {
  const trimmed = message.trim();
  if (SENSITIVE_VALUE_PATTERN.test(trimmed)) {
    return '[simulation error redacted]';
  }
  if (trimmed.length <= MAX_ERROR_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_ERROR_CHARS)}…[truncated]`;
}

function sanitizeTopic(topic: unknown): string {
  if (typeof topic === 'string') {
    return sanitizeSimulationMessage(topic);
  }
  if (topic && typeof topic === 'object' && 'symbol' in topic) {
    const symbol = (topic as { symbol?: () => Buffer }).symbol?.();
    if (symbol) {
      return symbol.toString();
    }
  }
  return '[topic]';
}

function sanitizeDiagnosticEvent(entry: unknown): Record<string, unknown> {
  if (!entry || typeof entry !== 'object') {
    return { event: '[unparsed]' };
  }

  const record = entry as Record<string, unknown>;
  const event = record.event;
  if (!event || typeof event !== 'object') {
    return {
      inSuccessfulContractCall: record.inSuccessfulContractCall,
    };
  }

  const eventRecord = event as Record<string, unknown>;
  const topics = Array.isArray(eventRecord.topics)
    ? eventRecord.topics.slice(0, MAX_TOPICS).map(sanitizeTopic)
    : undefined;

  return {
    inSuccessfulContractCall: record.inSuccessfulContractCall,
    contractId:
      typeof eventRecord.contractId === 'string'
        ? eventRecord.contractId
        : '[omitted]',
    type: eventRecord.type,
    topics,
    data: '[omitted]',
  };
}

function sanitizeContractEvent(entry: unknown): Record<string, unknown> {
  if (!entry || typeof entry !== 'object') {
    return { event: '[unparsed]' };
  }

  const record = entry as Record<string, unknown>;
  return {
    type: record.type,
    contractId:
      typeof record.contractId === 'string' ? record.contractId : '[omitted]',
    topics: Array.isArray(record.topics)
      ? record.topics.slice(0, MAX_TOPICS).map(sanitizeTopic)
      : undefined,
    data: '[omitted]',
  };
}

/** Build a structured, non-sensitive simulation summary for failed invocations. */
export function buildSimulationSummary(
  simulation: rpc.Api.SimulateTransactionResponse,
  detail: SimulationTraceDetailLevel,
): Record<string, unknown> {
  if (!rpc.Api.isSimulationError(simulation)) {
    return {};
  }

  const errorMessage = sanitizeSimulationMessage(
    simulation.error ?? 'Unknown simulation error',
  );
  const summary: Record<string, unknown> = {
    error: errorMessage,
  };

  const contractErrorCode = extractContractErrorCode(errorMessage);
  if (contractErrorCode !== null) {
    summary.contractErrorCode = contractErrorCode;
  }

  if ('latestLedger' in simulation && simulation.latestLedger !== undefined) {
    summary.latestLedger = simulation.latestLedger;
  }

  const diagnosticEvents =
    'diagnosticEvents' in simulation ? simulation.diagnosticEvents : undefined;
  if (Array.isArray(diagnosticEvents) && diagnosticEvents.length > 0) {
    summary.diagnosticEventCount = diagnosticEvents.length;
    if (detail === 'full') {
      summary.diagnosticEvents = diagnosticEvents
        .slice(0, MAX_DIAGNOSTIC_EVENTS)
        .map(sanitizeDiagnosticEvent);
    } else {
      summary.lastDiagnosticEvent = sanitizeDiagnosticEvent(
        diagnosticEvents[diagnosticEvents.length - 1],
      );
    }
  }

  const events = 'events' in simulation ? simulation.events : undefined;
  if (Array.isArray(events) && events.length > 0) {
    summary.eventCount = events.length;
    if (detail === 'full') {
      summary.events = events
        .slice(0, MAX_CONTRACT_EVENTS)
        .map(sanitizeContractEvent);
    }
  }

  if ('cost' in simulation && simulation.cost) {
    summary.cost = simulation.cost;
  }

  return summary;
}
