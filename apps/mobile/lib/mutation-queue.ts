import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PendingMutation {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

const MUTATION_QUEUE_KEY = 'pending_mutation_queue';

export const mutationQueue = {
  async getQueue(): Promise<PendingMutation[]> {
    try {
      const raw = await AsyncStorage.getItem(MUTATION_QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  async enqueue(mutation: Omit<PendingMutation, 'id' | 'createdAt'>): Promise<void> {
    const queue = await this.getQueue();
    const item: PendingMutation = {
      ...mutation,
      id: Math.random().toString(36).substring(2, 9),
      createdAt: new Date().toISOString(),
    };
    queue.push(item);
    await AsyncStorage.setItem(MUTATION_QUEUE_KEY, JSON.stringify(queue));
  },

  async dequeue(): Promise<PendingMutation | null> {
    const queue = await this.getQueue();
    if (queue.length === 0) return null;
    const [head, ...rest] = queue;
    await AsyncStorage.setItem(MUTATION_QUEUE_KEY, JSON.stringify(rest));
    return head;
  },

  async clear(): Promise<void> {
    await AsyncStorage.removeItem(MUTATION_QUEUE_KEY);
  },
};
