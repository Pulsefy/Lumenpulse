import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

  async log(
    action: string,
    userId: string | null,
    ipAddress: string | null,
    metadata?: Record<string, any>,
  ): Promise<AuditLog> {
    const auditLog = this.auditLogRepo.create({
      action,
      userId,
      ipAddress,
      metadata: metadata || null,
    });
    return this.auditLogRepo.save(auditLog);
  }

  async findAll(limit = 100, offset = 0): Promise<[AuditLog[], number]> {
    return this.auditLogRepo.findAndCount({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  async delete(id: string): Promise<void> {
    await this.auditLogRepo.delete(id);
  }
}
