import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SorobanRpc, xdr } from '@stellar/stellar-sdk';
import { config } from '../lib/config';
import { VaultDepositEvent } from './entities/vault-deposit-event.entity';
import { VaultMilestoneEvent } from './entities/vault-milestone-event.entity';
import { VaultIndexerCursor } from './entities/vault-indexer-cursor.entity';

/** How many events to fetch per poll */
const PAGE_LIMIT = 100;

@Injectable()
export class VaultEventIndexer implements OnModuleInit {
  private readonly logger = new Logger(VaultEventIndexer.name);
  private rpc: SorobanRpc.Server | null = null;
  private contractId: string | null = null;

  constructor(
    @InjectRepository(VaultDepositEvent)
    private readonly depositRepo: Repository<VaultDepositEvent>,
    @InjectRepository(VaultMilestoneEvent)
    private readonly milestoneRepo: Repository<VaultMilestoneEvent>,
    @InjectRepository(VaultIndexerCursor)
    private readonly cursorRepo: Repository<VaultIndexerCursor>,
  ) {}

  onModuleInit() {
    const rpcUrl = config.stellar.sorobanRpcUrl;
    this.contractId = config.stellar.contracts.crowdfundVault;

    if (!rpcUrl || !this.contractId) {
      this.logger.warn(
        'VaultEventIndexer disabled: STELLAR_SOROBAN_RPC_URL or STELLAR_CONTRACT_CROWDFUND_VAULT not set',
      );
      return;
    }

    this.rpc = new SorobanRpc.Server(rpcUrl, { allowHttp: true });
    this.logger.log(
      `VaultEventIndexer initialised for contract ${this.contractId}`,
    );
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async poll(): Promise<void> {
    if (!this.rpc || !this.contractId) return;

    try {
      await this.ingestEvents();
    } catch (err) {
      this.logger.error(
        `Poll failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Core ingestion ──────────────────────────────────────────────────────────

  private async ingestEvents(): Promise<void> {
    const contractId = this.contractId!;
    const cursor = await this.loadCursor(contractId);

    const response = await this.rpc!.getEvents({
      filters: [
        {
          type: 'contract',
          contractIds: [contractId],
          topics: [
            // DepositEvent: topics[0]=symbol("DepositEvent"), topics[1]=user, topics[2]=project_id
            ['*', '*', '*'],
          ],
        },
      ],
      cursor: cursor ?? undefined,
      limit: PAGE_LIMIT,
    });

    if (!response.events || response.events.length === 0) return;

    let lastCursor: string | null = null;

    for (const event of response.events) {
      await this.processEvent(event);
      lastCursor = event.pagingToken;
    }

    if (lastCursor) {
      await this.saveCursor(contractId, lastCursor);
      this.logger.debug(
        `Ingested ${response.events.length} events, cursor=${lastCursor}`,
      );
    }
  }

  private async processEvent(
    event: SorobanRpc.Api.EventResponse,
  ): Promise<void> {
    const eventId = event.id;
    const ledger = event.ledger;
    const ledgerAt = new Date(event.ledgerClosedAt);
    const contractId = event.contractId;

    // topics[0] is always the event name symbol
    const topics = event.topic;
    if (!topics || topics.length === 0) return;

    const eventName = this.decodeSymbol(topics[0]);

    switch (eventName) {
      case 'DepositEvent':
        await this.handleDeposit(
          eventId,
          contractId,
          ledger,
          ledgerAt,
          topics,
          event.value,
        );
        break;
      case 'MilestoneApprovedEvent':
        await this.handleMilestoneApproved(
          eventId,
          contractId,
          ledger,
          ledgerAt,
          topics,
          event.value,
          false,
        );
        break;
      case 'MilestoneApprovedByVoteEvent':
        await this.handleMilestoneApprovedByVote(
          eventId,
          contractId,
          ledger,
          ledgerAt,
          topics,
          event.value,
        );
        break;
      default:
        // Ignore other events
        break;
    }
  }

  // ── Event handlers ──────────────────────────────────────────────────────────

  /**
   * DepositEvent topics: [symbol("DepositEvent"), user: Address, project_id: u64]
   * value: { amount: i128 }
   */
  private async handleDeposit(
    eventId: string,
    contractId: string,
    ledger: number,
    ledgerAt: Date,
    topics: xdr.ScVal[],
    value: xdr.ScVal,
  ): Promise<void> {
    if (topics.length < 3) return;

    const userAddress = this.decodeAddress(topics[1]);
    const projectId = this.decodeU64(topics[2]);
    const amount = this.decodeI128(value);

    if (!userAddress || projectId === null || amount === null) {
      this.logger.warn(`DepositEvent ${eventId}: failed to decode fields`);
      return;
    }

    await this.depositRepo
      .createQueryBuilder()
      .insert()
      .into(VaultDepositEvent)
      .values({
        eventId,
        contractId,
        ledger,
        ledgerAt,
        projectId: projectId.toString(),
        userAddress,
        amount: amount.toString(),
      })
      .orIgnore() // idempotency: skip if event_id already exists
      .execute();
  }

  /**
   * MilestoneApprovedEvent topics: [symbol("MilestoneApprovedEvent"), admin: Address]
   * value: { project_id: u64, milestone_id: u32 }
   */
  private async handleMilestoneApproved(
    eventId: string,
    contractId: string,
    ledger: number,
    ledgerAt: Date,
    topics: xdr.ScVal[],
    value: xdr.ScVal,
    viaVote: boolean,
  ): Promise<void> {
    const approvedBy = topics.length >= 2 ? this.decodeAddress(topics[1]) : null;
    const { projectId, milestoneId } = this.decodeMilestoneValue(value);

    if (projectId === null || milestoneId === null) {
      this.logger.warn(`MilestoneApprovedEvent ${eventId}: failed to decode`);
      return;
    }

    await this.milestoneRepo
      .createQueryBuilder()
      .insert()
      .into(VaultMilestoneEvent)
      .values({
        eventId,
        contractId,
        ledger,
        ledgerAt,
        projectId: projectId.toString(),
        milestoneId,
        approvedBy,
        viaVote,
      })
      .orIgnore()
      .execute();
  }

  /**
   * MilestoneApprovedByVoteEvent topics: [symbol("MilestoneApprovedByVoteEvent"), project_id: u64]
   * value: { milestone_id: u32 }
   */
  private async handleMilestoneApprovedByVote(
    eventId: string,
    contractId: string,
    ledger: number,
    ledgerAt: Date,
    topics: xdr.ScVal[],
    value: xdr.ScVal,
  ): Promise<void> {
    if (topics.length < 2) return;

    const projectId = this.decodeU64(topics[1]);
    const milestoneId = this.decodeMilestoneIdFromValue(value);

    if (projectId === null || milestoneId === null) {
      this.logger.warn(
        `MilestoneApprovedByVoteEvent ${eventId}: failed to decode`,
      );
      return;
    }

    await this.milestoneRepo
      .createQueryBuilder()
      .insert()
      .into(VaultMilestoneEvent)
      .values({
        eventId,
        contractId,
        ledger,
        ledgerAt,
        projectId: projectId.toString(),
        milestoneId,
        approvedBy: null,
        viaVote: true,
      })
      .orIgnore()
      .execute();
  }

  // ── XDR decoders ────────────────────────────────────────────────────────────

  private decodeSymbol(val: xdr.ScVal): string | null {
    try {
      return val.sym().toString();
    } catch {
      return null;
    }
  }

  private decodeAddress(val: xdr.ScVal): string | null {
    try {
      return val.address().toString();
    } catch {
      return null;
    }
  }

  private decodeU64(val: xdr.ScVal): bigint | null {
    try {
      const u64 = val.u64();
      return BigInt(u64.toString());
    } catch {
      return null;
    }
  }

  private decodeI128(val: xdr.ScVal): bigint | null {
    try {
      const parts = val.i128();
      const hi = BigInt(parts.hi().toString());
      const lo = BigInt(parts.lo().toString());
      return (hi << 64n) | lo;
    } catch {
      return null;
    }
  }

  /**
   * Decode a struct value containing project_id (u64) and milestone_id (u32).
   * The Soroban SDK encodes struct fields as a map of ScVal.
   */
  private decodeMilestoneValue(
    val: xdr.ScVal,
  ): { projectId: bigint | null; milestoneId: number | null } {
    try {
      const map = val.map();
      if (!map) return { projectId: null, milestoneId: null };

      let projectId: bigint | null = null;
      let milestoneId: number | null = null;

      for (const entry of map) {
        const key = entry.key().sym().toString();
        if (key === 'project_id') {
          projectId = this.decodeU64(entry.val());
        } else if (key === 'milestone_id') {
          milestoneId = entry.val().u32();
        }
      }

      return { projectId, milestoneId };
    } catch {
      return { projectId: null, milestoneId: null };
    }
  }

  private decodeMilestoneIdFromValue(val: xdr.ScVal): number | null {
    try {
      const map = val.map();
      if (!map) return null;
      for (const entry of map) {
        if (entry.key().sym().toString() === 'milestone_id') {
          return entry.val().u32();
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // ── Cursor persistence ──────────────────────────────────────────────────────

  private async loadCursor(contractId: string): Promise<string | null> {
    const row = await this.cursorRepo.findOne({ where: { contractId } });
    return row?.cursor ?? null;
  }

  private async saveCursor(contractId: string, cursor: string): Promise<void> {
    await this.cursorRepo
      .createQueryBuilder()
      .insert()
      .into(VaultIndexerCursor)
      .values({ contractId, cursor })
      .orUpdate(['cursor', 'updated_at'], ['contract_id'])
      .execute();
  }
}
