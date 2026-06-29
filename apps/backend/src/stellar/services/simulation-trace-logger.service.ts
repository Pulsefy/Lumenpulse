import { Injectable, Logger } from '@nestjs/common';
import { rpc } from '@stellar/stellar-sdk';
import { config } from '../../lib/config';
import { randomUUID } from 'crypto';

export interface SimulationTraceContext {
  requestId?: string;
  contractId?: string;
  contractMethod?: string;
  network?: string;
}

@Injectable()
export class SimulationTraceLogger {
  private readonly logger = new Logger(SimulationTraceLogger.name);

  generateRequestId(): string {
    return randomUUID();
  }

  logFailedSimulation(
    simulation: rpc.Api.SimulateTransactionResponse,
    context: SimulationTraceContext,
  ): void {
    if (!config.soroban.simulationTraceLogging) {
      return;
    }

    const requestId = context.requestId || this.generateRequestId();
    
    const logData: any = {
      requestId,
      contractId: context.contractId,
      contractMethod: context.contractMethod,
      network: context.network || config.stellar.network,
      timestamp: new Date().toISOString(),
    };

    if (rpc.Api.isSimulationError(simulation)) {
      logData.simulationError = {
        error: simulation.error,
        events: simulation.events,
        latestLedger: simulation.latestLedger,
      };
    } else {
      logData.simulationResult = {
        latestLedger: simulation.latestLedger,
        events: simulation.events,
      };
    }

    if (config.soroban.simulationTraceLevel === 'detailed') {
      if (!rpc.Api.isSimulationError(simulation) && simulation.transactionData) {
        logData.simulationResult.transactionData = 'available';
      }
      if (!rpc.Api.isSimulationError(simulation) && simulation.minResourceFee) {
        logData.simulationResult.minResourceFee = simulation.minResourceFee;
      }
    }

    this.logger.error(
      `Contract simulation failed for ${context.contractMethod || 'unknown method'} on contract ${context.contractId || 'unknown contract'}`,
      JSON.stringify(logData, null, 2),
    );
  }

  logSimulationStart(context: SimulationTraceContext): string {
    const requestId = context.requestId || this.generateRequestId();
    
    if (config.soroban.simulationTraceLogging && config.soroban.simulationTraceLevel === 'detailed') {
      this.logger.debug(
        `Starting contract simulation: ${context.contractMethod || 'unknown method'} on contract ${context.contractId || 'unknown contract'}`,
        JSON.stringify({
          requestId,
          contractId: context.contractId,
          contractMethod: context.contractMethod,
          network: context.network || config.stellar.network,
        }, null, 2),
      );
    }

    return requestId;
  }
}
