import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { BirthProfiles } from '../../src/worker/astrology/profiles.ts';
import { fixture } from '../fixtures/revisits.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { BirthDraft } from '../../src/contracts/astrology.ts';
import parity from '../fixtures/astrology-node-parity.json';
const birth = BirthDraft.parse(parity[0]!.input.birth);
beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));
test('profiles require an explicit save, preserve revision conflicts and isolate owners', async () => {
  const f = await fixture(),
    profiles = new BirthProfiles(f.base),
    key = crypto.randomUUID();
  expect(await profiles.read(f.session)).toEqual({ profile: null, revision: 0 });
  const input = { birth, expectedRevision: 0, confirmedRetention: true as const };
  const saved = await profiles.write(f.session, input, key);
  expect(saved.profile?.birth).toEqual(birth);
  expect(await profiles.write(f.session, input, key)).toEqual(saved);
  await expect(
    profiles.write(f.session, { ...input, birth: { ...birth, date: '2001-01-01' } }, key),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_MISMATCH' });
  await expect(profiles.write(f.session, input, crypto.randomUUID())).rejects.toMatchObject({
    code: 'CONFLICT',
    revision: 1,
  });
  const other = await fixture();
  expect(await profiles.read(other.session)).toEqual({ profile: null, revision: 0 });
  const replacement = await profiles.write(
    f.session,
    { ...input, expectedRevision: 1, birth: { ...birth, date: '2001-01-01' } },
    crypto.randomUUID(),
  );
  expect(replacement.revision).toBe(2);
  expect(replacement.profile?.id).toBe(saved.profile?.id);
  expect(
    await env.DB.prepare('SELECT count(*) n FROM birth_profiles WHERE owner_id=?')
      .bind(f.session.subjectId)
      .first('n'),
  ).toBe(1);
});
test('unresolved civil times and missing retention acknowledgement never persist a profile', async () => {
  const f = await fixture(),
    profiles = new BirthProfiles(f.base);
  const gap = {
    ...birth,
    date: '2024-03-10',
    place: {
      source: 'manual' as const,
      label: 'New York',
      latitudeDeg: 40.7,
      longitudeEastDeg: -74,
      zone: 'America/New_York',
    },
    time: { certainty: 'exact' as const, localTime: '02:30' },
  };
  await expect(
    profiles.write(
      f.session,
      { birth: gap, expectedRevision: 0, confirmedRetention: true },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'BAD_INPUT' });
  await expect(
    profiles.write(
      f.session,
      { birth, expectedRevision: 0, confirmedRetention: false },
      crypto.randomUUID(),
    ),
  ).rejects.toThrow();
  expect(await profiles.read(f.session)).toEqual({ profile: null, revision: 0 });
});
