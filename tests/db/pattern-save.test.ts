import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { BirthProfiles } from '../../src/worker/astrology/profiles.ts';
import { Patterns } from '../../src/worker/astrology/patterns.ts';
import { AstrologyAdmission } from '../../src/worker/astrology/admission.ts';
import { BirthDraft, type PatternPreview } from '../../src/contracts/astrology.ts';
import { Reflections } from '../../src/worker/readings/reflections.ts';
import { ReadingRecords } from '../../src/worker/readings/records.ts';
import { RecordBase } from '../../src/worker/readings/base.ts';
import { fixture } from '../fixtures/revisits.ts';
import { gate } from '../fixtures/barrier.ts';
import { clearDatabase } from '../fixtures/database.ts';
import parity from '../fixtures/astrology-node-parity.json';
const birth = BirthDraft.parse(parity[0]!.input.birth);
beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));
async function setup() {
  const f = await fixture();
  await f.client.permission(false);
  const profiles = new BirthProfiles(f.base);
  await profiles.write(
    f.session,
    { birth, expectedRevision: 0, confirmedRetention: true },
    crypto.randomUUID(),
  );
  return { ...f, profiles, patterns: new Patterns(f.base, { allowSynthetic: true }) };
}
const input = (p: PatternPreview, text: string | null = null) => ({
  chapterId: 'self' as const,
  expectedProfileRevision: p.profileRevision,
  basisHash: p.basisHash,
  releaseHash: p.releaseHash,
  reflection: text === null ? null : { text, stance: 'unspecified' as const },
});
test('AI-off preview/save retains real immutable facts and replay succeeds after profile/content changes', async () => {
  const f = await setup(),
    preview = await f.patterns.preview(f.session),
    key = crypto.randomUUID(),
    request = input(preview, ' My own exact words. ');
  const saved = await f.patterns.save(f.session, request, key);
  const value = await new ReadingRecords(f.base).reading(f.session, saved.editionId);
  expect(value).toMatchObject({
    kind: 'astrology.pattern.accepted.v1',
    basis: { semanticHash: preview.basisHash, profileRevision: 1 },
  });
  expect(await new Reflections(f.base).read(f.session, saved.reflectionId!)).toMatchObject({
    text: ' My own exact words. ',
  });
  await f.profiles.write(
    f.session,
    { birth: { ...birth, date: '2002-01-01' }, expectedRevision: 1, confirmedRetention: true },
    crypto.randomUUID(),
  );
  await env.DB.prepare(
    "UPDATE pattern_content_releases SET state='withdrawn',withdrawn_at=? WHERE hash=?",
  )
    .bind(Date.now(), preview.releaseHash)
    .run();
  expect(await f.patterns.save(f.session, request, key)).toEqual(saved);
  expect(
    await env.DB.prepare('SELECT count(*) n FROM generation_requests WHERE owner_id=?')
      .bind(f.session.subjectId)
      .first('n'),
  ).toBe(1); // only the preexisting tarot fixture
});
test('different save keys cannot silently discard writing or duplicate a family', async () => {
  const f = await setup(),
    p = await f.patterns.preview(f.session);
  const outcomes = await Promise.allSettled([
    f.patterns.save(f.session, input(p, 'First draft'), crypto.randomUUID()),
    f.patterns.save(f.session, input(p, 'Second draft'), crypto.randomUUID()),
  ]);
  expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  const loser = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
  expect(loser.reason).toMatchObject({
    code: 'CONFLICT',
    existing: { editionId: expect.any(String) },
  });
  const winner = outcomes.find((o) => o.status === 'fulfilled') as PromiseFulfilledResult<
    Awaited<ReturnType<Patterns['save']>>
  >;
  expect(await f.patterns.save(f.session, input(p), crypto.randomUUID())).toMatchObject({
    editionId: winner.value.editionId,
  });
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM reading_editions WHERE owner_id=? AND mode='pattern'",
    )
      .bind(f.session.subjectId)
      .first('n'),
  ).toBe(1);
  expect(
    await env.DB.prepare('SELECT count(*) n FROM astrology_admissions WHERE owner_id=?')
      .bind(f.session.subjectId)
      .first('n'),
  ).toBe(1);
});
test.each(['profile', 'content', 'deletion'] as const)(
  'a %s change during save rejects the whole publication',
  async (kind) => {
    const f = await setup(),
      p = await f.patterns.preview(f.session),
      barrier = gate((sql) => sql.some((s) => s.includes('INSERT INTO reading_editions')));
    const pending = new Patterns(new RecordBase(barrier.db, f.base.identity), {
      allowSynthetic: true,
    }).save(f.session, input(p, 'Keep this draft'), crypto.randomUUID());
    await barrier.ready;
    if (kind === 'profile')
      await f.profiles.write(
        f.session,
        { birth: { ...birth, date: '2002-01-01' }, expectedRevision: 1, confirmedRetention: true },
        crypto.randomUUID(),
      );
    if (kind === 'content')
      await env.DB.prepare(
        "UPDATE pattern_content_releases SET state='withdrawn',withdrawn_at=? WHERE hash=?",
      )
        .bind(Date.now(), p.releaseHash)
        .run();
    if (kind === 'deletion')
      await env.DB.prepare(
        'UPDATE birth_profiles SET body_enc=NULL,key_version=NULL,deleted_at=? WHERE owner_id=?',
      )
        .bind(Date.now(), f.session.subjectId)
        .run();
    barrier.release();
    await expect(pending).rejects.toMatchObject({
      code: expect.stringMatching(/CONFLICT|CONTENT_UNAVAILABLE|NOT_FOUND/),
    });
    expect(
      await env.DB.prepare(
        "SELECT count(*) n FROM reading_editions WHERE owner_id=? AND mode='pattern'",
      )
        .bind(f.session.subjectId)
        .first('n'),
    ).toBe(0);
  },
);
test('concurrent new calculation admissions stop at thirty while repeated inputs reuse admission', async () => {
  const f = await setup(),
    admission = new AstrologyAdmission(f.base);
  const results = await Promise.allSettled(
    Array.from({ length: 35 }, (_, i) => admission.admit(f.session, { input: i })),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(30);
  const count = await env.DB.prepare('SELECT count(*) n FROM astrology_admissions WHERE owner_id=?')
    .bind(f.session.subjectId)
    .first('n');
  expect(count).toBe(30);
  const admitted = results.findIndex((r) => r.status === 'fulfilled');
  await admission.admit(f.session, { input: admitted });
  expect(
    await env.DB.prepare('SELECT count(*) n FROM astrology_admissions WHERE owner_id=?')
      .bind(f.session.subjectId)
      .first('n'),
  ).toBe(30);
});

test('simultaneous retries of the same save key return the same complete receipt', async () => {
  const f = await setup(),
    p = await f.patterns.preview(f.session),
    key = crypto.randomUUID();
  const request = input(p, 'Keep the exact retry draft');
  const [a, b] = await Promise.all([
    f.patterns.save(f.session, request, key),
    f.patterns.save(f.session, request, key),
  ]);
  expect(a).toEqual(b);
  expect(await new Reflections(f.base).read(f.session, a.reflectionId!)).toMatchObject({
    text: request.reflection!.text,
  });
});
test('storage pressure rejects the whole save with a recoverable capacity error', async () => {
  const f = await setup(),
    p = await f.patterns.preview(f.session);
  await env.DB.prepare('UPDATE accounts SET storage_bytes=? WHERE id=?')
    .bind(20971520 - 2048, f.session.subjectId)
    .run();
  await expect(
    f.patterns.save(f.session, input(p, 'Keep this draft'), crypto.randomUUID()),
  ).rejects.toMatchObject({ code: 'STORAGE_LIMIT_EXCEEDED' });
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM reading_editions WHERE owner_id=? AND mode='pattern'",
    )
      .bind(f.session.subjectId)
      .first('n'),
  ).toBe(0);
});
