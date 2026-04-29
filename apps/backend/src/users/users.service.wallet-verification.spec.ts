import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { StellarAccount } from './entities/stellar-account.entity';
import { StellarService } from '../stellar/stellar.service';
import { UploadService } from '../upload/upload.service';
import { BadRequestException } from '@nestjs/common';

describe('UsersService Wallet Verification', () => {
  let service: UsersService;
  let stellarService: jest.Mocked<StellarService>;

  const testKeypair = {
    publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHHF',
    secret: 'SCZBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  };

  beforeEach(async () => {
    const mockStellarService = {
      validatePublicKeyOrThrow: jest.fn(),
      accountExists: jest.fn().mockResolvedValue(true),
    };

    const mockUploadService = {
      uploadFile: jest.fn().mockResolvedValue('https://example.com/file.webp'),
    };

    const mockUserRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    const mockStellarAccountRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: StellarService, useValue: mockStellarService },
        { provide: UploadService, useValue: mockUploadService },
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        {
          provide: getRepositoryToken(StellarAccount),
          useValue: mockStellarAccountRepository,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              if (key === 'STELLAR_SERVER_SECRET') return testKeypair.secret;
              if (key === 'STELLAR_NETWORK') return 'testnet';
              if (key === 'DOMAIN') return 'lumenpulse.io';
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    stellarService = module.get(StellarService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateWalletChallenge', () => {
    it('should generate a valid challenge', () => {
      stellarService.validatePublicKeyOrThrow.mockReturnValue();

      const result = service.generateWalletChallenge(testKeypair.publicKey);

      expect(result).toHaveProperty('challenge');
      expect(result).toHaveProperty('nonce');
      expect(result).toHaveProperty('expiresIn');
      expect(result.publicKey).toBe(testKeypair.publicKey);
      expect(result.expiresIn).toBe(300);
    });

    it('should throw BadRequestException for invalid public key', () => {
      stellarService.validatePublicKeyOrThrow.mockImplementation(() => {
        throw new Error('Invalid key');
      });

      expect(() => service.generateWalletChallenge('INVALID')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('verifyWalletChallenge', () => {
    it('should throw if no challenge exists', () => {
      expect(() =>
        service.verifyWalletChallenge(
          testKeypair.publicKey,
          'signed-challenge',
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('markAccountVerified', () => {
    it('should throw NotFoundException if account not found', async () => {
      const mockRepo = service['stellarAccountRepository'] as any;
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.markAccountVerified(testKeypair.publicKey),
      ).rejects.toThrow();
    });
  });
});
