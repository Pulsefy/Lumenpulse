import { BadRequestException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { SecretRotationService } from './secret-rotation.service';

const NAME = 'CONTRACT_ADMIN_API_KEY';

const createAudit = () => ({
  log: jest.fn().mockResolvedValue({ id: 'audit-log-1' }),
});

const createService = (audit = createAudit()) =>
  new SecretRotationService(audit as unknown as AuditService);

const versionOf = (service: SecretRotationService): number =>
  service.getStatus().find((status) => status.name === NAME)?.version ?? 0;

describe('SecretRotationService', () => {
  it('rejects secrets that are not rotatable', async () => {
    const service = createService();

    await expect(
      service.rotate('NOT_A_SECRET', 'value', { actor: 'ops' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an empty value', async () => {
    const service = createService();

    await expect(
      service.rotate(NAME, '   ', { actor: 'ops' }),
    ).rejects.toThrow(/must not be empty/);
  });

  it('requires an actor', async () => {
    const service = createService();

    await expect(
      service.rotate(NAME, 'value', { actor: '' }),
    ).rejects.toThrow(/actor is required/i);
  });

  it('validates the overlap window', async () => {
    const service = createService();

    await expect(
      service.rotate(NAME, 'value', { actor: 'ops', overlapMs: -1 }),
    ).rejects.toThrow(/overlapMs/);
  });

  it('accepts both the old and the new value during the overlap window', async () => {
    const service = createService();
    const before = versionOf(service);

    const first = await service.rotate(NAME, 'new-secret-value', {
      actor: 'ops',
      overlapMs: 60_000,
    });
    expect(first.version).toBe(before + 1);
    expect(service.verify(NAME, 'new-secret-value')).toBe(true);

    const second = await service.rotate(NAME, 'newer-secret-value', {
      actor: 'ops',
      overlapMs: 60_000,
    });
    expect(second.version).toBe(before + 2);
    expect(second.previousSecretIds).toContain(first.secretId);
    expect(service.verify(NAME, 'newer-secret-value')).toBe(true);
    expect(service.verify(NAME, 'new-secret-value')).toBe(true);
  });

  it('drops the previous value once the overlap window elapses', async () => {
    const service = createService();

    await service.rotate(NAME, 'first-value', {
      actor: 'ops',
      overlapMs: 60_000,
    });
    await service.rotate(NAME, 'second-value', {
      actor: 'ops',
      overlapMs: 0,
    });

    expect(service.verify(NAME, 'second-value')).toBe(true);
    expect(service.verify(NAME, 'first-value')).toBe(false);
    expect(
      service.getStatus().find((status) => status.name === NAME)
        ?.previousSecretIds,
    ).toEqual([]);
  });

  it('rejects values that are not in the acceptable set', async () => {
    const service = createService();

    await service.rotate(NAME, 'only-value', { actor: 'ops' });

    expect(service.verify(NAME, 'other-value')).toBe(false);
    expect(service.verify(NAME, '')).toBe(false);
  });

  it('audits actor and overlap but never the secret value', async () => {
    const audit = createAudit();
    const service = createService(audit);

    await service.rotate(NAME, 'super-secret-value', {
      actor: 'security-team',
      ipAddress: '203.0.113.7',
      reason: 'quarterly rotation',
      overlapMs: 120_000,
    });

    expect(audit.log).toHaveBeenCalledTimes(1);
    const [action, userId, ipAddress, metadata] = audit.log.mock.calls[0];
    expect(action).toBe('secrets.rotate');
    expect(userId).toBe('security-team');
    expect(ipAddress).toBe('203.0.113.7');

    expect(JSON.stringify({ metadata })).not.toContain('super-secret-value');
    expect(metadata).toMatchObject({
      secretName: NAME,
      overlapMs: 120_000,
      reason: 'quarterly rotation',
    });
  });

  it('rolls the swap back when the audit write fails', async () => {
    const audit = createAudit();
    const service = createService(audit);

    await service.rotate(NAME, 'first-value', { actor: 'ops' });

    audit.log.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(
      service.rotate(NAME, 'second-value', { actor: 'ops' }),
    ).rejects.toThrow('audit unavailable');

    expect(service.verify(NAME, 'first-value')).toBe(true);
    expect(service.verify(NAME, 'second-value')).toBe(false);
  });

  it('never exposes values through the status endpoint', async () => {
    const service = createService();

    await service.rotate(NAME, 'do-not-leak-me', { actor: 'ops' });

    expect(JSON.stringify(service.getStatus())).not.toContain(
      'do-not-leak-me',
    );
  });

  it('parses an untrusted rotation payload', () => {
    const service = createService();

    expect(
      service.parseRotationRequest({ name: NAME, value: 'v', actor: 'ops' }),
    ).toEqual({ name: NAME, value: 'v', actor: 'ops' });
    expect(() => service.parseRotationRequest({ name: NAME })).toThrow(
      BadRequestException,
    );
  });
});
