/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { User } from '../users/entities/user.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';

jest.mock('bcrypt', () => ({
  ...jest.requireActual('bcrypt'),
  hash: jest.fn(),
  compare: jest.fn(),
}));

jest.mock('stellar-sdk', () => ({
  Keypair: {
    fromSecret: jest.fn().mockReturnValue({
      publicKey: jest.fn().mockReturnValue('GTEST'),
    }),
    fromPublicKey: jest.fn(),
  },
  Networks: {
    TESTNET: 'Test SDF Network ; September 2015',
    PUBLIC: 'Public Global Stellar Network ; September 2015',
  },
  TransactionBuilder: jest.fn(),
  Operation: { manageData: jest.fn() },
  BASE_FEE: '100',
  Account: jest.fn(),
  Transaction: jest.fn(),
}));

const mockedHash = bcrypt.hash as jest.Mock;

beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'Date'] });
});

afterAll(() => {
  jest.useRealTimers();
});

describe('AuthService – Password Reset', () => {
  let service: AuthService;
  let userRepository: Record<string, jest.Mock>;
  let resetTokenRepository: Record<string, jest.Mock>;
  let emailService: Record<string, jest.Mock>;
  let refreshTokenRepository: Record<string, jest.Mock>;

  const mockUser: Partial<User> = {
    id: 'user-uuid-1',
    email: 'alice@example.com',
    passwordHash: 'old-hashed-password',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    userRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((dto: Record<string, unknown>) => ({ ...dto })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    resetTokenRepository = {
      findOne: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((dto: Record<string, unknown>) => ({ ...dto })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    emailService = {
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };

    refreshTokenRepository = {
      findOne: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((dto: Record<string, unknown>) => ({ ...dto })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useValue: userRepository,
        },
        {
          provide: getRepositoryToken(PasswordResetToken),
          useValue: resetTokenRepository,
        },
        {
          provide: EmailService,
          useValue: emailService,
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: refreshTokenRepository,
        },
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            findById: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('jwt-token') },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) => {
              const map: Record<string, string> = {
                STELLAR_SERVER_SECRET:
                  'SCZANGBA5YHTNYVVV3C7CAZMCLXPILHSE7HG3EQMKJBXLSPHCQOEK3I',
                STELLAR_NETWORK: 'testnet',
                DOMAIN: 'lumenpulse.io',
              };
              return map[key] ?? fallback;
            }),
            getOrThrow: jest.fn().mockReturnValue('test-jwt-secret'),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('forgotPassword', () => {
    it('should return generic message when email does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      const result = await service.forgotPassword('unknown@example.com');

      expect(result.message).toBe(
        'If that email is registered, a reset link has been sent.',
      );
      expect(resetTokenRepository.save).not.toHaveBeenCalled();
      expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('should generate and persist a reset token for existing user', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.forgotPassword('alice@example.com');

      expect(result.message).toBe(
        'If that email is registered, a reset link has been sent.',
      );
      expect(resetTokenRepository.update).toHaveBeenCalled();
      expect(resetTokenRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUser.id,
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      );
      expect(resetTokenRepository.save).toHaveBeenCalled();
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'alice@example.com',
        expect.any(String),
      );
    });

    it('should invalidate previous tokens before creating a new one', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      await service.forgotPassword('alice@example.com');

      expect(resetTokenRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ userId: mockUser.id }),
        expect.objectContaining({ usedAt: expect.any(Date) }),
      );
    });

    it('should normalise the email to lowercase and trim', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await service.forgotPassword('  Alice@Example.COM  ');

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { email: 'alice@example.com' },
      });
    });
  });

  describe('resetPassword', () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    const validStoredToken: Partial<PasswordResetToken> = {
      id: 'token-uuid-1',
      tokenHash,
      userId: 'user-uuid-1',
      expiresAt: new Date(Date.now() + 3600_000),
      usedAt: null,
      createdAt: new Date(),
    };

    it('should reject an invalid token', async () => {
      resetTokenRepository.findOne.mockResolvedValue(null);

      await expect(
        service.resetPassword('bogus-token', 'newPassword123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject an expired token', async () => {
      const expiredToken = {
        ...validStoredToken,
        expiresAt: new Date(Date.now() - 1000),
      };
      resetTokenRepository.findOne.mockResolvedValue(expiredToken);

      await expect(
        service.resetPassword(rawToken, 'newPassword123'),
      ).rejects.toThrow(BadRequestException);
      expect(resetTokenRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ usedAt: expect.any(Date) }),
      );
    });

    it('should reject if user no longer exists', async () => {
      resetTokenRepository.findOne.mockResolvedValue({ ...validStoredToken });
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.resetPassword(rawToken, 'newPassword123'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should hash the new password and save user', async () => {
      const storedToken = { ...validStoredToken };
      resetTokenRepository.findOne.mockResolvedValue(storedToken);
      userRepository.findOne.mockResolvedValue({ ...mockUser });

      mockedHash.mockResolvedValue('new-hashed-password');

      const result = await service.resetPassword(rawToken, 'newPassword123');

      expect(result.message).toBe('Password has been reset successfully.');
      expect(mockedHash).toHaveBeenCalledWith('newPassword123', 10);
      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ passwordHash: 'new-hashed-password' }),
      );
    });

    it('should invalidate the token after successful reset', async () => {
      const storedToken = { ...validStoredToken };
      resetTokenRepository.findOne.mockResolvedValue(storedToken);
      userRepository.findOne.mockResolvedValue({ ...mockUser });
      mockedHash.mockResolvedValue('hashed');

      await service.resetPassword(rawToken, 'newPassword123');

      expect(resetTokenRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ usedAt: expect.any(Date) }),
      );
    });

    it('should not allow token reuse', async () => {
      // First call: token is valid
      const storedToken = { ...validStoredToken };
      resetTokenRepository.findOne.mockResolvedValueOnce(storedToken);
      userRepository.findOne.mockResolvedValueOnce({ ...mockUser });
      mockedHash.mockResolvedValue('hashed');

      await service.resetPassword(rawToken, 'newPassword123');

      // Second call: token repo returns null (already used)
      resetTokenRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.resetPassword(rawToken, 'anotherPassword'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

describe('AuthService – Refresh Tokens', () => {
  let service: AuthService;
  let userRepository: Record<string, jest.Mock>;
  let refreshTokenRepository: Record<string, jest.Mock>;

  const mockUser: Partial<User> = {
    id: 'user-uuid-1',
    email: 'alice@example.com',
    passwordHash: 'hashed-password',
    firstName: 'Alice',
    lastName: 'Smith',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    userRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    refreshTokenRepository = {
      findOne: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((dto: Record<string, unknown>) => ({ ...dto })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const resetTokenRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useValue: userRepository,
        },
        {
          provide: getRepositoryToken(PasswordResetToken),
          useValue: resetTokenRepository,
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: refreshTokenRepository,
        },
        {
          provide: EmailService,
          useValue: { sendPasswordResetEmail: jest.fn() },
        },
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            findById: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('jwt-token') },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) => {
              const map: Record<string, string> = {
                STELLAR_SERVER_SECRET:
                  'SCZANGBA5YHTNYVVV3C7CAZMCLXPILHSE7HG3EQMKJBXLSPHCQOEK3I',
                STELLAR_NETWORK: 'testnet',
                DOMAIN: 'lumenpulse.io',
              };
              return map[key] ?? fallback;
            }),
            getOrThrow: jest.fn().mockReturnValue('test-jwt-secret'),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('login', () => {
    it('should generate and store refresh token', async () => {
      const loginData = { id: 'user-uuid-1', email: 'alice@example.com' };

      const result = await service.login(loginData, 'iPhone 15', '192.168.1.1');

      expect(result).toEqual({
        access_token: 'jwt-token',
        refresh_token: expect.any(String),
      });
      expect(refreshTokenRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: loginData.id,
          deviceInfo: 'iPhone 15',
          ipAddress: '192.168.1.1',
          expiresAt: expect.any(Date),
          tokenHash: expect.any(String),
        }),
      );
      expect(refreshTokenRepository.save).toHaveBeenCalled();
    });
  });

  describe('refreshToken', () => {
    const refreshToken = 'valid-refresh-token';
    const tokenHash = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    const validRefreshToken: Partial<RefreshToken> = {
      id: 'refresh-token-uuid-1',
      tokenHash,
      userId: 'user-uuid-1',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      revokedAt: null,
      createdAt: new Date(),
      user: mockUser as User,
    };

    it('should refresh tokens successfully', async () => {
      refreshTokenRepository.findOne.mockResolvedValue(validRefreshToken);

      const result = await service.refreshToken(
        refreshToken,
        'iPhone 15',
        '192.168.1.1',
      );

      expect(result).toEqual({
        access_token: 'jwt-token',
        refresh_token: expect.any(String),
      });
      expect(refreshTokenRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
      expect(refreshTokenRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-uuid-1',
          deviceInfo: 'iPhone 15',
          ipAddress: '192.168.1.1',
        }),
      );
    });

    it('should reject invalid refresh token', async () => {
      refreshTokenRepository.findOne.mockResolvedValue(null);

      await expect(service.refreshToken('invalid-token')).rejects.toThrow(
        'Invalid or revoked refresh token',
      );
    });

    it('should reject expired refresh token', async () => {
      const expiredToken = {
        ...validRefreshToken,
        expiresAt: new Date(Date.now() - 1000),
      };
      refreshTokenRepository.findOne.mockResolvedValue(expiredToken);

      await expect(service.refreshToken(refreshToken)).rejects.toThrow(
        'Refresh token has expired',
      );
      expect(refreshTokenRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });

    it('should reject revoked refresh token', async () => {
      refreshTokenRepository.findOne.mockResolvedValue(null); // Query excludes revoked tokens

      await expect(service.refreshToken(refreshToken)).rejects.toThrow(
        'Invalid or revoked refresh token',
      );
    });
  });

  describe('logout', () => {
    const refreshToken = 'valid-refresh-token';
    const tokenHash = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    const validRefreshToken: Partial<RefreshToken> = {
      id: 'refresh-token-uuid-1',
      tokenHash,
      userId: 'user-uuid-1',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      createdAt: new Date(),
    };

    it('should logout successfully with valid token', async () => {
      refreshTokenRepository.findOne.mockResolvedValue(validRefreshToken);

      const result = await service.logout(refreshToken);

      expect(result.message).toBe('Successfully logged out');
      expect(refreshTokenRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });

    it('should return success for non-existent token', async () => {
      refreshTokenRepository.findOne.mockResolvedValue(null);

      const result = await service.logout('non-existent-token');

      expect(result.message).toBe('Successfully logged out');
      expect(refreshTokenRepository.save).not.toHaveBeenCalled();
    });

    it('should return success for already revoked token', async () => {
      const alreadyRevokedToken = {
        ...validRefreshToken,
        revokedAt: new Date(),
      };
      refreshTokenRepository.findOne.mockResolvedValue(alreadyRevokedToken);

      const result = await service.logout(refreshToken);

      expect(result.message).toBe('Successfully logged out');
      expect(refreshTokenRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('logoutAll', () => {
    it('should revoke all refresh tokens for user', async () => {
      await service.logoutAll('user-uuid-1');

      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId: 'user-uuid-1', revokedAt: IsNull() },
        { revokedAt: expect.any(Date) },
      );
    });
  });
});
