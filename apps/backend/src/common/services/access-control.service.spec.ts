import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AccessControlService } from './access-control.service';
import { User, UserRole } from '../../users/entities/user.entity';
import { WebhookVerificationService } from '../../webhook/webhook-verification.service';
import {
  AccessAction,
  ResourceType,
  VerificationType,
} from '../interfaces/access-control.interface';

describe('AccessControlService', () => {
  let service: AccessControlService;
  let userRepository: jest.Mocked<Repository<User>>;
  let configService: jest.Mocked<ConfigService>;
  let webhookService: jest.Mocked<WebhookVerificationService>;

  beforeEach(async () => {
    const mockUserRepository = {
      findOne: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn(),
    };

    const mockWebhookService = {
      verifySignature: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccessControlService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: WebhookVerificationService,
          useValue: mockWebhookService,
        },
      ],
    }).compile();

    service = module.get<AccessControlService>(AccessControlService);
    userRepository = module.get(getRepositoryToken(User));
    configService = module.get(ConfigService);
    webhookService = module.get(WebhookVerificationService);
  });

  describe('hasRole', () => {
    it('should return true when user has the specified role', async () => {
      const mockUser = { role: UserRole.ADMIN } as User;
      userRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.hasRole('user1', UserRole.ADMIN);

      expect(result).toBe(true);
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user1' },
        select: ['role'],
      });
    });

    it('should return false when user does not have the specified role', async () => {
      const mockUser = { role: UserRole.USER } as User;
      userRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.hasRole('user1', UserRole.ADMIN);

      expect(result).toBe(false);
    });

    it('should return false when user is not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      const result = await service.hasRole('user1', UserRole.ADMIN);

      expect(result).toBe(false);
    });
  });

  describe('checkPermission', () => {
    it('should grant access to admin users', async () => {
      const request = {
        action: AccessAction.READ,
        resource: {
          type: ResourceType.PORTFOLIO,
          id: 'portfolio1',
          ownerId: 'user2',
        },
        context: {
          userId: 'user1',
          userRole: UserRole.ADMIN,
        },
      };

      const result = await service.checkPermission(request);

      expect(result.granted).toBe(true);
      expect(result.metadata?.reason).toBe('admin_access');
    });

    it('should grant access to resource owners', async () => {
      const request = {
        action: AccessAction.READ,
        resource: {
          type: ResourceType.PORTFOLIO,
          id: 'portfolio1',
          ownerId: 'user1',
        },
        context: {
          userId: 'user1',
          userRole: UserRole.USER,
        },
      };

      const result = await service.checkPermission(request);

      expect(result.granted).toBe(true);
      expect(result.metadata?.reason).toBe('owner_access');
    });

    it('should deny access when user is not owner and not admin', async () => {
      const request = {
        action: AccessAction.WRITE,
        resource: {
          type: ResourceType.PORTFOLIO,
          id: 'portfolio1',
          ownerId: 'user2',
        },
        context: {
          userId: 'user1',
          userRole: UserRole.USER,
        },
      };

      const result = await service.checkPermission(request);

      expect(result.granted).toBe(false);
      expect(result.reason).toBe('insufficient_permissions');
    });
  });

  describe('verifyTrustedCaller', () => {
    it('should verify webhook signatures', async () => {
      const mockVerificationResult = {
        valid: true,
        provider: 'github',
        algorithm: 'hmac-sha256',
      };
      webhookService.verifySignature.mockReturnValue(mockVerificationResult);

      const request = {
        verificationType: VerificationType.WEBHOOK_SIGNATURE,
        verificationData: {
          provider: 'github',
          signature: 'sha256=abc123',
        },
        rawData: Buffer.from('test data'),
      };

      const result = await service.verifyTrustedCaller(request);

      expect(result.trusted).toBe(true);
      expect(result.callerId).toBe('github');
      expect(webhookService.verifySignature).toHaveBeenCalledWith(
        'github',
        Buffer.from('test data'),
        'sha256=abc123',
        undefined,
      );
    });

    it('should verify IP allowlists', async () => {
      configService.get.mockReturnValue('192.168.1.0/24,127.0.0.1');

      const request = {
        verificationType: VerificationType.IP_ALLOWLIST,
        verificationData: {
          ip: '192.168.1.100',
        },
      };

      const result = await service.verifyTrustedCaller(request);

      expect(result.trusted).toBe(true);
      expect(result.callerId).toBe('ip:192.168.1.100');
    });

    it('should reject IPs not in allowlist', async () => {
      configService.get.mockReturnValue('192.168.1.0/24');

      const request = {
        verificationType: VerificationType.IP_ALLOWLIST,
        verificationData: {
          ip: '10.0.0.1',
        },
      };

      const result = await service.verifyTrustedCaller(request);

      expect(result.trusted).toBe(false);
      expect(result.error).toBe('IP not in allowlist');
    });
  });

  describe('createContext', () => {
    it('should create context from request data', () => {
      const requestData = {
        user: {
          id: 'user1',
          role: UserRole.ADMIN,
          stellarPublicKey: 'GABC123',
        },
        ip: '192.168.1.100',
        headers: {
          'user-agent': 'test-agent',
          'x-webhook-provider': 'github',
        },
      };

      const context = service.createContext(requestData);

      expect(context).toEqual({
        userId: 'user1',
        userRole: UserRole.ADMIN,
        stellarPublicKey: 'GABC123',
        ipAddress: '192.168.1.100',
        webhookProvider: 'github',
        metadata: {
          userAgent: 'test-agent',
          origin: undefined,
        },
      });
    });
  });

  describe('isIpAllowed', () => {
    it('should allow IPs in CIDR range', async () => {
      configService.get.mockReturnValue('192.168.1.0/24,127.0.0.1');

      const result = await service.isIpAllowed('192.168.1.100');

      expect(result).toBe(true);
    });

    it('should allow exact IP matches', async () => {
      configService.get.mockReturnValue('127.0.0.1,192.168.1.100');

      const result = await service.isIpAllowed('127.0.0.1');

      expect(result).toBe(true);
    });

    it('should reject IPs not in allowlist', async () => {
      configService.get.mockReturnValue('192.168.1.0/24');

      const result = await service.isIpAllowed('10.0.0.1');

      expect(result).toBe(false);
    });

    it('should return false when no allowlist is configured', async () => {
      configService.get.mockReturnValue(undefined);

      const result = await service.isIpAllowed('192.168.1.100');

      expect(result).toBe(false);
    });

    it('should handle invalid CIDR notation gracefully', async () => {
      configService.get.mockReturnValue('invalid/cidr');

      const result = await service.isIpAllowed('192.168.1.100');

      expect(result).toBe(false);
    });
  });
});
