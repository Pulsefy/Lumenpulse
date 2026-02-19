/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { User as EmailUser } from '../entities/user.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';

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
  let emailUserRepository: Record<string, jest.Mock>;
  let resetTokenRepository: Record<string, jest.Mock>;

  const mockUser: Partial<EmailUser> = {
    id: 'user-uuid-1',
    email: 'alice@example.com',
    passwordHash: 'old-hashed-password',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    emailUserRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
    };

    resetTokenRepository = {
      findOne: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((dto: Record<string, unknown>) => ({ ...dto })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const userRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useValue: userRepository,
        },
        {
          provide: getRepositoryToken(EmailUser),
          useValue: emailUserRepository,
        },
        {
          provide: getRepositoryToken(PasswordResetToken),
          useValue: resetTokenRepository,
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
      emailUserRepository.findOne.mockResolvedValue(null);

      const result = await service.forgotPassword('unknown@example.com');

      expect(result.message).toBe(
        'If that email is registered, a reset link has been sent.',
      );
      expect(resetTokenRepository.save).not.toHaveBeenCalled();
    });

    it('should generate and persist a reset token for existing user', async () => {
      emailUserRepository.findOne.mockResolvedValue(mockUser);

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
    });

    it('should invalidate previous tokens before creating a new one', async () => {
      emailUserRepository.findOne.mockResolvedValue(mockUser);

      await service.forgotPassword('alice@example.com');

      expect(resetTokenRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ userId: mockUser.id }),
        expect.objectContaining({ usedAt: expect.any(Date) }),
      );
    });

    it('should normalise the email to lowercase and trim', async () => {
      emailUserRepository.findOne.mockResolvedValue(null);

      await service.forgotPassword('  Alice@Example.COM  ');

      expect(emailUserRepository.findOne).toHaveBeenCalledWith({
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
      emailUserRepository.findOne.mockResolvedValue(null);

      await expect(
        service.resetPassword(rawToken, 'newPassword123'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should hash the new password and save user', async () => {
      const storedToken = { ...validStoredToken };
      resetTokenRepository.findOne.mockResolvedValue(storedToken);
      emailUserRepository.findOne.mockResolvedValue({ ...mockUser });

      mockedHash.mockResolvedValue('new-hashed-password');

      const result = await service.resetPassword(rawToken, 'newPassword123');

      expect(result.message).toBe('Password has been reset successfully.');
      expect(mockedHash).toHaveBeenCalledWith('newPassword123', 10);
      expect(emailUserRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ passwordHash: 'new-hashed-password' }),
      );
    });

    it('should invalidate the token after successful reset', async () => {
      const storedToken = { ...validStoredToken };
      resetTokenRepository.findOne.mockResolvedValue(storedToken);
      emailUserRepository.findOne.mockResolvedValue({ ...mockUser });
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
      emailUserRepository.findOne.mockResolvedValueOnce({ ...mockUser });
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
