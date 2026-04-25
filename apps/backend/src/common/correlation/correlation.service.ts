import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

@Injectable()
export class CorrelationService {
  private static readonly storage = new AsyncLocalStorage<string>();

  runWithId(
    id: string,
    callback: () => void | Promise<void>,
  ): void | Promise<void> {
    return CorrelationService.storage.run(id, callback);
  }

  getCorrelationId(): string | undefined {
    return CorrelationService.storage.getStore();
  }
}
