import { JwtService } from '@nestjs/jwt';
import { BotPrincipalService } from '../../bot-auth/bot-principal.service';
import { RATE_LIMIT_PRINCIPAL_REQUEST_KEY } from './rate-limit.constants';
import { RateLimitPrincipalResolver } from './rate-limit.principal';

describe('RateLimitPrincipalResolver', () => {
  const secret = 'principal-spec-secret';
  const jwt = new JwtService({ secret });
  const resolver = new RateLimitPrincipalResolver(
    new BotPrincipalService({
      botTokens: 'tg:bot-secret',
      serviceTokens: 'etl:svc-secret',
    }),
    secret,
  );

  const req = (headers: Record<string, string> = {}, extra = {}) => ({
    headers,
    ip: '10.0.0.1',
    ...extra,
  });

  it('resolves a user from a valid Bearer JWT', () => {
    const token = jwt.sign({ sub: 'user-1', type: 'access' });
    expect(
      resolver.resolve(
        req({ authorization: `Bearer ${token}` }),
        'ip:10.0.0.1',
      ),
    ).toEqual({ type: 'user', id: 'user-1', trackerKey: 'user:user-1' });
  });

  it('falls back to the source address for invalid or expired tokens', () => {
    const forged = new JwtService({ secret: 'other' }).sign({ sub: 'x' });
    const expired = jwt.sign({ sub: 'user-1' }, { expiresIn: -10 });

    for (const token of [forged, expired, 'garbage']) {
      expect(
        resolver.resolve(
          req({ authorization: `Bearer ${token}` }),
          'ip:10.0.0.1',
        ),
      ).toEqual({
        type: 'anonymous',
        id: 'ip:10.0.0.1',
        trackerKey: 'ip:10.0.0.1',
      });
    }
  });

  it('resolves bot and service principals through bot-auth', () => {
    expect(
      resolver.resolve(req({ 'x-bot-token': 'bot-secret' }), 'ip:10.0.0.1'),
    ).toEqual({ type: 'bot', id: 'tg', trackerKey: 'bot:tg' });
    expect(
      resolver.resolve(req({ 'x-service-token': 'svc-secret' }), 'ip:10.0.0.1'),
    ).toEqual({ type: 'service', id: 'etl', trackerKey: 'service:etl' });
  });

  it('classifies bot-typed JWTs as bot principals', () => {
    const token = jwt.sign({ sub: 'tg-2', type: 'bot' });
    expect(
      resolver.resolve(req({ authorization: `Bearer ${token}` }), 'ip:x'),
    ).toEqual({ type: 'bot', id: 'tg-2', trackerKey: 'bot:tg-2' });
  });

  it('prefers an already-authenticated req.user', () => {
    expect(
      resolver.resolve(req({}, { user: { id: 'u-9' } }), 'ip:10.0.0.1'),
    ).toEqual({ type: 'user', id: 'u-9', trackerKey: 'user:u-9' });
  });

  it('caches the resolved principal on the request', () => {
    const token = jwt.sign({ sub: 'cached' });
    const request: Record<string, unknown> = req({
      authorization: `Bearer ${token}`,
    });
    const first = resolver.resolve(request, 'ip:10.0.0.1');
    expect(request[RATE_LIMIT_PRINCIPAL_REQUEST_KEY]).toBe(first);
    expect(resolver.resolve(request, 'ip:other')).toBe(first);
  });
});
