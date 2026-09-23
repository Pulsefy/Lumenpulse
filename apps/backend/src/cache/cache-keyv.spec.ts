import Keyv from 'keyv';
import { createCache } from 'cache-manager';
import { CacheService } from './cache.service';

describe('CacheService cache-manager v7 key discovery', () => {
  it('invalidates namespaced Keyv entries through the real iterator shape', async () => {
    const store = new Keyv({ namespace: 'lumenpulse' });
    const manager = await Promise.resolve(createCache({ stores: [store] }));
    const service = new CacheService(manager);

    await manager.set('news:latest:lang=EN', { value: 1 });
    await manager.set('news:latest:tag=stellar', { value: 2 });
    await manager.set('stellar:config', { value: 3 });

    await service.invalidateNewsCache();

    await expect(manager.get('news:latest:lang=EN')).resolves.toBeUndefined();
    await expect(
      manager.get('news:latest:tag=stellar'),
    ).resolves.toBeUndefined();
    await expect(manager.get('stellar:config')).resolves.toEqual({ value: 3 });

    await manager.set('contracts:capabilities:C-ONE', { value: 4 });
    await manager.set('contract:read:C-ONE:get_state:e30=', { value: 5 });
    await service.invalidateConfigCaches();

    await expect(
      manager.get('contracts:capabilities:C-ONE'),
    ).resolves.toBeUndefined();
    await expect(
      manager.get('contract:read:C-ONE:get_state:e30='),
    ).resolves.toBeUndefined();
  });
});
