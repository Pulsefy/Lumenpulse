import {
  Account,
  BASE_FEE,
  Contract,
  Networks,
  rpc,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  buildSimulationSummary,
  extractContractCallFromTransaction,
  sanitizeSimulationMessage,
} from './simulation-trace.util';

describe('simulation-trace.util', () => {
  const contractId = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';
  const sourceKey =
    'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

  function buildContractTx(method: string): ReturnType<TransactionBuilder['build']> {
    const account = new Account(sourceKey, '1');
    return new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(new Contract(contractId).call(method))
      .setTimeout(30)
      .build();
  }

  describe('extractContractCallFromTransaction', () => {
    it('reads contract id and method from invokeHostFunction operations', () => {
      const tx = buildContractTx('get_admin');
      expect(extractContractCallFromTransaction(tx)).toEqual({
        contract: contractId,
        method: 'get_admin',
      });
    });
  });

  describe('sanitizeSimulationMessage', () => {
    it('redacts messages that mention sensitive fields', () => {
      expect(
        sanitizeSimulationMessage('failed: invalid JWT in authorization payload'),
      ).toBe('[simulation error redacted]');
    });

    it('truncates very long diagnostic strings', () => {
      const long = 'x'.repeat(600);
      const sanitized = sanitizeSimulationMessage(long);
      expect(sanitized.endsWith('…[truncated]')).toBe(true);
      expect(sanitized.length).toBeLessThan(long.length);
    });
  });

  describe('buildSimulationSummary', () => {
    it('includes contract error codes and omits raw event payloads', () => {
      const simulation = {
        error: 'HostError: Error(Contract, #3)',
        latestLedger: 12345,
        diagnosticEvents: [
          {
            inSuccessfulContractCall: false,
            event: {
              contractId,
              type: 'contract',
              topics: ['error'],
              data: '010203040506070809',
            },
          },
        ],
        events: [
          {
            type: 'contract',
            contractId,
            topics: ['transfer'],
            data: 'deadbeef',
          },
        ],
      } as rpc.Api.SimulateTransactionResponse;

      const summary = buildSimulationSummary(simulation, 'summary');

      expect(summary.error).toContain('Error(Contract, #3)');
      expect(summary.contractErrorCode).toBe(3);
      expect(summary.latestLedger).toBe(12345);
      expect(summary.diagnosticEventCount).toBe(1);
      expect(summary.lastDiagnosticEvent).toMatchObject({
        contractId,
        data: '[omitted]',
      });
      expect(summary.eventCount).toBe(1);
      expect(summary.events).toBeUndefined();
    });

    it('includes expanded diagnostics in full detail mode', () => {
      const simulation = {
        error: 'HostError: Error(WasmVm, InvalidAction)',
        diagnosticEvents: [
          {
            inSuccessfulContractCall: false,
            event: {
              contractId,
              type: 'contract',
              topics: ['diagnostic'],
              data: '010203',
            },
          },
        ],
      } as rpc.Api.SimulateTransactionResponse;

      const summary = buildSimulationSummary(simulation, 'full');

      expect(Array.isArray(summary.diagnosticEvents)).toBe(true);
      expect(summary.diagnosticEvents).toHaveLength(1);
      expect(summary.diagnosticEvents).toEqual([
        expect.objectContaining({ data: '[omitted]' }),
      ]);
    });
  });
});
