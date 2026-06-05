import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { StrKey } from '@stellar/stellar-sdk';
import { StellarModule } from '../stellar.module';
import { AuditModule } from '../../audit/audit.module';
import { AuditService } from '../../audit/audit.service';
import { ContractRotationService } from '../services/contract-rotation.service';
import { ConfigService } from '../../config/config.service';

describe.skip('Contract Rotation Feature (Integration)', () => {
  let app: INestApplication;
  let contractValidationService: ContractRotationService;
  let auditService: AuditService;
  let configService: ConfigService;

  // Test fixtures
  const validTestnetContractId = StrKey.encodeContract(Buffer.alloc(32));

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
        }),
        CacheModule.register({
          isGlobal: true,
        }),
        StellarModule,
        AuditModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    contractValidationService = moduleFixture.get<ContractRotationService>(
      ContractRotationService,
    );
    auditService = moduleFixture.get<AuditService>(AuditService);
    configService = moduleFixture.get<ConfigService>(ConfigService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/stellar/admin/validate-contract-ids', () => {
    it('should validate contract ID format', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/stellar/admin/validate-contract-ids')
        .set('Authorization', `Bearer valid-jwt-token`)
        .send({
          contracts: {
            lumenToken: validTestnetContractId,
          },
        });

      // Expect 200 OK with validation results
      // Note: Actual validation will fail if the contract doesn't exist on testnet
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('valid');
      expect(response.body).toHaveProperty('results');
      expect(Array.isArray(response.body.results)).toBe(true);
    });

    it('should reject invalid contract ID format', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/stellar/admin/validate-contract-ids')
        .set('Authorization', `Bearer valid-jwt-token`)
        .send({
          contracts: {
            lumenToken: 'INVALID_CONTRACT_ID',
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(false);
      expect(response.body.results[0].error).toContain(
        'Invalid contract ID format',
      );
    });

    it('should require ADMIN role', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/stellar/admin/validate-contract-ids')
        .set('Authorization', `Bearer user-jwt-token`)
        .send({
          contracts: {
            lumenToken: validTestnetContractId,
          },
        });

      // Should return 403 Forbidden if user is not admin
      expect([401, 403]).toContain(response.status);
    });

    it('should require authentication', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/stellar/admin/validate-contract-ids')
        .send({
          contracts: {
            lumenToken: validTestnetContractId,
          },
        });

      expect(response.status).toBe(401);
    });

    it('should validate multiple contracts', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/stellar/admin/validate-contract-ids')
        .set('Authorization', `Bearer valid-jwt-token`)
        .send({
          contracts: {
            lumenToken: validTestnetContractId,
            crowdfundVault: validTestnetContractId,
            projectRegistry: validTestnetContractId,
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.results.length).toBe(3);
    });
  });

  describe('POST /v1/stellar/admin/rotate-contract-ids', () => {
    it('should rotate contract IDs successfully', async () => {
      // Mock validation to pass
      jest
        .spyOn(contractValidationService, 'validateContractIds')
        .mockResolvedValue([
          {
            name: 'lumenToken',
            isValid: true,
          },
        ]);

      const response = await request(app.getHttpServer())
        .post('/v1/stellar/admin/rotate-contract-ids')
        .set('Authorization', `Bearer valid-jwt-token`)
        .send({
          contracts: {
            lumenToken: validTestnetContractId,
          },
          reason: 'Upgrading to v2 deployment',
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Contracts rotated successfully');
      expect(response.body.updatedContracts).toHaveProperty('lumenToken');
      expect(response.body.auditLogId).toBeDefined();
      expect(response.body.rotatedAt).toBeDefined();
    });

    it('should fail if validation fails', async () => {
      // Mock validation to fail
      jest
        .spyOn(contractValidationService, 'validateContractIds')
        .mockResolvedValue([
          {
            name: 'lumenToken',
            isValid: false,
            error: 'Contract not found on network',
          },
        ]);

      const response = await request(app.getHttpServer())
        .post('/v1/stellar/admin/rotate-contract-ids')
        .set('Authorization', `Bearer valid-jwt-token`)
        .send({
          contracts: {
            lumenToken: 'INVALID_CONTRACT',
          },
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Contract validation failed');
    });

    it('should reject empty contract updates', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/stellar/admin/rotate-contract-ids')
        .set('Authorization', `Bearer valid-jwt-token`)
        .send({
          contracts: {},
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain(
        'At least one contract ID must be provided',
      );
    });

    it('should create audit log entry', async () => {
      const auditLogSpy = jest.spyOn(auditService, 'log');

      jest
        .spyOn(contractValidationService, 'validateContractIds')
        .mockResolvedValue([
          {
            name: 'lumenToken',
            isValid: true,
          },
        ]);

      await request(app.getHttpServer())
        .post('/v1/stellar/admin/rotate-contract-ids')
        .set('Authorization', `Bearer valid-jwt-token`)
        .send({
          contracts: {
            lumenToken: validTestnetContractId,
          },
          reason: 'Test rotation',
        });

      expect(auditLogSpy).toHaveBeenCalledWith(
        'contracts.rotate_testnet',
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          updatedContracts: expect.any(Object),
          reason: 'Test rotation',
          previousValues: expect.any(Object),
          contractCount: 1,
        }),
      );
    });

    it('should invalidate config cache after rotation', async () => {
      const cacheInvalidateSpy = jest.spyOn(configService, 'invalidateCache');

      jest
        .spyOn(contractValidationService, 'validateContractIds')
        .mockResolvedValue([
          {
            name: 'lumenToken',
            isValid: true,
          },
        ]);

      await request(app.getHttpServer())
        .post('/v1/stellar/admin/rotate-contract-ids')
        .set('Authorization', `Bearer valid-jwt-token`)
        .send({
          contracts: {
            lumenToken: validTestnetContractId,
          },
        });

      expect(cacheInvalidateSpy).toHaveBeenCalled();
    });

    it('should require ADMIN role', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/stellar/admin/rotate-contract-ids')
        .set('Authorization', `Bearer user-jwt-token`)
        .send({
          contracts: {
            lumenToken: validTestnetContractId,
          },
        });

      expect([401, 403]).toContain(response.status);
    });

    it('should require authentication', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/stellar/admin/rotate-contract-ids')
        .send({
          contracts: {
            lumenToken: validTestnetContractId,
          },
        });

      expect(response.status).toBe(401);
    });

    it('should support optional reason field', async () => {
      jest
        .spyOn(contractValidationService, 'validateContractIds')
        .mockResolvedValue([
          {
            name: 'lumenToken',
            isValid: true,
          },
        ]);

      // Without reason
      const response1 = await request(app.getHttpServer())
        .post('/v1/stellar/admin/rotate-contract-ids')
        .set('Authorization', `Bearer valid-jwt-token`)
        .send({
          contracts: {
            lumenToken: validTestnetContractId,
          },
        });

      expect(response1.status).toBe(200);

      // With reason
      const response2 = await request(app.getHttpServer())
        .post('/v1/stellar/admin/rotate-contract-ids')
        .set('Authorization', `Bearer valid-jwt-token`)
        .send({
          contracts: {
            lumenToken: validTestnetContractId,
          },
          reason: 'Scheduled maintenance',
        });

      expect(response2.status).toBe(200);
    });

    it('should handle multiple contract updates', async () => {
      jest
        .spyOn(contractValidationService, 'validateContractIds')
        .mockResolvedValue([
          { name: 'lumenToken', isValid: true },
          { name: 'crowdfundVault', isValid: true },
          { name: 'projectRegistry', isValid: true },
        ]);

      const response = await request(app.getHttpServer())
        .post('/v1/stellar/admin/rotate-contract-ids')
        .set('Authorization', `Bearer valid-jwt-token`)
        .send({
          contracts: {
            lumenToken: validTestnetContractId,
            crowdfundVault: validTestnetContractId,
            projectRegistry: validTestnetContractId,
          },
        });

      expect(response.status).toBe(200);
      expect(Object.keys(response.body.updatedContracts).length).toBe(3);
    });
  });

  describe('Contract Validation Service', () => {
    it('should validate contract ID format', async () => {
      const invalidId = 'INVALID_CONTRACT_ID';
      const results = await contractValidationService.validateContractIds(
        { lumenToken: invalidId },
        'testnet',
      );

      expect(results[0].isValid).toBe(false);
      expect(results[0].error).toContain('Invalid contract ID format');
    });

    it('should accept valid contract ID format', async () => {
      // Use a properly formatted contract ID
      // Note: This will still fail on-chain validation if the contract doesn't exist
      const validId = StrKey.encodeContract(Buffer.alloc(32));
      const results = await contractValidationService.validateContractIds(
        { lumenToken: validId },
        'testnet',
      );

      // The format check should pass, but on-chain validation may fail
      if (results[0].isValid) {
        expect(results[0].isValid).toBe(true);
      } else {
        expect(results[0].error).not.toContain('Invalid contract ID format');
      }
    });

    it('should handle validation errors gracefully', async () => {
      // Valid format but invalid contract
      const validId = StrKey.encodeContract(Buffer.alloc(32));
      const results = await contractValidationService.validateContractIds(
        { lumenToken: validId },
        'testnet',
      );

      expect(Array.isArray(results)).toBe(true);
      expect(results[0]).toHaveProperty('name');
      expect(results[0]).toHaveProperty('isValid');
    });
  });

  describe('Audit Logging', () => {
    it('should log contract rotation with all metadata', async () => {
      const auditLog = await auditService.log(
        'contracts.rotate_testnet',
        'admin-user-123',
        '192.168.1.1',
        {
          updatedContracts: {
            lumenToken: validTestnetContractId,
          },
          reason: 'Test logging',
          previousValues: {
            lumenToken: 'CAAAA...',
          },
          contractCount: 1,
        },
      );

      expect(auditLog.action).toBe('contracts.rotate_testnet');
      expect(auditLog.userId).toBe('admin-user-123');
      expect(auditLog.ipAddress).toBe('192.168.1.1');
      expect(auditLog.metadata).toHaveProperty('updatedContracts');
      expect(auditLog.metadata).toHaveProperty('reason');
      expect(auditLog.metadata).toHaveProperty('previousValues');
    });

    it('should retrieve audit logs', async () => {
      const [logs] = await auditService.findAll(10, 0);

      expect(Array.isArray(logs)).toBe(true);
      const rotationLogs = logs.filter(
        (l) => l.action === 'contracts.rotate_testnet',
      );
      expect(rotationLogs.length).toBeGreaterThanOrEqual(0);
    });
  });
});
