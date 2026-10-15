import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import {
  SorobanEvent,
  SorobanEventStatus,
} from './entities/soroban-event.entity';
import { IngestSorobanEventDto } from './dto/ingest-soroban-event.dto';
import {
  SorobanEventsService,
  SOROBAN_EVENTS_QUEUE,
  PROCESS_EVENT_JOB,
} from './soroban-events.service';
import { SorobanEventsDeadLetterService } from './soroban-events-dead-letter.service';
import { mapSorobanEvent } from './soroban-event-mapper';
import { CrowdfundSyncService } from '../crowdfund-sync/crowdfund-sync.service';
import { CrowdfundVaultProject } from '../crowdfund-sync/entities/crowdfund-vault-project.entity';

// Event types that are relevant to crowdfund vaults
const CROWDFUND_VAULT_EVENT_TYPES = [
  'contribution',
  'milestone_approved',
  'funds_withdrawn',
  'vault_created',
  'refund_initiated',
  'refund_completed',
] as const;

type CrowdfundVaultEventType = (typeof CROWDFUND_VAULT_EVENT_TYPES)[number];

/**
 * Interface for crowdfund vault event data extracted from raw payload
 */
interface CrowdfundVaultEventData {
  vaultAddress?: string;
  projectId?: string;
  contributor?: string;
  amount?: string;
  milestoneId?: string;
  milestoneIndex?: number;
  recipient?: string;
  reason?: string;
  refundWindowStart?: number;
  refundWindowEnd?: number;
}

@Processor(SOROBAN_EVENTS_QUEUE)
@Injectable()
export class SorobanEventsProcessor extends WorkerHost {
  private readonly logger = new Logger(SorobanEventsProcessor.name);

  constructor(
    @InjectRepository(SorobanEvent)
    private readonly eventRepo: Repository<SorobanEvent>,

    @InjectRepository(CrowdfundVaultProject)
    private readonly vaultProjectRepo: Repository<CrowdfundVaultProject>,

    private readonly sorobanEventsService: SorobanEventsService,
    private readonly dlqService: SorobanEventsDeadLetterService,
    private readonly crowdfundSyncService: CrowdfundSyncService,
  ) {
    super();
  }

  async process(job: Job<IngestSorobanEventDto>): Promise<void> {
    if (job.name !== PROCESS_EVENT_JOB) {
      this.logger.warn(`Unknown job name: ${job.name}`);
      return;
    }

    const { txHash, eventIndex, contractId, eventType, rawPayload } = job.data;

    // Cross-boundary idempotency check: the row may have been archived since it
    // was first ingested. Check both hot and archive tables.
    const existing = await this.sorobanEventsService.findOneByTxHashAndIndex(
      txHash,
      eventIndex,
    );

    // Skip if already processed successfully
    if (existing && existing.status !== SorobanEventStatus.FAILED) {
      this.logger.debug(
        { txHash, eventIndex, status: existing.status },
        'Soroban event already processed, skipping',
      );
      return;
    }

    // Map event to canonical type for consistent handling
    const mapping = mapSorobanEvent(eventType ?? null);

    // Create or update event record
    const event =
      existing instanceof SorobanEvent
        ? existing
        : this.eventRepo.create({
            txHash,
            eventIndex,
            contractId: contractId ?? null,
            eventType: eventType ?? null,
            canonicalType: mapping?.canonicalType ?? null,
            category: mapping?.category ?? null,
            rawPayload,
            ledgerSequence:
              (job.data as { ledgerSequence?: number }).ledgerSequence ?? null,
            status: SorobanEventStatus.PENDING,
            processedAt: null,
            errorMessage: null,
          });

    // Reset status for retry if this is a re-attempt of a failed event
    if (existing instanceof SorobanEvent) {
      event.status = SorobanEventStatus.PENDING;
      event.errorMessage = null;
    }

    await this.eventRepo.save(event);

    try {
      // Handle Project Registry events
      if (contractId === process.env.PROJECT_REGISTRY_CONTRACT_ID) {
        await this.handleProjectRegistryEvent(txHash, rawPayload);
      }

      // Handle Crowdfund Vault events
      if (this.isCrowdfundVaultEvent(eventType ?? null)) {
        await this.handleCrowdfundVaultEvent(
          txHash,
          eventIndex,
          contractId ?? null,
          rawPayload,
        );
      }

      event.status = SorobanEventStatus.PROCESSED;
      event.processedAt = new Date();

      // If this event was replayed from dead letter queue, mark it as successful
      await this.dlqService.markReplayed(txHash, eventIndex);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      event.status = SorobanEventStatus.FAILED;
      event.errorMessage = errorMessage;
      await this.eventRepo.save(event);
      throw err; // let BullMQ retry
    }

    await this.eventRepo.save(event);
    this.logger.log(
      { txHash, eventIndex, eventType },
      'Processed soroban event',
    );
  }

  // ---------------------------------------------------------------------------
  // Project Registry
  // ---------------------------------------------------------------------------

  /**
   * Handle Project Registry events.
   * Creates or updates project records from the registry contract.
   */
  private async handleProjectRegistryEvent(
    txHash: string,
    rawPayload: Record<string, unknown>,
  ): Promise<void> {
    const payloadData = rawPayload as Record<string, any>;

    const projectData = {
      projectId: String(payloadData?.projectId || ''),
      owner: String(payloadData?.owner || ''),
      name: String(payloadData?.name || ''),
      metadataCid: payloadData?.metadataCid
        ? String(payloadData.metadataCid)
        : undefined,
      ledgerSeq: Number(payloadData?.ledgerSeq || 0),
      txHash: String(txHash),
    };

    await this.sorobanEventsService.syncProjectRegistryEvent(projectData);
    this.logger.log(`Project Registry sync successful for tx ${txHash}`);
  }

  // ---------------------------------------------------------------------------
  // Crowdfund Vault
  // ---------------------------------------------------------------------------

  private isCrowdfundVaultEvent(eventType: string | null): boolean {
    if (!eventType) return false;
    return CROWDFUND_VAULT_EVENT_TYPES.includes(
      eventType as CrowdfundVaultEventType,
    );
  }

  /**
   * Handle Crowdfund Vault events.
   * Processes contributions, milestone approvals, refunds, etc.
   */
  private async handleCrowdfundVaultEvent(
    txHash: string,
    eventIndex: number,
    contractId: string | null,
    rawPayload: Record<string, unknown>,
  ): Promise<void> {
    if (!contractId) {
      this.logger.warn(
        { txHash, eventIndex },
        'Crowdfund vault event missing contractId',
      );
      return;
    }

    const eventData = this.extractCrowdfundEventData(rawPayload);
    if (!eventData.vaultAddress) {
      eventData.vaultAddress = contractId;
    }

    const vaultProject = await this.vaultProjectRepo.findOne({
      where: { vaultAddress: eventData.vaultAddress },
    });

    if (!vaultProject) {
      this.logger.debug(
        { vaultAddress: eventData.vaultAddress, txHash },
        'Vault not registered for syncing, skipping',
      );
      return;
    }

    if (!vaultProject.isActive) {
      vaultProject.isActive = true;
      await this.vaultProjectRepo.save(vaultProject);
    }

    const eventType = this.extractEventTypeFromPayload(rawPayload);

    switch (eventType) {
      case 'contribution':
        await this.handleContributionEvent(
          txHash,
          eventIndex,
          eventData,
          vaultProject,
        );
        break;
      case 'milestone_approved':
        await this.handleMilestoneApprovedEvent(
          txHash,
          eventIndex,
          eventData,
          vaultProject,
        );
        break;
      case 'funds_withdrawn':
        await this.handleFundsWithdrawnEvent(
          txHash,
          eventIndex,
          eventData,
          vaultProject,
        );
        break;
      case 'vault_created':
        await this.handleVaultCreatedEvent(
          txHash,
          eventIndex,
          eventData,
          vaultProject,
        );
        break;
      case 'refund_initiated':
      case 'refund_completed':
        await this.handleRefundEvent(
          txHash,
          eventIndex,
          eventType,
          eventData,
          vaultProject,
        );
        break;
      default:
        this.logger.debug(
          { txHash, eventIndex, eventType },
          'Unhandled crowdfund vault event type',
        );
    }

    this.logger.log(
      {
        txHash,
        eventIndex,
        eventType,
        vaultAddress: eventData.vaultAddress,
        projectId: vaultProject.projectId,
      },
      'Processed crowdfund vault event',
    );
  }

  private extractCrowdfundEventData(
    rawPayload: Record<string, unknown>,
  ): CrowdfundVaultEventData {
    const payload = rawPayload as Record<string, any>;
    const data: CrowdfundVaultEventData = {};

    if (payload.vaultAddress) {
      data.vaultAddress = String(payload.vaultAddress);
    } else if (payload.contractId) {
      data.vaultAddress = String(payload.contractId);
    } else if (payload.vault) {
      data.vaultAddress = String(payload.vault);
    }

    if (payload.projectId) data.projectId = String(payload.projectId);
    if (payload.contributor) data.contributor = String(payload.contributor);
    else if (payload.from) data.contributor = String(payload.from);
    if (payload.amount) data.amount = String(payload.amount);
    if (payload.milestoneId) data.milestoneId = String(payload.milestoneId);
    if (payload.milestoneIndex !== undefined)
      data.milestoneIndex = Number(payload.milestoneIndex);
    if (payload.recipient) data.recipient = String(payload.recipient);
    else if (payload.to) data.recipient = String(payload.to);
    if (payload.reason) data.reason = String(payload.reason);
    if (payload.refundWindowStart !== undefined)
      data.refundWindowStart = Number(payload.refundWindowStart);
    if (payload.refundWindowEnd !== undefined)
      data.refundWindowEnd = Number(payload.refundWindowEnd);

    return data;
  }

  private extractEventTypeFromPayload(
    rawPayload: Record<string, unknown>,
  ): string | null {
    const payload = rawPayload as Record<string, any>;
    if (payload.eventType) return String(payload.eventType);
    if (payload.type) return String(payload.type);
    if (payload.event) return String(payload.event);
    if (payload.method) return String(payload.method);
    return null;
  }

  private async handleContributionEvent(
    txHash: string,
    eventIndex: number,
    eventData: CrowdfundVaultEventData,
    vaultProject: CrowdfundVaultProject,
  ): Promise<void> {
    this.logger.debug(
      { txHash, eventIndex, vaultAddress: eventData.vaultAddress, contributor: eventData.contributor, amount: eventData.amount },
      'Processing contribution event',
    );
    await this.crowdfundSyncService.syncVault({ vaultAddress: vaultProject.vaultAddress });
  }

  private async handleMilestoneApprovedEvent(
    txHash: string,
    eventIndex: number,
    eventData: CrowdfundVaultEventData,
    vaultProject: CrowdfundVaultProject,
  ): Promise<void> {
    this.logger.debug(
      { txHash, eventIndex, vaultAddress: eventData.vaultAddress, milestoneId: eventData.milestoneId, milestoneIndex: eventData.milestoneIndex },
      'Processing milestone approval event',
    );
    await this.crowdfundSyncService.syncVault({ vaultAddress: vaultProject.vaultAddress });
  }

  private async handleFundsWithdrawnEvent(
    txHash: string,
    eventIndex: number,
    eventData: CrowdfundVaultEventData,
    vaultProject: CrowdfundVaultProject,
  ): Promise<void> {
    this.logger.debug(
      { txHash, eventIndex, vaultAddress: eventData.vaultAddress, recipient: eventData.recipient, amount: eventData.amount },
      'Processing funds withdrawal event',
    );
    await this.crowdfundSyncService.syncVault({ vaultAddress: vaultProject.vaultAddress });
  }

  private async handleVaultCreatedEvent(
    txHash: string,
    eventIndex: number,
    eventData: CrowdfundVaultEventData,
    vaultProject: CrowdfundVaultProject,
  ): Promise<void> {
    if (!vaultProject.isActive) {
      vaultProject.isActive = true;
      await this.vaultProjectRepo.save(vaultProject);
    }
    this.logger.debug(
      { txHash, eventIndex, vaultAddress: eventData.vaultAddress, projectId: vaultProject.projectId },
      'Processing vault created event',
    );
    await this.crowdfundSyncService.syncVault({ vaultAddress: vaultProject.vaultAddress, fromLedger: 0 });
  }

  private async handleRefundEvent(
    txHash: string,
    eventIndex: number,
    eventType: string,
    eventData: CrowdfundVaultEventData,
    vaultProject: CrowdfundVaultProject,
  ): Promise<void> {
    this.logger.debug(
      { txHash, eventIndex, eventType, vaultAddress: eventData.vaultAddress, refundWindowStart: eventData.refundWindowStart, refundWindowEnd: eventData.refundWindowEnd },
      'Processing refund event',
    );
    await this.crowdfundSyncService.syncVault({ vaultAddress: vaultProject.vaultAddress });
  }

  // ---------------------------------------------------------------------------
  // Dead Letter Queue
  // ---------------------------------------------------------------------------

  /**
   * When a job exhausts all BullMQ retries, move it to the dead letter queue
   * for manual inspection and replay.
   */
  @OnWorkerEvent('failed')
  async onJobFailed(
    job: Job<IngestSorobanEventDto>,
    err: Error,
  ): Promise<void> {
    if (job.name !== PROCESS_EVENT_JOB) return;

    const { txHash, eventIndex } = job.data;

    this.logger.warn(
      { txHash, eventIndex, attempts: job.attemptsMade, error: err.message },
      'Soroban event processing failed, moving to dead letter queue',
    );

    try {
      let event = await this.eventRepo.findOne({ where: { txHash, eventIndex } });

      if (!event) {
        this.logger.debug(
          { txHash, eventIndex },
          'Event record not found, creating minimal record for DLQ',
        );
        const mapping = mapSorobanEvent(job.data.eventType ?? null);
        event = this.eventRepo.create({
          txHash,
          eventIndex,
          contractId: job.data.contractId ?? null,
          eventType: job.data.eventType ?? null,
          canonicalType: mapping?.canonicalType ?? null,
          category: mapping?.category ?? null,
          rawPayload: job.data.rawPayload,
          ledgerSequence: job.data.ledgerSequence ?? null,
          status: SorobanEventStatus.FAILED,
          errorMessage: err.message,
        });
        await this.eventRepo.save(event);
      }

      await this.dlqService.moveToDeadLetter(event, err);
    } catch (dlqErr) {
      this.logger.error(
        {
          txHash,
          eventIndex,
          dlqError: dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
        },
        'Failed to move event to dead letter queue',
      );
    }
  }
}
