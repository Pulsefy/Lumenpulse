import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { NotificationModule } from '../notification/notification.module';
import { User } from '../users/entities/user.entity';
import { SupportSession } from './entities/support-session.entity';
import { SupportModeController } from './support-mode.controller';
import { SupportModeInterceptor } from './support-mode.interceptor';
import { SupportModeService } from './support-mode.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SupportSession, User]),
    AuditModule,
    NotificationModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [SupportModeController],
  providers: [
    SupportModeService,
    SupportModeInterceptor,
    { provide: APP_INTERCEPTOR, useClass: SupportModeInterceptor },
  ],
  exports: [SupportModeService],
})
export class SupportModeModule {}
