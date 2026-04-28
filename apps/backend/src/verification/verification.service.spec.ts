import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { VerificationService } from './verification.service';
import { VerificationStatus, WeightMode } from './dto/verification.dto';

describe('VerificationService', () => {
  let svc: VerificationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def: string) => {
              if (key === 'VERIFICATION_QUORUM') return '3';
              if (key === 'VERIFICATION_WEIGHT_MODE') return WeightMode.Flat;
              if (key === 'VERIFICATION_MIN_WEIGHT') return '1';
              return def;
            },
          },
        },
      ],
    }).compile();
    svc = module.get<VerificationService>(VerificationService);
  });

  // ── Config ──────────────────────────────────────────────────────────────────

  it('returns config', () => {
    const cfg = svc.getConfig();
    expect(cfg.quorumThreshold).toBe(3);
    expect(cfg.weightMode).toBe(WeightMode.Flat);
  });

  it('updates config', () => {
    const cfg = svc.updateConfig({ quorumThreshold: 10, minVoterWeight: 2 });
    expect(cfg.quorumThreshold).toBe(10);
    expect(cfg.minVoterWeight).toBe(2);
  });

  it('rejects zero quorum', () => {
    expect(() =>
      svc.updateConfig({ quorumThreshold: 0, minVoterWeight: 1 }),
    ).toThrow(BadRequestException);
  });

  // ── Registration ────────────────────────────────────────────────────────────

  it('registers a project', () => {
    const p = svc.registerProject({
      projectId: 1,
      ownerPublicKey: 'GA',
      name: 'Test',
    });
    expect(p.status).toBe(VerificationStatus.Pending);
    expect(p.votesFor).toBe(0);
    expect(p.quorumProgress).toBe(0);
  });

  it('rejects duplicate registration', () => {
    svc.registerProject({ projectId: 1, ownerPublicKey: 'GA', name: 'Test' });
    expect(() =>
      svc.registerProject({ projectId: 1, ownerPublicKey: 'GA', name: 'Test' }),
    ).toThrow(BadRequestException);
  });

  it('throws NotFoundException for unknown project', () => {
    expect(() => svc.getProject(999)).toThrow(NotFoundException);
  });

  // ── Flat mode voting ─────────────────────────────────────────────────────────

  it('accumulates votes', () => {
    svc.registerProject({ projectId: 1, ownerPublicKey: 'GA', name: 'P' });
    svc.castVote({ projectId: 1, voterPublicKey: 'GB', support: true });
    svc.castVote({ projectId: 1, voterPublicKey: 'GC', support: true });
    const p = svc.getProject(1);
    expect(p.votesFor).toBe(2);
    expect(p.status).toBe(VerificationStatus.Pending);
    expect(p.quorumProgress).toBe(67); // 2/3 * 100
  });

  it('auto-verifies at quorum', () => {
    svc.registerProject({ projectId: 1, ownerPublicKey: 'GA', name: 'P' });
    ['GB', 'GC', 'GD'].forEach((pk) =>
      svc.castVote({ projectId: 1, voterPublicKey: pk, support: true }),
    );
    expect(svc.isVerified(1)).toBe(true);
    expect(svc.getProject(1).quorumProgress).toBe(100);
  });

  it('auto-rejects at quorum against', () => {
    svc.registerProject({ projectId: 1, ownerPublicKey: 'GA', name: 'P' });
    ['GB', 'GC', 'GD'].forEach((pk) =>
      svc.castVote({ projectId: 1, voterPublicKey: pk, support: false }),
    );
    expect(svc.getProject(1).status).toBe(VerificationStatus.Rejected);
  });

  it('rejects double vote', () => {
    svc.registerProject({ projectId: 1, ownerPublicKey: 'GA', name: 'P' });
    svc.castVote({ projectId: 1, voterPublicKey: 'GB', support: true });
    expect(() =>
      svc.castVote({ projectId: 1, voterPublicKey: 'GB', support: true }),
    ).toThrow(BadRequestException);
  });

  it('rejects vote on resolved project', () => {
    svc.registerProject({ projectId: 1, ownerPublicKey: 'GA', name: 'P' });
    ['GB', 'GC', 'GD'].forEach((pk) =>
      svc.castVote({ projectId: 1, voterPublicKey: pk, support: true }),
    );
    expect(() =>
      svc.castVote({ projectId: 1, voterPublicKey: 'GE', support: true }),
    ).toThrow(BadRequestException);
  });

  // ── Reputation weight mode ───────────────────────────────────────────────────

  it('uses reputation as weight', () => {
    svc.updateConfig({ quorumThreshold: 100, minVoterWeight: 1 });
    // Manually switch to reputation mode by seeding scores
    svc.setReputation('GA', 60);
    svc.setReputation('GB', 50);

    // Re-init with reputation mode via a fresh service instance
    const module = Test.createTestingModule({
      providers: [
        VerificationService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def: string) => {
              if (key === 'VERIFICATION_QUORUM') return '100';
              if (key === 'VERIFICATION_WEIGHT_MODE')
                return WeightMode.Reputation;
              if (key === 'VERIFICATION_MIN_WEIGHT') return '1';
              return def;
            },
          },
        },
      ],
    });

    void module.compile().then((m) => {
      const repSvc = m.get<VerificationService>(VerificationService);
      repSvc.setReputation('GA', 60);
      repSvc.setReputation('GB', 50);
      repSvc.registerProject({ projectId: 1, ownerPublicKey: 'GX', name: 'P' });

      const r1 = repSvc.castVote({
        projectId: 1,
        voterPublicKey: 'GA',
        support: true,
      });
      expect(r1.weight).toBe(60);
      expect(r1.newStatus).toBe(VerificationStatus.Pending); // 60 < 100

      const r2 = repSvc.castVote({
        projectId: 1,
        voterPublicKey: 'GB',
        support: true,
      });
      expect(r2.weight).toBe(50);
      expect(r2.newStatus).toBe(VerificationStatus.Verified); // 110 >= 100
    });
  });

  // ── Min weight enforcement ───────────────────────────────────────────────────

  it('rejects voter below min weight in reputation mode', async () => {
    const m = await Test.createTestingModule({
      providers: [
        VerificationService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def: string) => {
              if (key === 'VERIFICATION_QUORUM') return '100';
              if (key === 'VERIFICATION_WEIGHT_MODE')
                return WeightMode.Reputation;
              if (key === 'VERIFICATION_MIN_WEIGHT') return '10';
              return def;
            },
          },
        },
      ],
    }).compile();

    const repSvc = m.get<VerificationService>(VerificationService);
    // GA has reputation 5, below min 10
    repSvc.setReputation('GA', 5);
    repSvc.registerProject({ projectId: 1, ownerPublicKey: 'GX', name: 'P' });

    expect(() =>
      repSvc.castVote({ projectId: 1, voterPublicKey: 'GA', support: true }),
    ).toThrow(ForbiddenException);
  });

  // ── Admin override ───────────────────────────────────────────────────────────

  it('admin can verify a project', () => {
    svc.registerProject({ projectId: 1, ownerPublicKey: 'GA', name: 'P' });
    const p = svc.overrideVerification({ projectId: 1, verified: true });
    expect(p.status).toBe(VerificationStatus.Verified);
    expect(svc.isVerified(1)).toBe(true);
  });

  it('admin can revoke verification', () => {
    svc.registerProject({ projectId: 1, ownerPublicKey: 'GA', name: 'P' });
    svc.overrideVerification({ projectId: 1, verified: true });
    svc.overrideVerification({ projectId: 1, verified: false });
    expect(svc.isVerified(1)).toBe(false);
    expect(svc.getProject(1).status).toBe(VerificationStatus.Rejected);
  });

  // ── List filtering ───────────────────────────────────────────────────────────

  it('lists projects filtered by status', () => {
    svc.registerProject({ projectId: 1, ownerPublicKey: 'GA', name: 'P1' });
    svc.registerProject({ projectId: 2, ownerPublicKey: 'GB', name: 'P2' });
    svc.overrideVerification({ projectId: 1, verified: true });

    const verified = svc.listProjects(VerificationStatus.Verified);
    expect(verified).toHaveLength(1);
    expect(verified[0].projectId).toBe(1);

    const pending = svc.listProjects(VerificationStatus.Pending);
    expect(pending).toHaveLength(1);
    expect(pending[0].projectId).toBe(2);

    expect(svc.listProjects()).toHaveLength(2);
  });
});
