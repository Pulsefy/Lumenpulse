import { storage } from './storage';

export type UserRole = 'user' | 'reviewer' | 'admin';

export const REVIEW_ROLES: readonly UserRole[] = ['reviewer', 'admin'];

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64UrlBytes(segment: string): number[] {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of normalized) {
    const index = BASE64_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('Invalid base64 segment');
    }

    value = (value << 6) | index;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }

  return bytes;
}

function decodeBase64Url(segment: string): string {
  const bytes = decodeBase64UrlBytes(segment);
  try {
    return decodeURIComponent(
      bytes.map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join(''),
    );
  } catch {
    return String.fromCharCode(...bytes);
  }
}

export function getRoleFromToken(token: string | null): UserRole | null {
  if (!token) {
    return null;
  }

  const [, payload] = token.split('.');
  if (!payload) {
    return null;
  }

  try {
    const claims = JSON.parse(decodeBase64Url(payload)) as { role?: unknown };
    const role = claims.role;
    return role === 'user' || role === 'reviewer' || role === 'admin' ? role : null;
  } catch {
    return null;
  }
}

export function isReviewerRole(role: UserRole | null): boolean {
  return role !== null && REVIEW_ROLES.includes(role);
}

export async function getCurrentUserRole(): Promise<UserRole | null> {
  try {
    const token = await storage.getAccessToken();
    return getRoleFromToken(token);
  } catch {
    return null;
  }
}
