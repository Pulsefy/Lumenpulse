import * as fs from 'fs';
import * as path from 'path';

import {
  CanonicalEventType,
  EventCategory,
  getCategory,
} from '../common/event-catalog';
import { mapSorobanEvent } from './soroban-event-mapper';

/**
 * Golden-payload fixtures for event-versioned contract events (issue #1623).
 *
 * The on-chain side writes one fixture per event under
 * `apps/onchain/contracts/event-golden/fixtures/<contract>/<event>.v<N>.json`
 * (see `apps/onchain/contracts/event-golden/README.md`). This suite consumes
 * those same files: it pins the decoded event name the indexer will see, and
 * asserts the backend mapper still maps every one of them. If a contract
 * changes an event without bumping its version, the on-chain golden test
 * fails first; if an event is renamed, this test fails because the mapper
 * returns `null` for the new topic.
 */

interface GoldenFixture {
  contract: string;
  event: string;
  version: number;
  topics_xdr: string[];
  data_xdr: string;
  topics: unknown[];
  fields: Record<string, unknown>;
}

const FIXTURES_ROOT = path.resolve(
  __dirname,
  '../../../onchain/contracts/event-golden/fixtures',
);

function loadFixtures(): Array<{ file: string; fixture: GoldenFixture }> {
  const fixtures: Array<{ file: string; fixture: GoldenFixture }> = [];
  for (const contractEntry of fs.readdirSync(FIXTURES_ROOT, {
    withFileTypes: true,
  })) {
    if (!contractEntry.isDirectory()) continue;
    const contractDir = path.join(FIXTURES_ROOT, contractEntry.name);
    for (const file of fs.readdirSync(contractDir).sort()) {
      if (!file.endsWith('.json')) continue;
      const fullPath = path.join(contractDir, file);
      const fixture = JSON.parse(
        fs.readFileSync(fullPath, 'utf8'),
      ) as GoldenFixture;
      fixtures.push({ file: path.relative(FIXTURES_ROOT, fullPath), fixture });
    }
  }
  return fixtures;
}

const isBase64 = (value: string): boolean =>
  value.length > 0 &&
  value.length % 4 === 0 &&
  /^[A-Za-z0-9+/]*={0,2}$/.test(value);

const fixtures = loadFixtures();

describe('event golden fixtures (contract -> backend mapper)', () => {
  it('finds the event-versioned fixture corpus', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(18);

    const contracts = new Set(fixtures.map(({ fixture }) => fixture.contract));
    expect(contracts).toEqual(new Set(['treasury', 'lumenpulse-curation']));
  });

  it('uses unique (contract, event, version) fixture coordinates', () => {
    const seen = new Set<string>();
    for (const { fixture } of fixtures) {
      const key = `${fixture.contract}/${fixture.event}.v${fixture.version}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it.each(fixtures)(
    '$file has a versioned, well-formed payload',
    ({ fixture }) => {
      expect(typeof fixture.contract).toBe('string');
      expect(fixture.contract.length).toBeGreaterThan(0);
      expect(typeof fixture.event).toBe('string');
      expect(Number.isInteger(fixture.version)).toBe(true);
      expect(fixture.version).toBeGreaterThanOrEqual(1);

      expect(Array.isArray(fixture.topics)).toBe(true);
      // Topic 0 is always the event-name topic; topic 1 is the schema version.
      expect(fixture.topics[0]).toBe(fixture.event);
      expect(fixture.topics[1]).toBe(fixture.version);

      expect(Array.isArray(fixture.topics_xdr)).toBe(true);
      expect(fixture.topics_xdr.length).toBe(fixture.topics.length);
      for (const xdr of fixture.topics_xdr) {
        expect(isBase64(xdr)).toBe(true);
      }
      expect(isBase64(fixture.data_xdr)).toBe(true);

      expect(fixture.fields).toBeTruthy();
      expect(typeof fixture.fields).toBe('object');
    },
  );

  it.each(fixtures)('$file maps to a canonical event type', ({ fixture }) => {
    const mapping = mapSorobanEvent(fixture.event);

    expect(mapping).not.toBeNull();
    expect(Object.values(CanonicalEventType)).toContain(mapping!.canonicalType);
    expect(Object.values(EventCategory)).toContain(mapping!.category);
    expect(mapping!.category).toBe(getCategory(mapping!.canonicalType));
  });
});
