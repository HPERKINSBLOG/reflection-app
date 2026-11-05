import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { fixture } from '../fixtures/revisits.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { ReadingRecords } from '../../src/worker/readings/records.ts';

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));
test('journal filters before pagination and binds method and owner into the cursor', async () => {
  const f = await fixture(),
    records = new ReadingRecords(f.base);
  for (const method of ['tarot', 'astrology', 'imported']) {
    for (let i = 0; i < 7; i++) {
      const id = crypto.randomUUID();
      const body = await f.base.crypt.seal(
        {
          ownerId: f.session.subjectId,
          table: 'reading_sessions',
          column: 'question_enc',
          recordId: id,
          aadRevision: 1,
        },
        { v: 1, text: `${method} ${i}` },
        1,
      );
      await env.DB.prepare(
        "INSERT INTO reading_sessions(id,owner_id,status,revision,created_at,saved_at,method,question_enc) VALUES(?,?,'saved',1,?,?,?,?)",
      )
        .bind(id, f.session.subjectId, 1000 + i, 1000 + i, method, body)
        .run();
    }
  }
  const all = await records.history(f.session, 'saved', 50);
  expect(all.items.filter((i) => i.method === 'astrology')).toHaveLength(7);
  expect(all.items.filter((i) => i.method === 'imported')).toHaveLength(7);
  const first = await records.history(f.session, 'saved', 2, null, 'astrology');
  expect(first.items).toHaveLength(2);
  expect(first.items.every((i) => i.method === 'astrology')).toBe(true);
  await expect(
    records.history(f.session, 'saved', 2, first.nextCursor, 'tarot'),
  ).rejects.toMatchObject({ code: 'BAD_INPUT' });
  const other = await fixture();
  await expect(
    new ReadingRecords(other.base).history(
      other.session,
      'saved',
      2,
      first.nextCursor,
      'astrology',
    ),
  ).rejects.toMatchObject({ code: 'BAD_INPUT' });
  const ids = first.items.map((i) => i.id);
  let cursor = first.nextCursor;
  while (cursor) {
    const page = await records.history(f.session, 'saved', 2, cursor, 'astrology');
    ids.push(...page.items.map((i) => i.id));
    cursor = page.nextCursor;
  }
  expect(ids).toHaveLength(7);
  expect(new Set(ids).size).toBe(7);
  await expect(records.history(f.session, 'saved', 20, null, 'notes')).rejects.toMatchObject({
    code: 'BAD_INPUT',
  });
});
