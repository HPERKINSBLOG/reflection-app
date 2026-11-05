import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { readingAccount, ReadingClient } from '../fixtures/reading-client.ts';
import { clearDatabase } from '../fixtures/database.ts';
import parity from '../fixtures/astrology-node-parity.json';
beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));
const place = {
  source: 'manual',
  label: 'New York',
  latitudeDeg: 40.7,
  longitudeEastDeg: -74,
  zone: 'America/New_York',
};
test('birth endpoints enforce authentication, CSRF, recovery acknowledgement and bounded no-store bodies', async () => {
  const anonymous = new ReadingClient();
  expect((await anonymous.request('/astrology/profile')).status).toBe(401);
  const { client } = await readingAccount(false, false),
    request = { birth: parity[0]!.input.birth, expectedRevision: 0, confirmedRetention: true };
  expect(
    (
      await client.request('/astrology/profile', request, {
        method: 'PUT',
        headers: { 'X-CSRF-Token': 'wrong' },
      })
    ).status,
  ).toBe(403);
  expect((await client.request('/astrology/profile', request, { method: 'PUT' })).status).toBe(403);
  await client.acknowledge();
  const created = await client.request('/astrology/profile', request, { method: 'PUT' });
  expect(created.status).toBe(200);
  expect(created.headers.get('Cache-Control')).toBe('private, no-store');
  expect(
    (await client.request('/astrology/places/search', { query: 'x'.repeat(33000) })).status,
  ).toBe(413);
  const search = await client.request('/astrology/places/search', { query: 'Portland' });
  expect(search.status).toBe(200);
  expect(((await search.json()) as { items: unknown[] }).items.length).toBeGreaterThan(1);
  const preview = await client.request('/astrology/pattern');
  expect(preview.status).toBe(200);
});
test('fold and gap reviews have explicit resolution states without saving personal data', async () => {
  const { client, kit } = await readingAccount(true, false);
  for (const [date, time, kind] of [
    ['2024-11-03', '01:30', 'fold'],
    ['2024-03-10', '02:30', 'gap'],
  ]) {
    const response = await client.request('/astrology/birth/resolve', {
      ...parity[0]!.input.birth,
      date,
      place,
      time: { certainty: 'exact', localTime: time },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ kind });
  }
  expect(
    await env.DB.prepare('SELECT count(*) n FROM birth_profiles WHERE owner_id=?')
      .bind(kit.subjectId)
      .first('n'),
  ).toBe(0);
});
