import { Test, TestingModule } from '@nestjs/testing';
import { WebhookVerificationService } from './webhook-verification.service';
import { WebhookSignatureAlgorithm } from './webhook.types';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

describe('WebhookVerificationService', () => {
  let service: WebhookVerificationService;
  const testSecret = 'test-secret-key-12345';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookVerificationService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'WEBHOOK_PROVIDERS') {
                return JSON.stringify([
                  {
                    name: 'test-provider',
                    algorithm: WebhookSignatureAlgorithm.HMAC_SHA256,
                    secret: testSecret,
                    enabled: true,
                  },
                ]);
              }
              if (key === 'WEBHOOK_SECRET') {
                return testSecret;
              }
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<WebhookVerificationService>(
      WebhookVerificationService,
    );
    
    // Manually call onModuleInit to load provider configs
    service.onModuleInit();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('verifySignature - HMAC-SHA256', () => {
    it('should verify valid HMAC-SHA256 signature', () => {
      const payload = '{"event":"test","data":"value"}';
      const rawBody = Buffer.from(payload);
      const signature = crypto
        .createHmac('sha256', testSecret)
        .update(rawBody)
        .digest('hex');

      const result = service.verifySignature(
        'test-provider',
        rawBody,
        `sha256=${signature}`,
      );

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.provider).toBe('test-provider');
    });

    it('should reject invalid HMAC-SHA256 signature', () => {
      const payload = '{"event":"test","data":"value"}';
      const rawBody = Buffer.from(payload);

      const result = service.verifySignature(
        'test-provider',
        rawBody,
        'sha256=invalidsignature',
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('mismatch');
    });

    it('should reject missing signature', () => {
      const payload = '{"event":"test","data":"value"}';
      const rawBody = Buffer.from(payload);

      const result = service.verifySignature('test-provider', rawBody, '');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Missing signature');
    });

    it('should reject invalid signature format', () => {
      const payload = '{"event":"test","data":"value"}';
      const rawBody = Buffer.from(payload);

      const result = service.verifySignature(
        'test-provider',
        rawBody,
        'invalid-format',
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid signature format');
    });
  });

  describe('getRegisteredProviders', () => {
    it('should return list of registered providers', () => {
      const providers = service.getRegisteredProviders();
      expect(providers).toContain('test-provider');
    });
  });

  describe('getProviderInfo', () => {
    it('should return provider info without secrets', () => {
      const info = service.getProviderInfo('test-provider');
      expect(info).toBeDefined();
      expect(info?.name).toBe('test-provider');
      expect(info?.algorithm).toBe(WebhookSignatureAlgorithm.HMAC_SHA256);
      expect(info?.enabled).toBe(true);
      if (info) {
        expect('secret' in info).toBe(false);
      }
    });

    it('should return null for non-existent provider', () => {
      const info = service.getProviderInfo('non-existent');
      expect(info).toBeNull();
    });
  });

  describe('registerProvider', () => {
    it('should register new provider at runtime', () => {
      service.registerProvider({
        name: 'new-provider',
        algorithm: WebhookSignatureAlgorithm.HMAC_SHA512,
        secret: 'new-secret',
        enabled: true,
      });

      const providers = service.getRegisteredProviders();
      expect(providers).toContain('new-provider');
    });
  });
});
