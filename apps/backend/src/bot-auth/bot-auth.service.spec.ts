import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BotAuthService } from './bot-auth.service';
import { AuditService } from '../audit/audit.service';
import { BotActionType } from './types';

describe('BotAuthService', () => {
  let service: BotAuthService;
  let auditService: jest.Mocked<AuditService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockAuditService = {
      log: jest.fn(),
    };
    const mockConfigService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BotAuthService,
        { provide: AuditService, useValue: mockAuditService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<BotAuthService>(BotAuthService);
    auditService = module.get(AuditService);
    configService = module.get(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should authorize safe read commands and log them', async () => {
    const result = await service.authorizeCommand(
      '/price XLM',
      '123',
      'testuser',
    );
    expect(result).toBe(true);
    expect(auditService.log).toHaveBeenCalledWith(
      'GET_PRICE',
      '123',
      null,
      expect.objectContaining({
        command: '/price XLM',
        username: 'testuser',
        type: BotActionType.READ,
        status: 'SUCCESS',
        actor: 'bot',
      }),
    );
  });

  it('should reject unknown commands and log them', async () => {
    const result = await service.authorizeCommand(
      '/unknown',
      '123',
      'testuser',
    );
    expect(result).toBe(false);
    expect(auditService.log).toHaveBeenCalledWith(
      'UNKNOWN_COMMAND',
      '123',
      null,
      expect.objectContaining({
        command: '/unknown',
        username: 'testuser',
        actor: 'bot',
      }),
    );
  });

  it('should reject unauthorized privileged commands', async () => {
    configService.get.mockReturnValue('456,789'); // admin chat IDs
    const result = await service.authorizeCommand(
      '/broadcast Hello',
      '123',
      'testuser',
    );
    expect(result).toBe(false);
    expect(auditService.log).toHaveBeenCalledWith(
      'ADMIN_BROADCAST',
      '123',
      null,
      expect.objectContaining({
        command: '/broadcast Hello',
        username: 'testuser',
        type: BotActionType.PRIVILEGED,
        status: 'DENIED',
        reason: 'Admin privileges required',
        actor: 'bot',
      }),
    );
  });

  it('should authorize privileged commands for admins', async () => {
    configService.get.mockReturnValue('123,456'); // admin chat IDs
    const result = await service.authorizeCommand(
      '/broadcast Hello',
      '123',
      'testuser',
    );
    expect(result).toBe(true);
    expect(auditService.log).toHaveBeenCalledWith(
      'ADMIN_BROADCAST',
      '123',
      null,
      expect.objectContaining({
        command: '/broadcast Hello',
        username: 'testuser',
        type: BotActionType.PRIVILEGED,
        status: 'SUCCESS',
        actor: 'bot',
      }),
    );
  });

  it('should deny mutation commands from untrusted chats when trusted mutation config is set', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'ADMIN_CHAT_IDS') return '456,789';
      if (key === 'TRUSTED_MUTATION_CHAT_IDS') return '123';
      return undefined;
    });

    const result = await service.authorizeCommand(
      '/subscribe XLM',
      '999',
      'testuser',
    );

    expect(result).toBe(false);
    expect(auditService.log).toHaveBeenCalledWith(
      'SUBSCRIBE_ALERT',
      '999',
      null,
      expect.objectContaining({
        command: '/subscribe XLM',
        username: 'testuser',
        type: BotActionType.MUTATION,
        status: 'DENIED',
        reason: 'Trusted chat required for mutation actions',
        actor: 'bot',
      }),
    );
  });
});
