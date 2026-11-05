import { gate } from '../fixtures/barrier.ts';
import { RecordBase } from '../../src/worker/readings/base.ts';
import { ReadingExports } from '../../src/worker/readings/export.ts';
import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { apiSchemas } from '../../src/contracts/index.ts';
import { parseImportFile } from '../../src/domain/imports/parse.ts';
import { buildImportGroups } from '../../src/domain/imports/chunks.ts';
import { ContextRecords } from '../../src/worker/readings/context.ts';
import { ReadingRecords } from '../../src/worker/readings/records.ts';
import { ReadingImports } from '../../src/worker/readings/imports.ts';
import { Reflections } from '../../src/worker/readings/reflections.ts';
import { randomToken } from '../../src/worker/identity/crypto.ts';
import { OfflineRestore } from '../../src/worker/recovery/restore.ts';
import { objects } from '../../src/worker/recovery/ledger.ts';
import { fixture } from '../fixtures/revisits.ts';
import { seedPattern } from '../fixtures/pattern-record.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { snapshot, restoreSnapshot } from '../fixtures/snapshot.ts';
import { readingBindings, login } from '../fixtures/reading-client.ts';

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(async () => {
  await clearDatabase(env.DB);
  for (const object of await objects(env.RECOVERY, '')) await env.RECOVERY.delete(object.key);
});
const receipt = () => ({ receiptId: crypto.randomUUID(), receiptToken: randomToken() });
async function setup() {
  const f = await fixture();
  return { ...f, pattern: await seedPattern(f.base, f.session) };
}
const exportPage = async (f: Awaited<ReturnType<typeof setup>>) =>
  f.exports.page(f.session, (await f.exports.create(f.session, crypto.randomUUID())).id, null);

test('v2 exports exact Pattern and profile; imports keep historical identity and offer profile separately', async () => {
  const f = await setup(),
    page = await exportPage(f);
  expect(page.format).toBe('reflection-export.v2');
  expect(page.records.find((r) => r.kind === 'birth_profile')?.value).toEqual(f.pattern.profile);
  expect(
    page.records.find((r) => r.kind === 'reading' && r.originalId === f.pattern.reading.editionId)
      ?.value,
  ).toEqual(f.pattern.reading);
  const parsed = await parseImportFile({
    format: page.format,
    source: { namespaceId: f.session.subjectId, revision: 'native-v1' },
    recovery: { kind: 'none' },
    document: JSON.stringify(page),
  });
  expect(parsed.errors).toEqual([]);
  expect(parsed.profileCandidates).toEqual([f.pattern.profile]);
  expect(parsed.units.some((u) => String(u.identity.kind) === 'birth_profile')).toBe(false);
  const destination = await setup();
  const imports = new ReadingImports(env.DB, destination.base.identity);
  const groups = await buildImportGroups(parsed.units, () => crypto.randomUUID());
  for (const g of groups) {
    for (const chunk of g.chunks)
      await imports.preview(destination.session, crypto.randomUUID(), chunk);
    const status = await imports.groupStatus(destination.session, g.id);
    await imports.commitGroup(destination.session, g.id, crypto.randomUUID(), {
      version: 'import-group.v1',
      manifestHash: g.manifestHash,
      previewHash: status.previewHash!,
      confirmedRecovery: { kind: 'none' },
    });
  }
  // The importer owns a new edition and never grants the original native authority.
  const editions = await env.DB.prepare(
    "SELECT id FROM reading_editions WHERE owner_id=? AND mode='legacy'",
  )
    .bind(destination.session.subjectId)
    .all<{ id: string }>();
  const values = await Promise.all(
    editions.results.map((e) =>
      new ReadingRecords(destination.base).reading(destination.session, e.id),
    ),
  );
  expect(
    values.some(
      (r) =>
        r.kind === 'legacy.imported.v1' &&
        r.record.basis.method === 'astrology' &&
        JSON.parse(r.record.basis.rawBasisJson!).semanticHash ===
          f.pattern.reading.basis.semanticHash,
    ),
  ).toBe(true);
  expect(
    await env.DB.prepare('SELECT id FROM birth_profiles WHERE owner_id=?')
      .bind(destination.session.subjectId)
      .first('id'),
  ).toBe(destination.pattern.profile.id);
});

test('profile removal and offline erasure replay retain saved basis, while account removal erases both', async () => {
  const f = await setup(),
    saved = await snapshot(env.DB),
    proof = receipt();
  await f.erase.removeBirthProfile(f.session, f.pattern.profile.id, 1, crypto.randomUUID(), proof);
  expect(
    await env.DB.prepare('SELECT body_enc FROM birth_profiles WHERE owner_id=?')
      .bind(f.session.subjectId)
      .first('body_enc'),
  ).toBeNull();
  expect(await new ReadingRecords(f.base).reading(f.session, f.pattern.reading.editionId)).toEqual(
    f.pattern.reading,
  );
  await restoreSnapshot(env.DB, saved);
  await new OfflineRestore({ ...readingBindings, RESTORE_MODE: 'offline' }).replay();
  await login(f.client, f.passkey, f.session.subjectId);
  f.session = await f.base.identity.sessions.get(f.client.cookies.get('__Host-session'));

  expect(
    await env.DB.prepare('SELECT body_enc FROM birth_profiles WHERE owner_id=?')
      .bind(f.session.subjectId)
      .first('body_enc'),
  ).toBeNull();
  expect(await new ReadingRecords(f.base).reading(f.session, f.pattern.reading.editionId)).toEqual(
    f.pattern.reading,
  );
  await f.erase.removeAccount(f.session, crypto.randomUUID(), receipt());
  for (const table of [
    'birth_profiles',
    'basis_snapshots',
    'reading_editions',
    'astrology_admissions',
    'pattern_saved_sources',
  ])
    expect(
      await env.DB.prepare(`SELECT count(*) n FROM ${table} WHERE owner_id=?`)
        .bind(f.session.subjectId)
        .first('n'),
    ).toBe(0);
});

test('family deletion removes dedup identities and private snapshots but retains the current profile', async () => {
  const f = await setup();
  await f.erase.remove(f.session, f.pattern.reading.sessionId, 1, crypto.randomUUID(), receipt());
  expect(
    await env.DB.prepare('SELECT count(*) n FROM pattern_saved_sources WHERE owner_id=?')
      .bind(f.session.subjectId)
      .first('n'),
  ).toBe(0);
  expect(
    await env.DB.prepare('SELECT body_enc FROM basis_snapshots WHERE id=?')
      .bind(f.pattern.reading.basis.basisId)
      .first('body_enc'),
  ).toBeNull();
  expect(
    await env.DB.prepare('SELECT body_enc FROM birth_profiles WHERE owner_id=?')
      .bind(f.session.subjectId)
      .first('body_enc'),
  ).toBeTruthy();
});

test('Pattern editions cannot enter context or follow-ups; explicitly granted own writing contains only selected text', async () => {
  const f = await setup(),
    context = new ContextRecords(env.DB, f.base.identity);
  await expect(
    context.grant(f.session, crypto.randomUUID(), {
      kind: 'edition',
      editionId: f.pattern.reading.editionId,
    }),
  ).rejects.toMatchObject({ code: 'CONTENT_UNAVAILABLE' });
  const writing = await new Reflections(f.base).write(
    f.session,
    f.pattern.reading.sessionId,
    {
      text: 'Only this chosen sentence. Private remaining text.',
      stance: 'unspecified',
      editionId: f.pattern.reading.editionId,
    },
    crypto.randomUUID(),
  );
  const grant = await context.grant(f.session, crypto.randomUUID(), {
    kind: 'reflection_revision',
    reflectionId: writing.id,
    revision: 1,
  });
  const fields = {
    clientIntentId: crypto.randomUUID(),
    question: 'What can I try?',
    parentEditionId: null,
    permissionRevision: (await f.client.me()).permission.revision,
  };
  const preview = await context.preview(f.session, {
    ...fields,
    items: [{ grantId: grant.id, grantRevision: grant.revision, start: 0, end: 26 }],
  });
  expect(preview.items.map((i) => i.text)).toEqual(['Only this chosen sentence.']);
  const packet = await context.confirmStart(
    f.session,
    apiSchemas.StartRequest.parse({
      ...fields,
      languageConfirmed: 'en',
      reversals: true,
      selection: preview.items.map((i) => i.selection),
      contextAcknowledgement: preview.acknowledgementHash,
    }),
  );
  expect(packet.map((p) => p.text)).toEqual(['Only this chosen sentence.']);
  expect(JSON.stringify(packet)).not.toContain(f.pattern.profile.birth.place.label);
  expect(JSON.stringify(packet)).not.toContain(f.pattern.reading.chapter.text);
  const attempt = await f.client.request('/requests', {
    ...fields,
    parentEditionId: f.pattern.reading.editionId,
    languageConfirmed: 'en',
    reversals: true,
    selection: [],
  });
  expect(attempt.status).toBe(410);
  await context.revoke(f.session, grant.id, grant.revision, crypto.randomUUID());
  await expect(
    context.preview(f.session, {
      ...fields,
      items: [{ grantId: grant.id, grantRevision: grant.revision, start: 0, end: 26 }],
    }),
  ).rejects.toMatchObject({ code: 'CONTEXT_CHANGED' });
  const revisit = await f.notes.create(
    f.session,
    { editionId: f.pattern.reading.editionId, note: 'A later observation.', stance: 'unspecified' },
    crypto.randomUUID(),
  );
  const noteGrant = await context.grant(f.session, crypto.randomUUID(), {
    kind: 'revisit_revision',
    revisitId: revisit.id,
    revision: 1,
  });
  const notePreview = await context.preview(f.session, {
    ...fields,
    items: [{ grantId: noteGrant.id, grantRevision: 1, start: 0, end: 20 }],
  });
  expect(notePreview.items.map((i) => i.text)).toEqual(['A later observation.']);
});

test('withdrawn Pattern content is unavailable on read and export while own writing remains', async () => {
  const f = await setup();
  const writing = await new Reflections(f.base).write(
    f.session,
    f.pattern.reading.sessionId,
    { text: 'My retained writing', stance: 'unspecified', editionId: f.pattern.reading.editionId },
    crypto.randomUUID(),
  );
  await env.DB.prepare(
    "UPDATE pattern_content_releases SET state='withdrawn',withdrawn_at=? WHERE hash=?",
  )
    .bind(Date.now(), f.pattern.release.releaseHash)
    .run();
  await expect(
    new ReadingRecords(f.base).reading(f.session, f.pattern.reading.editionId),
  ).rejects.toMatchObject({ code: 'CONTENT_UNAVAILABLE' });
  const page = await exportPage(f);
  expect(
    page.records.find((r) => r.kind === 'reading' && r.originalId === f.pattern.reading.editionId)
      ?.value,
  ).toMatchObject({ kind: 'reading.unavailable.v1' });
  expect(await new Reflections(f.base).read(f.session, writing.id)).toMatchObject({
    text: 'My retained writing',
  });
});

test('an old profile erasure cannot erase a later explicit replacement', async () => {
  const f = await setup(),
    proof = receipt(),
    original = f.pattern.profile;
  await f.erase.removeBirthProfile(f.session, original.id, 1, crypto.randomUUID(), proof);
  const replacement = { ...original, revision: 2, updatedAt: new Date().toISOString() };
  const body = await f.base.crypt.seal(
    {
      ownerId: f.session.subjectId,
      table: 'birth_profiles',
      column: 'body_enc',
      recordId: original.id,
      aadRevision: 2,
    },
    replacement,
    1,
  );
  await env.DB.prepare(
    'UPDATE birth_profiles SET body_enc=?,key_version=1,revision=2,deleted_at=NULL WHERE owner_id=?',
  )
    .bind(body, f.session.subjectId)
    .run();
  const chain = await f.erase.ledger.load(proof.receiptId);
  await f.erase.project(chain.intent, chain.target, null);
  await f.erase.eraseTarget(proof.receiptId, chain.target);
  expect(
    await env.DB.prepare('SELECT body_enc FROM birth_profiles WHERE owner_id=?')
      .bind(f.session.subjectId)
      .first('body_enc'),
  ).toBe(body);
});

test('withdrawal after export decryption cannot release the stale chapter', async () => {
  const f = await setup(),
    ticket = await f.exports.create(f.session, crypto.randomUUID());
  const barrier = gate((sql) =>
    sql.some((s) => s.includes('(SELECT count(*) FROM reading_sessions s')),
  );
  const exports = new ReadingExports(new RecordBase(barrier.db, f.base.identity));
  const pending = exports.page(f.session, ticket.id, null);
  await barrier.ready;
  await env.DB.prepare(
    "UPDATE pattern_content_releases SET state='withdrawn',withdrawn_at=? WHERE hash=?",
  )
    .bind(Date.now(), f.pattern.release.releaseHash)
    .run();
  barrier.release();
  await expect(pending).rejects.toMatchObject({ code: 'EXPORT_CHANGED' });
});
