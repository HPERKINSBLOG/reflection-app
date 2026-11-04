import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { fixture } from '../fixtures/revisits.ts';
import { clearDatabase } from '../fixtures/database.ts';
beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));
test('native identities survive a changed export snapshot, and historical snapshot aliases require the exact owned revision', async () => {
  const f = await fixture();
  const get = async () =>
    f.exports.page(f.session, (await f.exports.create(f.session, crypto.randomUUID())).id, null);
  const first = await get();
  await f.client.permission(false);
  const second = await get();
  const find = (records: typeof first.records) => records.find((r) => r.kind === 'reading')!;
  expect(first.snapshotRevision).not.toBe(second.snapshotRevision);
  const reading = find(first.records);
  expect(find(second.records)).toEqual(reading);
  expect(reading.identity.source.revision).toBe('native-v1');
  expect(await f.exports.nativeRecord(f.session, reading.identity)).toEqual(reading);
  const legacy = {
    ...reading.identity,
    source: { ...reading.identity.source, revision: 'snapshot-' + first.snapshotRevision },
  };
  expect(await f.exports.nativeRecord(f.session, legacy)).toEqual({ ...reading, identity: legacy });
  expect(await f.exports.nativeRecord(f.session, { ...legacy, recordRevision: 99 })).toBeNull();
  expect(
    await f.exports.nativeRecord(f.session, {
      ...legacy,
      source: { ...legacy.source, namespaceId: crypto.randomUUID() },
    }),
  ).toBeNull();
});
