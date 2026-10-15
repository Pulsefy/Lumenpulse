import {
  BOT_TOKEN_HEADER,
  BotPrincipalService,
  SERVICE_TOKEN_HEADER,
} from './bot-principal.service';

describe('BotPrincipalService', () => {
  const service = new BotPrincipalService({
    botTokens: 'telegram-bot:bot-secret, discord-bot:other-secret',
    serviceTokens: 'data-processing:svc-secret,malformed,:nope,empty:',
  });

  it('authenticates bot principals from X-Bot-Token', () => {
    expect(
      service.authenticateHeaders({ [BOT_TOKEN_HEADER]: 'bot-secret' }),
    ).toEqual({ type: 'bot', id: 'telegram-bot' });
    expect(
      service.authenticateHeaders({ [BOT_TOKEN_HEADER]: 'other-secret' }),
    ).toEqual({ type: 'bot', id: 'discord-bot' });
  });

  it('authenticates service principals from X-Service-Token', () => {
    expect(
      service.authenticateHeaders({ [SERVICE_TOKEN_HEADER]: 'svc-secret' }),
    ).toEqual({ type: 'service', id: 'data-processing' });
  });

  it('does not accept a bot token as a service credential (or vice versa)', () => {
    expect(
      service.authenticateHeaders({ [SERVICE_TOKEN_HEADER]: 'bot-secret' }),
    ).toBeNull();
    expect(
      service.authenticateHeaders({ [BOT_TOKEN_HEADER]: 'svc-secret' }),
    ).toBeNull();
  });

  it('rejects unknown tokens and ignores malformed config entries', () => {
    expect(
      service.authenticateHeaders({ [BOT_TOKEN_HEADER]: 'wrong' }),
    ).toBeNull();
    expect(
      service.authenticateHeaders({ [SERVICE_TOKEN_HEADER]: 'nope' }),
    ).toBeNull();
    expect(service.authenticateHeaders({})).toBeNull();
    expect(service.authenticateHeaders(undefined)).toBeNull();
  });

  it('is inert when no credentials are configured', () => {
    const empty = new BotPrincipalService({});
    expect(empty.isConfigured).toBe(false);
    expect(
      empty.authenticateHeaders({ [BOT_TOKEN_HEADER]: 'anything' }),
    ).toBeNull();
  });

  it('classifies verified JWT payloads with a bot/service type claim', () => {
    expect(service.fromVerifiedJwtPayload({ sub: 'b1', type: 'bot' })).toEqual({
      type: 'bot',
      id: 'b1',
    });
    expect(
      service.fromVerifiedJwtPayload({ sub: 's1', type: 'SERVICE' }),
    ).toEqual({ type: 'service', id: 's1' });
    expect(
      service.fromVerifiedJwtPayload({ sub: 'u1', type: 'access' }),
    ).toBeNull();
    expect(service.fromVerifiedJwtPayload({ type: 'bot' })).toBeNull();
    expect(service.fromVerifiedJwtPayload(null)).toBeNull();
  });
});
