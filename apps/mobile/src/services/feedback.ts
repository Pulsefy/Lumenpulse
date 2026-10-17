import type { Diagnostics } from '../utils/diagnostics';
import {
  createQueuedId,
  enqueueFeedback,
  markQueuedAttempt,
  removeQueuedFeedback,
} from './feedbackQueue';

export interface FeedbackSubmission {
  message: string;
  contactEmail?: string;
  diagnostics: Diagnostics;
  source: 'settings' | 'error';
}

export type FeedbackResult =
  | { status: 'sent'; id: string }
  | { status: 'queued'; id: string; reason: string };

export interface FeedbackServiceOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15000;

function resolveEndpoint(): string {
  const baseUrl =
    process.env.EXPO_PUBLIC_API_URL ??
    process.env.API_URL ??
    '';
  return `${baseUrl.replace(/\/+$/, '')}/feedback`;
}

function safeGetDiagnostics(): Diagnostics {
  try {
    // Lazy require so a broken diagnostics module cannot crash feedback flows.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../utils/diagnostics') as {
      getDiagnostics?: () => Diagnostics;
    };
    if (typeof mod.getDiagnostics === 'function') {
      return mod.getDiagnostics();
    }
  } catch {
    // fall through to empty diagnostics
  }
  return { release: 'unknown', environment: 'unknown' } as Diagnostics;
}

export function buildSubmission(
  message: string,
  source: FeedbackSubmission['source'],
  contactEmail?: string,
): FeedbackSubmission {
  return {
    message: message.trim(),
    contactEmail: contactEmail?.trim() || undefined,
    diagnostics: safeGetDiagnostics(),
    source,
  };
}

async function postSubmission(
  id: string,
  submission: FeedbackSubmission,
  options: FeedbackServiceOptions,
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(options.endpoint ?? resolveEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...submission }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Feedback submission failed with status ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function submitFeedback(
  submission: FeedbackSubmission,
  options: FeedbackServiceOptions = {},
): Promise<FeedbackResult> {
  const id = createQueuedId();
  try {
    await postSubmission(id, submission, options);
    return { status: 'sent', id };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Network unavailable';
    await enqueueFeedback(id, submission);
    await markQueuedAttempt(id, reason);
    return { status: 'queued', id, reason };
  }
}

export async function flushFeedbackQueue(
  options: FeedbackServiceOptions = {},
): Promise<number> {
  const { getQueuedFeedback } = await import('./feedbackQueue');
  const queue = await getQueuedFeedback();
  let flushed = 0;
  for (const item of queue) {
    try {
      await postSubmission(item.id, item.submission, options);
      await removeQueuedFeedback(item.id);
      flushed += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Network unavailable';
      await markQueuedAttempt(item.id, reason);
    }
  }
  return flushed;
}
