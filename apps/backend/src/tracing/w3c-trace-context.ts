import { randomBytes } from 'node:crypto';

/**
 * W3C Trace Context specification constants
 * https://www.w3.org/TR/trace-context/
 */
export const W3C_TRACEPARENT_HEADER = 'traceparent';
export const W3C_TRACESTATE_HEADER = 'tracestate';

const TRACEPARENT_REGEX = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export interface ParsedTraceparent {
  version: string;
  traceId: string;
  parentSpanId: string;
  traceFlags: string;
  sampled: boolean;
}

/**
 * Parses a standard W3C `traceparent` header.
 * Expected format: `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`
 */
export function parseTraceparent(
  header?: string | string[],
): ParsedTraceparent | null {
  if (!header) return null;
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return null;

  const match = TRACEPARENT_REGEX.exec(value.trim().toLowerCase());
  if (!match) return null;

  const [, traceId, parentSpanId, traceFlags] = match;

  // Validate that traceId and parentSpanId are not all zeros
  if (/^0{32}$/.test(traceId) || /^0{16}$/.test(parentSpanId)) {
    return null;
  }

  const flagsNumber = parseInt(traceFlags, 16);
  const sampled = (flagsNumber & 0x01) === 0x01;

  return {
    version: '00',
    traceId,
    parentSpanId,
    traceFlags,
    sampled,
  };
}

/**
 * Formats trace parameters into a compliant W3C `traceparent` header.
 */
export function formatTraceparent(
  traceId: string,
  spanId: string,
  sampled: boolean = false,
): string {
  const flags = sampled ? '01' : '00';
  return `00-${traceId.padStart(32, '0')}-${spanId.padStart(16, '0')}-${flags}`;
}

/**
 * Generates a compliant 16-byte random trace ID (32 hex characters).
 */
export function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Generates a compliant 8-byte random span ID (16 hex characters).
 */
export function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}
