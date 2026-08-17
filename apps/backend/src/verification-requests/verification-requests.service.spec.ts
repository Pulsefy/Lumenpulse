import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VerificationRequestsService } from './verification-requests.service';
import {
  VerificationRequest,
  VerificationRequestStatus,
  VerificationRequestTargetType,
} from './entities/verification-request.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { Repository } from 'typeorm';

type VerificationRequestRepositoryMock = jest.Mocked<{
  create: (value: Partial<VerificationRequest>) => VerificationRequest;
  save: (value: VerificationRequest) => Promise<VerificationRequest>;
  find: () => Promise<VerificationRequest[]>;
  findOne: () => Promise<VerificationRequest | null>;
}>;

describe('VerificationRequestsService', () => {
  const request: VerificationRequest = {
    id: 'request-1',
    requesterId: 'user-1',
    requester: {} as User,
    targetType: VerificationRequestTargetType.PROJECT,
    targetId: 'project-1',
    status: VerificationRequestStatus.SUBMITTED,
    evidence: 'https://example.org/evidence',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const repository: VerificationRequestRepositoryMock = {
    create: jest.fn(
      (value: Partial<VerificationRequest>) => value as VerificationRequest,
    ),
    save: jest.fn((value: VerificationRequest) => Promise.resolve(value)),
    find: jest.fn(),
    findOne: jest.fn(),
  };
  const service = new VerificationRequestsService(
    repository as unknown as Repository<VerificationRequest>,
  );

  beforeEach(() => jest.clearAllMocks());

  it('creates a submitted request for either supported target type', async () => {
    repository.find.mockResolvedValue([]);
    const result = await service.create('user-1', {
      targetType: VerificationRequestTargetType.CONTRIBUTOR,
      targetId: 'contributor-1',
      evidence: 'https://example.org/profile',
    });

    expect(result.status).toBe(VerificationRequestStatus.SUBMITTED);
    expect(result.requesterId).toBe('user-1');
  });

  it('prevents duplicate open requests for the same requester and target', async () => {
    repository.find.mockResolvedValue([request]);

    await expect(
      service.create('user-1', {
        targetType: VerificationRequestTargetType.PROJECT,
        targetId: 'project-1',
        evidence: 'new evidence',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows only explicit reviewer lifecycle transitions', async () => {
    repository.findOne.mockResolvedValue({
      ...request,
      status: VerificationRequestStatus.IN_REVIEW,
    });
    const approved = await service.transition('request-1', 'reviewer-1', {
      status: VerificationRequestStatus.APPROVED,
      reviewNote: 'Evidence verified',
    });

    expect(approved.status).toBe(VerificationRequestStatus.APPROVED);
    expect(approved.reviewerId).toBe('reviewer-1');

    repository.findOne.mockResolvedValue({
      ...request,
      status: VerificationRequestStatus.APPROVED,
    });
    await expect(
      service.transition('request-1', 'reviewer-1', {
        status: VerificationRequestStatus.IN_REVIEW,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('limits individual request visibility to its requester or reviewer roles', async () => {
    repository.findOne.mockResolvedValue(request);
    await expect(
      service.findOne('request-1', 'user-2', UserRole.USER),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.findOne('request-1', 'reviewer-1', UserRole.REVIEWER),
    ).resolves.toEqual(request);
  });

  it('allows requesters to cancel only cancellable states', async () => {
    repository.findOne.mockResolvedValue({
      ...request,
      status: VerificationRequestStatus.CHANGES_REQUESTED,
    });
    await expect(service.cancel('request-1', 'user-1')).resolves.toMatchObject({
      status: VerificationRequestStatus.CANCELLED,
    });

    repository.findOne.mockResolvedValue({
      ...request,
      status: VerificationRequestStatus.APPROVED,
    });
    await expect(service.cancel('request-1', 'user-1')).rejects.toThrow(
      BadRequestException,
    );
  });
});
