import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobLockService } from '../scheduler/job-lock.service';
import { SorobanRpcClientService } from '../stellar/services/soroban-rpc-client.service';
import { CrowdfundVaultSyncService } from './crowdfund-vault-sync.service';
import { SorobanEventsService } from '../soroban-events/soroban-events.service';

const JOB_NAME = 'crowdfund-vault-sync-poll';
const LEDGER_BATCH = 50;

interface SorobanRpcEvent {
  ledger?: number;
  txHash?: string;
  event?: {
    contractId?: string;
    type?: string;
    body?: { v0?: { data?: unknown } };
  };
  id?: string;
  topic?: unknown[];
}

@Injectable()
export class CrowdfundVaultSyncScheduler {
  private readonly logger = new Logger(CrowdfundVaultSyncScheduler.name);

  constructor(
    private readonly vaultSync: CrowdfundVaultSyncService,
    private readonly sorobanEvents: SorobanEventsService,
    private readonly sorobanRpc: SorobanRpcClientService,
    private readonly jobLock: JobLockService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async pollVaultEvents(): Promise<void> {
    const contractId = this.vaultSync.getVaultContractId();
    if (!contractId) {
      return;
    }

    await this.jobLock.withLock(JOB_NAME, async () => {
      const lastLedger = await this.vaultSync.getCheckpoint(contractId);
      const startLedger = lastLedger > 0 ? lastLedger + 1 : 1;

      try {
        const response = await this.sorobanRpc.rawServer.getEvents({
          startLedger,
          filters: [{ type: 'contract', contractIds: [contractId] }],
          limit: LEDGER_BATCH,
        });

        const events = (response.events ?? []) as SorobanRpcEvent[];
        let maxLedger = lastLedger;

        for (let i = 0; i < events.length; i++) {
          const ev = events[i];
          const ledger = Number(ev.ledger ?? 0);
          if (ledger > maxLedger) {
            maxLedger = ledger;
          }

          const txHash = ev.txHash ?? ev.id ?? `unknown-${ledger}-${i}`;
          const eventType =
            typeof ev.event?.type === 'string' ? ev.event.type : 'unknown';
          const rawPayload = this.eventToPayload(ev, ledger);

          await this.sorobanEvents.ingest({
            txHash,
            eventIndex: i,
            contractId,
            eventType,
            rawPayload,
          });
        }

        if (maxLedger > lastLedger) {
          await this.vaultSync.setCheckpoint(contractId, maxLedger);
        }

        if (events.length > 0) {
          this.logger.log(
            `Queued ${events.length} crowdfund vault events from ledger ${String(startLedger ?? 'latest')}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Vault event poll failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }

  private eventToPayload(
    ev: SorobanRpcEvent,
    ledger: number,
  ): Record<string, unknown> {
    return {
      ledgerSeq: ledger,
      contractId: ev.event?.contractId,
      eventType: ev.event?.type,
      raw: ev,
    };
  }
}
