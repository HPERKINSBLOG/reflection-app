import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { apiSchemas, HistoryItem } from '../../src/contracts/index.ts';
import { ReadingRecords } from '../../src/worker/readings/records.ts';
import { Reflections } from '../../src/worker/readings/reflections.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { fixture, note } from '../fixtures/revisits.ts';

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));

type Fixture = Awaited<ReturnType<typeof fixture>>;
const row = async (f: Fixture) =>
  (await new ReadingRecords(f.base).history(f.session)).items.find(
    (item) => item.id === f.started.sessionId,
  )!;
const write = (f: Fixture, text: string, edit?: { id: string; revision: number }) =>
  new Reflections(f.base).write(
    f.session,
    f.started.sessionId,
    apiSchemas.ReflectionWrite.parse({ editionId: f.reading.editionId, text, stance: 'unsure' }),
    crypto.randomUUID(),
    edit,
  );

test("a journal row carries the reader's own words, its revisits and its latest activity", async () => {
  const f = await fixture();
  const bare = await row(f);
  expect(bare).toMatchObject({
    reflectionPreview: null,
    reflectionTruncated: false,
    followUps: 0,
    revisits: 0,
  });
  expect(Date.parse(bare.lastActivityAt)).toBeGreaterThanOrEqual(Date.parse(bare.createdAt));

  const writing = await write(f, 'I want to make room for an hour of quiet.');
  await note(f, 'A quieter start helped.');
  const latest = await note(f, 'Still true a week later.');
  const full = await row(f);
  expect(full).toMatchObject({
    reflectionPreview: 'I want to make room for an hour of quiet.',
    reflectionTruncated: false,
    followUps: 0,
    revisits: 2,
  });
  expect(Date.parse(full.lastActivityAt)).toBeGreaterThanOrEqual(
    Math.max(Date.parse(writing.updatedAt), Date.parse(latest.updatedAt)),
  );
  expect(HistoryItem.parse(full)).toEqual(full);

  // The excerpt is the longest whole-code-point prefix within 280 UTF-16 units.
  await write(f, `${'x'.repeat(279)}😀 tail`, { id: writing.id, revision: writing.revision });
  expect(await row(f)).toMatchObject({
    reflectionPreview: 'x'.repeat(279),
    reflectionTruncated: true,
  });
});
