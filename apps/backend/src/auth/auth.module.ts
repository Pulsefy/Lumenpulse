import { Module, forwardRef } from '@nestjs/common';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { EmailModule } from '../email/email.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard';
import { User } from '../users/entities/user.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { AuditModule } from '../audit/audit.module';
import { AdminSessionsController } from './admin-sessions.controller';
import { RefreshToken } from './entities/refresh-token.entity';
import { SupportSession } from '../support-mode/entities/support-session.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      PasswordResetToken,
      RefreshToken,
      SupportSession,
    ]),
    forwardRef(() => UsersModule),
    EmailModule,
    forwardRef(() => AuditModule),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): JwtModuleOptions => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get('JWT_EXPIRES_IN', '7d'),
        },
      }),
    }),
  ],
  controllers: [AuthController, AdminSessionsController],
  providers: [AuthService, JwtStrategy, RolesGuard],
  exports: [AuthService, JwtStrategy, RolesGuard, PassportModule],
})
export class AuthModule {}
