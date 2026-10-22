import AsyncStorage from '@community/async-storage';

import type { FeedbackSubmission } from './feedback';

const QUEUE_KEY = '@mobile/feedback-queue/v1';

export interface QueuedFeedback {
  id: string;
  submission: FeedbackSubmission;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

async function readQueue(): Promise<QueuedFeedback[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as unknown[]).filter(
      (item): item is QueuedFeedback =>
        !!item && typeof item === 'object' && 'id' in item && 'submission' in item,
    );
  } catch {
    return [];
  }
}

async function writeQueue(items: QueuedFeedback[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export function createQueuedId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function enqueueFeedback(
  id: string,
  submission: FeedbackSubmission,
): Promise<void> {
  const queue = await readQueue();
  if (queue.some((item) => item.id === id)) return;
  queue.push({
    id,
    submission,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  await writeQueue(queue);
}

export async function getQueuedCount(): Promise<number> {
  const queue = await readQueue();
  return queue.length;
}

export async function getQueuedFeedback(): Promise<QueuedFeedback[]> {
  return readQueue();
}

export async function removeQueuedFeedback(id: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.filter((item) => item.id !== id));
}

export async function markQueuedAttempt(
  id: string,
  error?: string,
): Promise<void> {
  const queue = await readQueue();
  const next = queue.map((item) =>
    item.id === id
      ? { ...item, attempts: item.attempts + 1, lastError: error }
      : item,
  );
  await writeQueue(next);
}
