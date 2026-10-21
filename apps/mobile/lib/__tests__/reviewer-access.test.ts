import { getRoleFromToken, isReviewerRole } from '../reviewer-access';

const b64url = (value: string): string =>
  Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const tokenWith = (claims: Record<string, unknown>): string =>
  `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(claims))}.signature`;

describe('reviewer-access', () => {
  it('reads the role claim from a JWT payload', () => {
    expect(getRoleFromToken(tokenWith({ sub: '1', role: 'reviewer' }))).toBe('reviewer');
    expect(getRoleFromToken(tokenWith({ sub: '1', role: 'admin' }))).toBe('admin');
    expect(getRoleFromToken(tokenWith({ sub: '1', role: 'user' }))).toBe('user');
  });

  it('decodes payloads containing multi-byte characters', () => {
    expect(getRoleFromToken(tokenWith({ email: 'josé@example.com', role: 'reviewer' }))).toBe(
      'reviewer',
    );
  });

  it('returns null for missing, malformed or unknown roles', () => {
    expect(getRoleFromToken(null)).toBeNull();
    expect(getRoleFromToken('')).toBeNull();
    expect(getRoleFromToken('not-a-jwt')).toBeNull();
    expect(getRoleFromToken('a.%%%.c')).toBeNull();
    expect(getRoleFromToken(tokenWith({ sub: '1' }))).toBeNull();
    expect(getRoleFromToken(tokenWith({ role: 'superuser' }))).toBeNull();
  });

  it('treats reviewer and admin as review roles and everyone else as hidden', () => {
    expect(isReviewerRole('reviewer')).toBe(true);
    expect(isReviewerRole('admin')).toBe(true);
    expect(isReviewerRole('user')).toBe(false);
    expect(isReviewerRole(null)).toBe(false);
  });
});
