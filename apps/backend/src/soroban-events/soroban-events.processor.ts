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

    // Idempotency check: find existing event
    const existing = await this.eventRepo.findOneBy({ txHash, eventIndex });

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
      existing ??
      this.eventRepo.create({
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

    // Reset status for retry
    if (existing) {
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

      // Mark as processed
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

  /**
   * Handle Project Registry events
   * Creates or updates project records from the registry contract
   */
  private async handleProjectRegistryEvent(
    txHash: string,
    rawPayload: Record<string, unknown>,
  ): Promise<void> {
    // Cast rawPayload to any so we can access its nested properties safely
    const payloadData = rawPayload as Record<string, any>;

    const projectData = {
      projectId: String(payloadData?.projectId || ''),
      owner: String(payloadData?.owner || ''),
      name: String(payloadData?.name || ''),
      metadataCid: payloadData?.metadataCid
        ? String(payloadData.metadataCid)
        : undefined,
      // If ledgerSeq isn't in job.data, it should be in rawPayload.
      // Fallback to 0 if it's missing to satisfy the interface.
      ledgerSeq: Number(payloadData?.ledgerSeq || 0),
      txHash: String(txHash),
    };

    await this.sorobanEventsService.syncProjectRegistryEvent(projectData);
    this.logger.log(`Project Registry sync successful for tx ${txHash}`);
  }

  /**
   * Check if an event type is a crowdfund vault event
   */
  private isCrowdfundVaultEvent(eventType: string | null): boolean {
    if (!eventType) {
      return false;
    }
    return CROWDFUND_VAULT_EVENT_TYPES.includes(
      eventType as CrowdfundVaultEventType,
    );
  }

  /**
   * Handle Crowdfund Vault events
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

    // Extract event data from payload
    const eventData = this.extractCrowdfundEventData(rawPayload);

    if (!eventData.vaultAddress) {
      // Try to use contractId as vault address if not in payload
      eventData.vaultAddress = contractId;
    }

    // Check if this vault is registered for syncing
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

    // Register the vault if not already active
    if (!vaultProject.isActive) {
      vaultProject.isActive = true;
      await this.vaultProjectRepo.save(vaultProject);
    }

    // Extract event type from raw payload
    const eventType = this.extractEventTypeFromPayload(rawPayload);

    // Process based on event type
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

  /**
   * Extract event data from raw payload
   */
  private extractCrowdfundEventData(
    rawPayload: Record<string, unknown>,
  ): CrowdfundVaultEventData {
    const payload = rawPayload as Record<string, any>;
    const data: CrowdfundVaultEventData = {};

    // Extract common fields from various payload structures
    if (payload.vaultAddress) {
      data.vaultAddress = String(payload.vaultAddress);
    } else if (payload.contractId) {
      data.vaultAddress = String(payload.contractId);
    } else if (payload.vault) {
      data.vaultAddress = String(payload.vault);
    }

    if (payload.projectId) {
      data.projectId = String(payload.projectId);
    }

    if (payload.contributor) {
      data.contributor = String(payload.contributor);
    } else if (payload.from) {
      data.contributor = String(payload.from);
    }

    if (payload.amount) {
      data.amount = String(payload.amount);
    }

    if (payload.milestoneId) {
      data.milestoneId = String(payload.milestoneId);
    }

    if (payload.milestoneIndex !== undefined) {
      data.milestoneIndex = Number(payload.milestoneIndex);
    }

    if (payload.recipient) {
      data.recipient = String(payload.recipient);
    } else if (payload.to) {
      data.recipient = String(payload.to);
    }

    if (payload.reason) {
      data.reason = String(payload.reason);
    }

    if (payload.refundWindowStart !== undefined) {
      data.refundWindowStart = Number(payload.refundWindowStart);
    }

    if (payload.refundWindowEnd !== undefined) {
      data.refundWindowEnd = Number(payload.refundWindowEnd);
    }

    return data;
  }

  /**
   * Extract event type from raw payload
   */
  private extractEventTypeFromPayload(
    rawPayload: Record<string, unknown>,
  ): string | null {
    const payload = rawPayload as Record<string, any>;

    // Check for event type in various common fields
    if (payload.eventType) {
      return String(payload.eventType);
    }

    if (payload.type) {
      return String(payload.type);
    }

    if (payload.event) {
      return String(payload.event);
    }

    // Check if the payload has a method field indicating the event type
    if (payload.method) {
      return String(payload.method);
    }

    return null;
  }

  /**
   * Handle contribution event
   */
  private async handleContributionEvent(
    txHash: string,
    eventIndex: number,
    eventData: CrowdfundVaultEventData,
    vaultProject: CrowdfundVaultProject,
  ): Promise<void> {
    // In a real implementation, this would update contribution records
    this.logger.debug(
      {
        txHash,
        eventIndex,
        vaultAddress: eventData.vaultAddress,
        contributor: eventData.contributor,
        amount: eventData.amount,
      },
      'Processing contribution event',
    );

    // Trigger sync for this vault to ensure consistency
    // This will update the cursor and process any pending events
    await this.crowdfundSyncService.syncVault({
      vaultAddress: vaultProject.vaultAddress,
    });
  }

  /**
   * Handle milestone approved event
   */
  private async handleMilestoneApprovedEvent(
    txHash: string,
    eventIndex: number,
    eventData: CrowdfundVaultEventData,
    vaultProject: CrowdfundVaultProject,
  ): Promise<void> {
    // In a real implementation, this would update milestone status
    this.logger.debug(
      {
        txHash,
        eventIndex,
        vaultAddress: eventData.vaultAddress,
        milestoneId: eventData.milestoneId,
        milestoneIndex: eventData.milestoneIndex,
      },
      'Processing milestone approval event',
    );

    // Trigger sync for this vault
    await this.crowdfundSyncService.syncVault({
      vaultAddress: vaultProject.vaultAddress,
    });
  }

  /**
   * Handle funds withdrawn event
   */
  private async handleFundsWithdrawnEvent(
    txHash: string,
    eventIndex: number,
    eventData: CrowdfundVaultEventData,
    vaultProject: CrowdfundVaultProject,
  ): Promise<void> {
    // In a real implementation, this would track withdrawals
    this.logger.debug(
      {
        txHash,
        eventIndex,
        vaultAddress: eventData.vaultAddress,
        recipient: eventData.recipient,
        amount: eventData.amount,
        reason: eventData.reason,
      },
      'Processing funds withdrawal event',
    );

    // Trigger sync for this vault
    await this.crowdfundSyncService.syncVault({
      vaultAddress: vaultProject.vaultAddress,
    });
  }

  /**
   * Handle vault created event
   */
  private async handleVaultCreatedEvent(
    txHash: string,
    eventIndex: number,
    eventData: CrowdfundVaultEventData,
    vaultProject: CrowdfundVaultProject,
  ): Promise<void> {
    // Ensure the vault is active for syncing
    if (!vaultProject.isActive) {
      vaultProject.isActive = true;
      await this.vaultProjectRepo.save(vaultProject);
    }

    this.logger.debug(
      {
        txHash,
        eventIndex,
        vaultAddress: eventData.vaultAddress,
        projectId: vaultProject.projectId,
      },
      'Processing vault created event',
    );

    // Trigger initial sync for this vault
    await this.crowdfundSyncService.syncVault({
      vaultAddress: vaultProject.vaultAddress,
      fromLedger: 0, // Sync from genesis for this vault
    });
  }

  /**
   * Handle refund events
   */
  private async handleRefundEvent(
    txHash: string,
    eventIndex: number,
    eventType: string,
    eventData: CrowdfundVaultEventData,
    vaultProject: CrowdfundVaultProject,
  ): Promise<void> {
    // In a real implementation, this would track refund windows and claims
    this.logger.debug(
      {
        txHash,
        eventIndex,
        eventType,
        vaultAddress: eventData.vaultAddress,
        refundWindowStart: eventData.refundWindowStart,
        refundWindowEnd: eventData.refundWindowEnd,
      },
      'Processing refund event',
    );

    // Trigger sync for this vault
    await this.crowdfundSyncService.syncVault({
      vaultAddress: vaultProject.vaultAddress,
    });
  }

  /**
   * Handle job failures
   * When a job fails after exhausting all retries, move to dead letter queue
   * This ensures failed events are captured for manual inspection and replay
   */
  @OnWorkerEvent('failed')
  async onJobFailed(
    job: Job<IngestSorobanEventDto>,
    err: Error,
  ): Promise<void> {
    if (job.name !== PROCESS_EVENT_JOB) {
      return;
    }

    const { txHash, eventIndex } = job.data;

    this.logger.warn(
      {
        txHash,
        eventIndex,
        attempts: job.attemptsMade,
        error: err.message,
      },
      'Soroban event processing failed, moving to dead letter queue',
    );

    try {
      // Get or create the event record
      let event = await this.eventRepo.findOne({
        where: { txHash, eventIndex },
      });

      if (!event) {
        // Event record might not exist if failure occurred very early
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

      // Move to dead letter queue for inspection and manual replay
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
