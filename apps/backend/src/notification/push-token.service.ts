import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RegisterPushTokenDto } from './dto/push-token.dto';
import { PushToken } from './push-token.entity';

@Injectable()
export class PushTokenService {
  constructor(
    @InjectRepository(PushToken)
    private readonly repository: Repository<PushToken>,
  ) {}

  async register(
    userId: string,
    dto: RegisterPushTokenDto,
  ): Promise<PushToken> {
    const existingDevice = await this.repository.findOne({
      where: { deviceId: dto.deviceId, platform: dto.platform },
    });
    const existingToken = await this.repository.findOne({
      where: { token: dto.token },
    });
    const record = existingDevice ?? existingToken ?? this.repository.create();

    record.userId = userId;
    record.token = dto.token;
    record.deviceId = dto.deviceId;
    record.platform = dto.platform;
    record.deviceName = dto.deviceName ?? null;
    record.isActive = true;
    return this.repository.save(record);
  }

  async deregister(userId: string, deviceId: string): Promise<void> {
    await this.repository.update({ userId, deviceId }, { isActive: false });
  }

  async deregisterAllForUser(userId: string): Promise<void> {
    await this.repository.update({ userId }, { isActive: false });
  }
}
