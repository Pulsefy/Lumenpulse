import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../users/entities/user.entity';
import {
  CreateVerificationRequestDto,
  UpdateVerificationRequestStatusDto,
  VerificationRequestQueryDto,
} from './dto/verification-request.dto';
import {
  VerificationRequest,
  VerificationRequestStatus,
} from './entities/verification-request.entity';

const REVIEWER_TRANSITIONS: Record<
  VerificationRequestStatus,
  VerificationRequestStatus[]
> = {
  [VerificationRequestStatus.SUBMITTED]: [VerificationRequestStatus.IN_REVIEW],
  [VerificationRequestStatus.IN_REVIEW]: [
    VerificationRequestStatus.CHANGES_REQUESTED,
    VerificationRequestStatus.APPROVED,
    VerificationRequestStatus.REJECTED,
  ],
  [VerificationRequestStatus.CHANGES_REQUESTED]: [
    VerificationRequestStatus.IN_REVIEW,
  ],
  [VerificationRequestStatus.APPROVED]: [],
  [VerificationRequestStatus.REJECTED]: [],
  [VerificationRequestStatus.CANCELLED]: [],
};

@Injectable()
export class VerificationRequestsService {
  constructor(
    @InjectRepository(VerificationRequest)
    private readonly requests: Repository<VerificationRequest>,
  ) {}

  async create(requesterId: string, dto: CreateVerificationRequestDto) {
    const existing = await this.requests.find({
      where: {
        requesterId,
        targetType: dto.targetType,
        targetId: dto.targetId,
      },
    });
    if (existing.some((request) => this.isOpen(request.status))) {
      throw new BadRequestException(
        'An open verification request already exists for this target',
      );
    }
    return this.requests.save(
      this.requests.create({
        ...dto,
        requesterId,
        status: VerificationRequestStatus.SUBMITTED,
      }),
    );
  }

  async findMine(requesterId: string) {
    return this.requests.find({
      where: { requesterId },
      order: { createdAt: 'DESC' },
    });
  }

  async findAll(query: VerificationRequestQueryDto) {
    return this.requests.find({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.targetType ? { targetType: query.targetType } : {}),
        ...(query.targetId ? { targetId: query.targetId } : {}),
      },
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(id: string, requesterId: string, role: UserRole) {
    const request = await this.getRequest(id);
    if (request.requesterId !== requesterId && !this.canReview(role)) {
      throw new NotFoundException('Verification request not found');
    }
    return request;
  }

  async transition(
    id: string,
    reviewerId: string,
    dto: UpdateVerificationRequestStatusDto,
  ) {
    const request = await this.getRequest(id);
    if (!REVIEWER_TRANSITIONS[request.status].includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition verification request from ${request.status} to ${dto.status}`,
      );
    }
    request.status = dto.status;
    request.reviewerId = reviewerId;
    request.reviewNote = dto.reviewNote ?? null;
    request.reviewedAt = new Date();
    return this.requests.save(request);
  }

  async cancel(id: string, requesterId: string) {
    const request = await this.getRequest(id);
    if (request.requesterId !== requesterId) {
      throw new NotFoundException('Verification request not found');
    }
    if (
      ![
        VerificationRequestStatus.SUBMITTED,
        VerificationRequestStatus.CHANGES_REQUESTED,
      ].includes(request.status)
    ) {
      throw new BadRequestException(
        'Only submitted or changes-requested requests can be cancelled',
      );
    }
    request.status = VerificationRequestStatus.CANCELLED;
    return this.requests.save(request);
  }

  private async getRequest(id: string) {
    const request = await this.requests.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Verification request not found');
    return request;
  }

  private canReview(role: UserRole) {
    return role === UserRole.ADMIN || role === UserRole.REVIEWER;
  }

  private isOpen(status: VerificationRequestStatus) {
    return [
      VerificationRequestStatus.SUBMITTED,
      VerificationRequestStatus.IN_REVIEW,
      VerificationRequestStatus.CHANGES_REQUESTED,
    ].includes(status);
  }
}
