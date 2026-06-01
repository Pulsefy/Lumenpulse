import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { config } from '../lib/config';
import { CrowdfundVaultEventEntity } from './entities/crowdfund-vault-event.entity';
import { CrowdfundVaultProjectEntity } from './entities/crowdfund-vault-project.entity';
import { CrowdfundVaultContributorEntity } from './entities/crowdfund-vault-contributor.entity';
import { CrowdfundVaultMilestoneEntity } from './entities/crowdfund-vault-milestone.entity';
import { CrowdfundVaultSyncCheckpointEntity } from './entities/crowdfund-vault-sync-checkpoint.entity';
import {
  VaultSyncEventInput,
  VAULT_EVENT_TYPES,
} from './dto/vault-sync-event.dto';

@Injectable()
export class CrowdfundVaultSyncService {
  private readonly logger = new Logger(CrowdfundVaultSyncService.name);

  constructor(
    @InjectRepository(CrowdfundVaultEventEntity)
    private readonly eventRepo: Repository<CrowdfundVaultEventEntity>,
    @InjectRepository(CrowdfundVaultProjectEntity)
    private readonly projectRepo: Repository<CrowdfundVaultProjectEntity>,
    @InjectRepository(CrowdfundVaultContributorEntity)
    private readonly contributorRepo: Repository<CrowdfundVaultContributorEntity>,
    @InjectRepository(CrowdfundVaultMilestoneEntity)
    private readonly milestoneRepo: Repository<CrowdfundVaultMilestoneEntity>,
    @InjectRepository(CrowdfundVaultSyncCheckpointEntity)
    private readonly checkpointRepo: Repository<CrowdfundVaultSyncCheckpointEntity>,
  ) {}

  getVaultContractId(): string | null {
    return config.stellar.contracts.crowdfundVault ?? null;
  }

  isVaultContract(contractId: string | undefined | null): boolean {
    const vaultId = this.getVaultContractId();
    return Boolean(vaultId && contractId && contractId === vaultId);
  }

  /**
   * Idempotent vault event sync: stores raw event once, then materializes state.
   * Skips stale ledger sequences to tolerate reorg-like reordering.
   */
  async syncVaultEvent(input: VaultSyncEventInput): Promise<void> {
    const ledgerSeq = this.resolveLedgerSeq(input);
    const normalizedType = this.normalizeEventType(input.eventType);

    const existingEvent = await this.eventRepo.findOne({
      where: { txHash: input.txHash, eventIndex: input.eventIndex },
    });
    if (existingEvent) {
      this.logger.debug(
        { txHash: input.txHash, eventIndex: input.eventIndex },
        'Vault event already ingested, skipping replay',
      );
      return;
    }

    const parsed = this.parsePayload(input.rawPayload, normalizedType);

    const rawEvent = this.eventRepo.create({
      contractId: input.contractId,
      txHash: input.txHash,
      eventIndex: input.eventIndex,
      eventType: normalizedType,
      ledgerSeq: String(ledgerSeq),
      projectId: parsed.projectId,
      contributor: parsed.contributor,
      amount: parsed.amount,
      milestoneId: parsed.milestoneId,
      rawPayload: input.rawPayload,
    });
    await this.eventRepo.save(rawEvent);

    await this.materializeEvent({
      contractId: input.contractId,
      txHash: input.txHash,
      ledgerSeq,
      eventType: normalizedType,
      parsed,
    });

    await this.updateCheckpoint(input.contractId, ledgerSeq);
  }

  async getCheckpoint(contractId: string): Promise<number> {
    const row = await this.checkpointRepo.findOne({ where: { contractId } });
    return row ? Number(row.lastLedger) : 0;
  }

  async setCheckpoint(contractId: string, lastLedger: number): Promise<void> {
    await this.checkpointRepo.upsert(
      { contractId, lastLedger: String(lastLedger) },
      ['contractId'],
    );
  }

  private async materializeEvent(ctx: {
    contractId: string;
    txHash: string;
    ledgerSeq: number;
    eventType: string;
    parsed: ParsedVaultPayload;
  }): Promise<void> {
    const { eventType, parsed, ledgerSeq, txHash, contractId } = ctx;
    if (parsed.projectId === null) {
      return;
    }

    const projectId = parsed.projectId;

    switch (eventType) {
      case VAULT_EVENT_TYPES.PROJECT_CREATED:
        await this.applyProjectCreated(
          projectId,
          contractId,
          parsed,
          ledgerSeq,
          txHash,
        );
        break;
      case VAULT_EVENT_TYPES.DEPOSIT:
        await this.applyDeposit(projectId, contractId, parsed, ledgerSeq, txHash);
        break;
      case VAULT_EVENT_TYPES.WITHDRAW:
        await this.applyWithdraw(projectId, parsed, ledgerSeq, txHash);
        break;
      case VAULT_EVENT_TYPES.MILESTONE_APPROVED:
      case VAULT_EVENT_TYPES.MILESTONE_APPROVED_BY_VOTE:
        await this.applyMilestoneApproved(
          projectId,
          parsed,
          ledgerSeq,
          txHash,
        );
        break;
      case VAULT_EVENT_TYPES.PROJECT_CANCELED:
        await this.applyProjectStatus(projectId, 'canceled', ledgerSeq, txHash);
        break;
      case VAULT_EVENT_TYPES.PROJECT_EXPIRED:
        await this.applyProjectExpired(projectId, parsed, ledgerSeq, txHash);
        break;
      case VAULT_EVENT_TYPES.CONTRIBUTION_REFUNDED:
      case VAULT_EVENT_TYPES.CONTRIBUTION_CLAWED_BACK:
        await this.applyContributionReversal(
          projectId,
          parsed,
          ledgerSeq,
          txHash,
        );
        break;
      default:
        this.logger.debug({ eventType }, 'No materializer for vault event type');
    }
  }

  private async applyProjectCreated(
    projectId: string,
    contractId: string,
    parsed: ParsedVaultPayload,
    ledgerSeq: number,
    txHash: string,
  ): Promise<void> {
    if (await this.isStaleProject(projectId, ledgerSeq)) {
      return;
    }

    await this.projectRepo.upsert(
      {
        projectId,
        contractId,
        owner: parsed.owner ?? '',
        tokenAddress: parsed.tokenAddress,
        status: 'active',
        lastLedgerSeq: String(ledgerSeq),
        lastTxHash: txHash,
      },
      ['projectId'],
    );
  }

  private async applyDeposit(
    projectId: string,
    contractId: string,
    parsed: ParsedVaultPayload,
    ledgerSeq: number,
    txHash: string,
  ): Promise<void> {
    if (!parsed.contributor || !parsed.amount) {
      return;
    }
    if (await this.isStaleProject(projectId, ledgerSeq)) {
      return;
    }

    const amount = parsed.amount;
    const project = await this.projectRepo.findOne({ where: { projectId } });

    if (!project) {
      await this.projectRepo.save(
        this.projectRepo.create({
          projectId,
          contractId,
          owner: parsed.owner ?? parsed.contributor,
          tokenAddress: parsed.tokenAddress,
          totalContributions: amount,
          uniqueContributors: 1,
          status: 'active',
          lastLedgerSeq: String(ledgerSeq),
          lastTxHash: txHash,
        }),
      );
    } else {
      project.totalContributions = this.addAmount(
        project.totalContributions,
        amount,
      );
      project.lastLedgerSeq = String(ledgerSeq);
      project.lastTxHash = txHash;
      await this.projectRepo.save(project);
    }

    const contributorRow = await this.contributorRepo.findOne({
      where: { projectId, contributor: parsed.contributor },
    });

    if (!contributorRow) {
      await this.contributorRepo.save(
        this.contributorRepo.create({
          projectId,
          contributor: parsed.contributor,
          totalContributed: amount,
          firstContributionLedger: String(ledgerSeq),
          lastContributionLedger: String(ledgerSeq),
        }),
      );
      const proj = await this.projectRepo.findOne({ where: { projectId } });
      if (proj) {
        proj.uniqueContributors += 1;
        await this.projectRepo.save(proj);
      }
    } else {
      contributorRow.totalContributed = this.addAmount(
        contributorRow.totalContributed,
        amount,
      );
      contributorRow.lastContributionLedger = String(ledgerSeq);
      contributorRow.firstContributionLedger ??= String(ledgerSeq);
      await this.contributorRepo.save(contributorRow);
    }
  }

  private async applyWithdraw(
    projectId: string,
    parsed: ParsedVaultPayload,
    ledgerSeq: number,
    txHash: string,
  ): Promise<void> {
    if (!parsed.amount || (await this.isStaleProject(projectId, ledgerSeq))) {
      return;
    }

    const project = await this.projectRepo.findOne({ where: { projectId } });
    if (!project) {
      return;
    }

    project.totalWithdrawn = this.addAmount(project.totalWithdrawn, parsed.amount);
    project.lastLedgerSeq = String(ledgerSeq);
    project.lastTxHash = txHash;
    await this.projectRepo.save(project);
  }

  private async applyMilestoneApproved(
    projectId: string,
    parsed: ParsedVaultPayload,
    ledgerSeq: number,
    txHash: string,
  ): Promise<void> {
    if (parsed.milestoneId === null) {
      return;
    }

    const existing = await this.milestoneRepo.findOne({
      where: { projectId, milestoneId: parsed.milestoneId },
    });

    if (
      existing?.lastLedgerSeq &&
      Number(existing.lastLedgerSeq) > ledgerSeq
    ) {
      return;
    }

    await this.milestoneRepo.upsert(
      {
        projectId,
        milestoneId: parsed.milestoneId,
        status: 'approved',
        approvedAt: new Date(),
        lastLedgerSeq: String(ledgerSeq),
      },
      ['projectId', 'milestoneId'],
    );

    if (!(await this.isStaleProject(projectId, ledgerSeq))) {
      await this.projectRepo.update(
        { projectId },
        { lastLedgerSeq: String(ledgerSeq), lastTxHash: txHash },
      );
    }
  }

  private async applyProjectStatus(
    projectId: string,
    status: string,
    ledgerSeq: number,
    txHash: string,
  ): Promise<void> {
    if (await this.isStaleProject(projectId, ledgerSeq)) {
      return;
    }

    await this.projectRepo.update(
      { projectId },
      { status, lastLedgerSeq: String(ledgerSeq), lastTxHash: txHash },
    );
  }

  private async applyProjectExpired(
    projectId: string,
    parsed: ParsedVaultPayload,
    ledgerSeq: number,
    txHash: string,
  ): Promise<void> {
    if (await this.isStaleProject(projectId, ledgerSeq)) {
      return;
    }

    await this.projectRepo.update(
      { projectId },
      {
        status: 'expired',
        refundWindowDeadline: parsed.refundWindowDeadline
          ? String(parsed.refundWindowDeadline)
          : null,
        lastLedgerSeq: String(ledgerSeq),
        lastTxHash: txHash,
      },
    );
  }

  private async applyContributionReversal(
    projectId: string,
    parsed: ParsedVaultPayload,
    ledgerSeq: number,
    txHash: string,
  ): Promise<void> {
    if (!parsed.contributor || !parsed.amount) {
      return;
    }
    if (await this.isStaleProject(projectId, ledgerSeq)) {
      return;
    }

    const project = await this.projectRepo.findOne({ where: { projectId } });
    if (project) {
      project.totalContributions = this.subtractAmount(
        project.totalContributions,
        parsed.amount,
      );
      project.lastLedgerSeq = String(ledgerSeq);
      project.lastTxHash = txHash;
      await this.projectRepo.save(project);
    }

    const contributorRow = await this.contributorRepo.findOne({
      where: { projectId, contributor: parsed.contributor },
    });
    if (contributorRow) {
      contributorRow.totalContributed = this.subtractAmount(
        contributorRow.totalContributed,
        parsed.amount,
      );
      contributorRow.lastContributionLedger = String(ledgerSeq);
      await this.contributorRepo.save(contributorRow);
    }
  }

  private async isStaleProject(
    projectId: string,
    ledgerSeq: number,
  ): Promise<boolean> {
    const project = await this.projectRepo.findOne({
      where: { projectId },
      select: ['lastLedgerSeq'],
    });
    if (!project) {
      return false;
    }
    return Number(project.lastLedgerSeq) > ledgerSeq;
  }

  private async updateCheckpoint(
    contractId: string,
    ledgerSeq: number,
  ): Promise<void> {
    const current = await this.getCheckpoint(contractId);
    if (ledgerSeq > current) {
      await this.setCheckpoint(contractId, ledgerSeq);
    }
  }

  private resolveLedgerSeq(input: VaultSyncEventInput): number {
    if (input.ledgerSeq !== undefined && input.ledgerSeq > 0) {
      return input.ledgerSeq;
    }
    const fromPayload = input.rawPayload?.ledgerSeq ?? input.rawPayload?.ledger;
    const n = Number(fromPayload);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  private normalizeEventType(eventType: string): string {
    return eventType.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  }

  private parsePayload(
    raw: Record<string, unknown>,
    normalizedType: string,
  ): ParsedVaultPayload {
    const projectId = this.pickBigInt(raw, [
      'projectId',
      'project_id',
      'projectID',
    ]);
    const contributor = this.pickString(raw, [
      'user',
      'contributor',
      'owner',
      'recipient',
    ]);
    const amount = this.pickAmount(raw);
    const milestoneId = this.pickInt(raw, ['milestoneId', 'milestone_id']);
    const owner = this.pickString(raw, ['owner']);
    const tokenAddress = this.pickString(raw, [
      'tokenAddress',
      'token_address',
    ]);
    const refundWindowDeadline = this.pickBigInt(raw, [
      'refundWindowDeadline',
      'refund_window_deadline',
    ]);

    return {
      projectId,
      contributor,
      amount,
      milestoneId,
      owner,
      tokenAddress,
      refundWindowDeadline,
      normalizedType,
    };
  }

  private pickString(
    raw: Record<string, unknown>,
    keys: string[],
  ): string | null {
    for (const key of keys) {
      const v = raw[key];
      if (typeof v === 'string' && v.length > 0) {
        return v;
      }
    }
    return null;
  }

  private pickBigInt(
    raw: Record<string, unknown>,
    keys: string[],
  ): string | null {
    for (const key of keys) {
      const v = raw[key];
      if (v === undefined || v === null) {
        continue;
      }
      return String(v);
    }
    return null;
  }

  private pickInt(raw: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
      const v = raw[key];
      if (v === undefined || v === null) {
        continue;
      }
      const n = Number(v);
      if (Number.isFinite(n)) {
        return n;
      }
    }
    return null;
  }

  private pickAmount(raw: Record<string, unknown>): string | null {
    const v = raw.amount ?? raw.value;
    if (v === undefined || v === null) {
      return null;
    }
    return String(v);
  }

  private addAmount(current: string, delta: string): string {
    try {
      const sum = BigInt(current) + BigInt(delta);
      return sum.toString();
    } catch {
      return current;
    }
  }

  private subtractAmount(current: string, delta: string): string {
    try {
      const result = BigInt(current) - BigInt(delta);
      return result < 0n ? '0' : result.toString();
    } catch {
      return current;
    }
  }
}

interface ParsedVaultPayload {
  projectId: string | null;
  contributor: string | null;
  amount: string | null;
  milestoneId: number | null;
  owner: string | null;
  tokenAddress: string | null;
  refundWindowDeadline: string | null;
  normalizedType: string;
}
