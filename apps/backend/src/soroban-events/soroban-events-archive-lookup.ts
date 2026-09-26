import { DataSource } from 'typeorm';

export interface EventKey {
  txHash: string;
  eventIndex: number;
}

/**
 * Given a batch of (txHash, eventIndex) keys, return the subset that already
 * exists in `soroban_events_archive`.
 *
 * Used by the indexer and replay services to avoid re-inserting rows into
 * the hot table that have already been archived. Backed by the unique
 * `(txHash, eventIndex)` index on the archive table, so this is an
 * index-only scan.
 */
export async function findArchivedKeys(
  dataSource: DataSource,
  keys: EventKey[],
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();

  const txHashes = [...new Set(keys.map((k) => k.txHash))];
  const rows = await dataSource
    .getRepository('soroban_events_archive')
    .createQueryBuilder('a')
    .select(['a.txHash AS "txHash"', 'a.eventIndex AS "eventIndex"'])
    .where('a.txHash IN (:...txHashes)', { txHashes })
    .getRawMany<{ txHash: string; eventIndex: number }>();

  const wanted = new Set(keys.map((k) => `${k.txHash}:${k.eventIndex}`));
  const found = new Set<string>();
  for (const row of rows) {
    const key = `${row.txHash}:${row.eventIndex}`;
    if (wanted.has(key)) found.add(key);
  }
  return found;
}
