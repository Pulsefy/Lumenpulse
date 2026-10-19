import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { GrantsService } from './grants.service';
import { CONTRIBUTION_QUEUE } from '../suspicious-contribution/types';
import { GrantRoundState } from './round-lifecycle';

describe('GrantsService', () => {
  let service: GrantsService;

  const now = Math.floor(Date.now() / 1000);
  const past = now - 7200; // 2 hours ago
  const future = now + 7200; // 2 hours from now

  const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    mockQueue.add.mockClear();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrantsService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: getQueueToken(CONTRIBUTION_QUEUE), useValue: mockQueue },
      ],
    }).compile();
    service = module.get<GrantsService>(GrantsService);
  });

  // ── Round management ─────────────────────────────────────────────────────

  it('creates a round and returns it', () => {
    const round = service.createRound({
      name: 'Round 1',
      tokenAddress: 'GTOKEN',
      startTime: past,
      endTime: future,
    });
    expect(round.id).toBe(0);
    expect(round.name).toBe('Round 1');
    expect(round.totalPool).toBe('0');
    expect(round.status).toBe(GrantRoundState.OPEN);
  });

  it('advances a scheduled round through its time-based states', () => {
    const now = Date.now();
    const startTime = Math.floor(now / 1000) + 60;
    const endTime = startTime + 60;

    jest.useFakeTimers();
    try {
      jest.setSystemTime(now);
      const round = service.createRound({
        name: 'Scheduled',
        tokenAddress: 'GT',
        startTime,
        endTime,
      });
      expect(round.status).toBe(GrantRoundState.DRAFT);

      jest.setSystemTime(new Date(startTime * 1000));
      expect(service.getRound(round.id).status).toBe(GrantRoundState.OPEN);

      jest.setSystemTime(new Date((endTime + 1) * 1000));
      expect(service.getRound(round.id).status).toBe(GrantRoundState.MATCHING);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects invalid round dates', () => {
    expect(() =>
      service.createRound({
        name: 'Bad',
        tokenAddress: 'GTOKEN',
        startTime: future,
        endTime: past,
      }),
    ).toThrow(BadRequestException);
  });

  it('lists all rounds', () => {
    service.createRound({
      name: 'R1',
      tokenAddress: 'GT',
      startTime: past,
      endTime: future,
    });
    service.createRound({
      name: 'R2',
      tokenAddress: 'GT',
      startTime: past,
      endTime: future,
    });
    const result = service.listRounds();
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.totalPages).toBe(1);
  });

  it('paginates listRounds', () => {
    for (let i = 0; i < 5; i++) {
      service.createRound({
        name: `R${i}`,
        tokenAddress: 'GT',
        startTime: past,
        endTime: future,
      });
    }
    const page1 = service.listRounds({ page: 1, pageSize: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);

    const page3 = service.listRounds({ page: 3, pageSize: 2 });
    expect(page3.items).toHaveLength(1);
    expect(page3.page).toBe(3);
  });

  it('throws NotFoundException for unknown round', () => {
    expect(() => service.getRound(999)).toThrow(NotFoundException);
  });

  // ── Pool funding ─────────────────────────────────────────────────────────

  it('funds the pool', () => {
    const round = service.createRound({
      name: 'R',
      tokenAddress: 'GT',
      startTime: past,
      endTime: future,
    });
    const result = service.fundPool({
      roundId: round.id,
      funderPublicKey: 'GFUNDER',
      amount: '1000000',
    });
    expect(result.newBalance).toBe('1000000');
    expect(service.getRound(round.id).totalPool).toBe('1000000');
  });

  it('rejects funding a finalized round', () => {
    // Create a round that ended in the past
    const round = service.createRound({
      name: 'R',
      tokenAddress: 'GT',
      startTime: past - 3600,
      endTime: past,
    });
    service.finalizeRound(round.id);
    expect(() =>
      service.fundPool({
        roundId: round.id,
        funderPublicKey: 'G',
        amount: '100',
      }),
    ).toThrow(BadRequestException);
  });

  // ── Eligibility ──────────────────────────────────────────────────────────

  it('approves and removes a project', () => {
    const round = service.createRound({
      name: 'R',
      tokenAddress: 'GT',
      startTime: past,
      endTime: future,
    });
    service.approveProject({ roundId: round.id, projectId: 1 });
    expect(() =>
      service.approveProject({ roundId: round.id, projectId: 1 }),
    ).toThrow(BadRequestException);
    service.removeProject(round.id, 1);
    expect(() => service.removeProject(round.id, 1)).toThrow(NotFoundException);
  });

  // ── Contribution recording ───────────────────────────────────────────────

  it('records contributions and tracks them', () => {
    const round = service.createRound({
      name: 'R',
      tokenAddress: 'GT',
      startTime: past,
      endTime: future,
    });
    service.approveProject({ roundId: round.id, projectId: 1 });
    service.recordContribution({
      roundId: round.id,
      projectId: 1,
      contributorPublicKey: 'GA',
      amount: '100',
    });
    service.recordContribution({
      roundId: round.id,
      projectId: 1,
      contributorPublicKey: 'GB',
      amount: '100',
    });
    const summary = service.getRoundSummary(round.id);
    const proj = summary.projects.find((p) => p.projectId === 1)!;
    expect(proj.contributorCount).toBe(2);
    expect(proj.totalContributions).toBe('200');
  });

  it('rejects contribution to ineligible project', () => {
    const round = service.createRound({
      name: 'R',
      tokenAddress: 'GT',
      startTime: past,
      endTime: future,
    });
    expect(() =>
      service.recordContribution({
        roundId: round.id,
        projectId: 99,
        contributorPublicKey: 'GA',
        amount: '100',
      }),
    ).toThrow(BadRequestException);
  });

  // ── QF score — breadth beats depth ──────────────────────────────────────

  it('QF: 4 contributors of 25 outscores 1 contributor of 100', () => {
    const round = service.createRound({
      name: 'R',
      tokenAddress: 'GT',
      startTime: past,
      endTime: future,
    });
    service.approveProject({ roundId: round.id, projectId: 1 }); // many small
    service.approveProject({ roundId: round.id, projectId: 2 }); // one large

    // Project 1: 4 × 25
    ['GA', 'GB', 'GC', 'GD'].forEach((pk) =>
      service.recordContribution({
        roundId: round.id,
        projectId: 1,
        contributorPublicKey: pk,
        amount: '25',
      }),
    );
    // Project 2: 1 × 100
    service.recordContribution({
      roundId: round.id,
      projectId: 2,
      contributorPublicKey: 'GE',
      amount: '100',
    });

    const summary = service.getRoundSummary(round.id);
    const p1 = summary.projects.find((p) => p.projectId === 1)!;
    const p2 = summary.projects.find((p) => p.projectId === 2)!;

    expect(BigInt(p1.qfScore)).toBeGreaterThan(BigInt(p2.qfScore));
  });

  // ── Finalization ─────────────────────────────────────────────────────────

  it('finalizes a round that has ended', () => {
    const round = service.createRound({
      name: 'R',
      tokenAddress: 'GT',
      startTime: past - 3600,
      endTime: past,
    });
    const finalized = service.finalizeRound(round.id);
    expect(finalized.isFinalized).toBe(true);
    expect(finalized.status).toBe(GrantRoundState.CLOSED);
  });

  it('rejects finalizing a round still open', () => {
    const round = service.createRound({
      name: 'R',
      tokenAddress: 'GT',
      startTime: past,
      endTime: future,
    });
    expect(() => service.finalizeRound(round.id)).toThrow(BadRequestException);
    expect(service.getRound(round.id).status).toBe(GrantRoundState.OPEN);
  });

  // ── Distribution ─────────────────────────────────────────────────────────

  it('runs an open round through matching, close, and disbursement', () => {
    const startTime = Math.floor(Date.now() / 1000) - 60;
    const endTime = startTime + 120;
    const round = service.createRound({
      name: 'R',
      tokenAddress: 'GT',
      startTime,
      endTime,
    });
    service.fundPool({
      roundId: round.id,
      funderPublicKey: 'GF',
      amount: '1000000',
    });
    service.approveProject({ roundId: round.id, projectId: 1 });
    service.recordContribution({
      roundId: round.id,
      projectId: 1,
      contributorPublicKey: 'GA',
      amount: '100',
    });

    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date((endTime + 1) * 1000));
      expect(service.getRound(round.id).status).toBe(GrantRoundState.MATCHING);
      expect(service.finalizeRound(round.id).status).toBe(
        GrantRoundState.CLOSED,
      );

      const result = service.distribute({
        roundId: round.id,
        projectOwners: ['GOWNER'],
      });

      expect(result.totalDistributed).toBe('1000000');
      expect(service.getRound(round.id).status).toBe(GrantRoundState.DISBURSED);
      expect(() =>
        service.distribute({
          roundId: round.id,
          projectOwners: ['GOWNER'],
        }),
      ).toThrow(BadRequestException);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects distributing before finalization', () => {
    const round = service.createRound({
      name: 'R',
      tokenAddress: 'GT',
      startTime: past,
      endTime: future,
    });
    service.fundPool({
      roundId: round.id,
      funderPublicKey: 'GF',
      amount: '100',
    });
    service.approveProject({ roundId: round.id, projectId: 1 });
    expect(() =>
      service.distribute({ roundId: round.id, projectOwners: ['GOWNER'] }),
    ).toThrow(BadRequestException);
  });

  // ── Round summary ────────────────────────────────────────────────────────

  it('returns round summary sorted by estimated match descending', () => {
    const round = service.createRound({
      name: 'R',
      tokenAddress: 'GT',
      startTime: past,
      endTime: future,
    });
    service.fundPool({
      roundId: round.id,
      funderPublicKey: 'GF',
      amount: '1000000',
    });
    service.approveProject({ roundId: round.id, projectId: 1 });
    service.approveProject({ roundId: round.id, projectId: 2 });

    ['GA', 'GB', 'GC', 'GD'].forEach((pk) =>
      service.recordContribution({
        roundId: round.id,
        projectId: 1,
        contributorPublicKey: pk,
        amount: '25',
      }),
    );
    service.recordContribution({
      roundId: round.id,
      projectId: 2,
      contributorPublicKey: 'GE',
      amount: '100',
    });

    const summary = service.getRoundSummary(round.id);
    expect(summary.projects[0].projectId).toBe(1); // higher QF score first
    expect(BigInt(summary.projects[0].estimatedMatch)).toBeGreaterThan(
      BigInt(summary.projects[1].estimatedMatch),
    );
    // Allocations sum to pool
    const total = summary.projects.reduce(
      (acc, p) => acc + BigInt(p.estimatedMatch),
      0n,
    );
    expect(total).toBe(BigInt(summary.poolBalance));
  });

  it('adds participation metrics and provides an exportable round dataset', () => {
    const round = service.createRound({
      name: 'R',
      tokenAddress: 'GT',
      startTime: past,
      endTime: future,
    });
    service.fundPool({
      roundId: round.id,
      funderPublicKey: 'GF',
      amount: '1000',
    });
    service.approveProject({ roundId: round.id, projectId: 1 });
    service.approveProject({ roundId: round.id, projectId: 2 });

    service.recordContribution({
      roundId: round.id,
      projectId: 1,
      contributorPublicKey: 'GA',
      amount: '100',
    });
    service.recordContribution({
      roundId: round.id,
      projectId: 1,
      contributorPublicKey: 'GB',
      amount: '100',
    });
    service.recordContribution({
      roundId: round.id,
      projectId: 2,
      contributorPublicKey: 'GC',
      amount: '200',
    });

    const summary = service.getRoundSummary(round.id);
    expect(summary.participationMetrics.totalContributors).toBe(3);
    expect(summary.participationMetrics.totalContributionAmount).toBe('400');
    expect(summary.participationMetrics.totalContributionRecords).toBe(3);
    expect(summary.participationMetrics.totalProjectsWithContributions).toBe(2);
    expect(
      summary.projects.every(
        (project) => project.contributionPercentage !== undefined,
      ),
    ).toBe(true);

    const exportData = service.getRoundExport(round.id);
    expect(exportData.contributions).toHaveLength(3);
    expect(exportData.contributions[0]).toMatchObject({
      projectId: 1,
      contributorPublicKey: 'GA',
      amount: '100',
    });
  });
});
