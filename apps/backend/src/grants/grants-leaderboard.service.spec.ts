import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { GrantsService } from './grants.service';

describe('GrantsService.getLeaderboard', () => {
  let service: GrantsService;

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrantsService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<GrantsService>(GrantsService);

    // Seed a round with 3 projects
    const round = service.createRound({
      name: 'Test Round',
      tokenAddress: 'CTOKEN',
      startTime: Math.floor(Date.now() / 1000) - 3600,
      endTime: Math.floor(Date.now() / 1000) + 3600,
    });

    service.approveProject({ roundId: round.id, projectId: 1 });
    service.approveProject({ roundId: round.id, projectId: 2 });
    service.approveProject({ roundId: round.id, projectId: 3 });

    // Project 1: 3 contributors
    service.recordContribution({ roundId: round.id, projectId: 1, contributor: 'GA1', amount: '100' });
    service.recordContribution({ roundId: round.id, projectId: 1, contributor: 'GB1', amount: '100' });
    service.recordContribution({ roundId: round.id, projectId: 1, contributor: 'GC1', amount: '100' });

    // Project 2: 1 contributor (lower QF score)
    service.recordContribution({ roundId: round.id, projectId: 2, contributor: 'GA2', amount: '300' });

    // Project 3: 2 contributors
    service.recordContribution({ roundId: round.id, projectId: 3, contributor: 'GA3', amount: '100' });
    service.recordContribution({ roundId: round.id, projectId: 3, contributor: 'GB3', amount: '100' });
  });

  it('returns ranked entries with rank, contributions, and match figures', () => {
    const rounds = service.listRounds();
    const roundId = rounds[rounds.length - 1].id;

    const result = service.getLeaderboard({ roundId, limit: 10 });

    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries[0].rank).toBe(1);
    expect(result.entries[0].projectId).toBeDefined();
    expect(result.entries[0].qfScore).toBeDefined();
    expect(result.entries[0].estimatedMatch).toBeDefined();
    expect(result.entries[0].totalContributions).toBeDefined();
  });

  it('entries are sorted by QF score descending', () => {
    const rounds = service.listRounds();
    const roundId = rounds[rounds.length - 1].id;

    const result = service.getLeaderboard({ roundId, limit: 10 });

    for (let i = 1; i < result.entries.length; i++) {
      expect(Number(result.entries[i - 1].qfScore)).toBeGreaterThanOrEqual(
        Number(result.entries[i].qfScore),
      );
    }
  });

  it('supports top-N response', () => {
    const rounds = service.listRounds();
    const roundId = rounds[rounds.length - 1].id;

    const result = service.getLeaderboard({ roundId, topN: 2 });

    expect(result.entries.length).toBeLessThanOrEqual(2);
    expect(result.entries[0].rank).toBe(1);
  });

  it('supports pagination', () => {
    const rounds = service.listRounds();
    const roundId = rounds[rounds.length - 1].id;

    const page1 = service.getLeaderboard({ roundId, page: 1, limit: 2 });
    const page2 = service.getLeaderboard({ roundId, page: 2, limit: 2 });

    expect(page1.entries.length).toBeLessThanOrEqual(2);
    expect(page1.page).toBe(1);
    expect(page2.page).toBe(2);

    // No overlap between pages
    const page1Ids = page1.entries.map((e) => e.projectId);
    const page2Ids = page2.entries.map((e) => e.projectId);
    expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
  });

  it('returns empty entries for a round with no projects', () => {
    const emptyRound = service.createRound({
      name: 'Empty Round',
      tokenAddress: 'CTOKEN',
      startTime: Math.floor(Date.now() / 1000) - 3600,
      endTime: Math.floor(Date.now() / 1000) + 3600,
    });

    const result = service.getLeaderboard({ roundId: emptyRound.id, limit: 10 });

    expect(result.entries).toEqual([]);
    expect(result.totalProjects).toBe(0);
  });

  it('throws NotFoundException for unknown roundId', () => {
    expect(() =>
      service.getLeaderboard({ roundId: 99999, limit: 10 }),
    ).toThrow(NotFoundException);
  });

  it('returns correct totalProjects count', () => {
    const rounds = service.listRounds();
    const roundId = rounds[rounds.length - 1].id;

    const result = service.getLeaderboard({ roundId, limit: 10 });

    expect(result.totalProjects).toBe(3);
  });

  it('includes poolBalance in response', () => {
    const rounds = service.listRounds();
    const roundId = rounds[rounds.length - 1].id;

    const result = service.getLeaderboard({ roundId, limit: 10 });

    expect(result.poolBalance).toBeDefined();
    expect(typeof result.poolBalance).toBe('string');
  });
});
