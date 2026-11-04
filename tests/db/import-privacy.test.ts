import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { parseImportFile } from '../../src/domain/imports/parse.ts';
import { importEntityInput, importKeyInput } from '../../src/domain/imports/identity.ts';
import { importIndex } from '../../src/worker/readings/import-identity.ts';
import { SessionErasure } from '../../src/worker/readings/erasure.ts';
import { randomToken } from '../../src/worker/identity/crypto.ts';
import { RetentionMaintenance } from '../../src/worker/maintenance/retention.ts';
import { fixture } from '../fixtures/revisits.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { objects } from '../../src/worker/recovery/ledger.ts';
import { snapshot, restoreSnapshot } from '../fixtures/snapshot.ts';
import { OfflineRestore } from '../../src/worker/recovery/restore.ts';
import { cleanupBindings } from '../fixtures/cleanup.ts';
import raw from '../fixtures/imports/tarot-nested.json';
beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(async () => {
  await clearDatabase(env.DB);
  for (const o of await objects(env.RECOVERY, '')) await env.RECOVERY.delete(o.key);
});
async function imported() {
  const f = await fixture(),
    owner = f.session.subjectId,
    group = crypto.randomUUID(),
    batch = crypto.randomUUID();
  const source = { namespaceId: crypto.randomUUID(), revision: 'original' };
  const parsed = await parseImportFile({
    format: 'tarot-json',
    document: JSON.stringify(raw),
    source,
    recovery: { kind: 'none' },
  });
  const [parent, child] = parsed.units.filter((u) => u.kind === 'legacy-reading');
  if (!child || !parent) throw new Error('fixture did not provide two readings');
  const family = crypto.randomUUID(),
    ids = [crypto.randomUUID(), crypto.randomUUID()];
  const seal = (table: string, column: string, id: string, value: unknown) =>
    f.base.crypt.seal({ ownerId: owner, table, column, recordId: id, aadRevision: 1 }, value, 1);
  const db = env.DB;
  await db.batch([
    db
      .prepare(
        "INSERT INTO import_groups(id,owner_id,manifest_hash,source_hmac,recovery_hmac,epoch,unit_count,state,created_at,expires_at,retain_until) VALUES(?,?,'manifest','source','recovery',1,2,'complete',1,2,9999999999999)",
      )
      .bind(group, owner),
    db
      .prepare(
        "INSERT INTO import_batches(id,owner_id,source_format,document_hmac,state,created_at,expires_at,group_id) VALUES(?,?,'tarot-json','digest','complete',1,2,?)",
      )
      .bind(batch, owner, group),
    db
      .prepare(
        "INSERT INTO reading_sessions(id,owner_id,status,question_enc,created_at,saved_at) VALUES(?,?,'saved',?,1,1)",
      )
      .bind(
        family,
        owner,
        await seal('reading_sessions', 'question_enc', family, {
          v: 1,
          text: parent.record.question,
        }),
      ),
  ]);
  for (const [n, unit] of [parent, child].entries()) {
    const id = ids[n]!,
      key = await f.base.crypt.hash(owner, 'import', importKeyInput(unit.identity)),
      entity = await f.base.crypt.hash(owner, 'import', importEntityInput(unit.identity));
    const reading = {
      kind: 'legacy.imported.v1',
      editionId: id,
      sessionId: family,
      editionNumber: n + 1,
      record: unit.record,
      importedAt: new Date(1).toISOString(),
    };
    await db.batch([
      db
        .prepare(
          "INSERT INTO reading_editions(id,owner_id,session_id,edition_number,parent_edition_id,status,mode,body_enc,key_version,accepted_at) VALUES(?,?,?,?,?,'imported','legacy',?,1,1)",
        )
        .bind(
          id,
          owner,
          family,
          n + 1,
          n ? ids[0] : null,
          await seal('reading_editions', 'body_enc', id, reading),
        ),
      db
        .prepare(
          "INSERT INTO import_identities(owner_id,source_key_hmac,source_entity_hmac,original_hmac,session_id,entity_kind,edition_id,source_record_enc,key_version) VALUES(?,?,?,'original',?,'edition',?,?,1)",
        )
        .bind(
          owner,
          key,
          entity,
          family,
          id,
          await seal('import_identities', 'source_record_enc', key, unit),
        ),
      db
        .prepare(
          "INSERT INTO import_items(batch_id,owner_id,item_index,source_key_hmac,source_entity_hmac,original_hmac,body_enc,result_enc,key_version,state,session_id,group_id,ordinal) VALUES(?,?,?,?,?,'original',?,?,1,'imported',?,?,?)",
        )
        .bind(
          batch,
          owner,
          n,
          key,
          entity,
          await seal('import_items', 'body_enc', batch + ':' + n, {
            unit,
            source,
            recovery: { kind: 'none' },
          }),
          await seal('import_items', 'result_enc', batch + ':' + n, unit.identity),
          family,
          group,
          n,
        ),
      db
        .prepare(
          "INSERT INTO import_staging(owner_id,group_id,ordinal,kind,source_entity_hmac,target_id,meta_json,field_enc,key_version) VALUES(?,?,?,'alias',?,?,'{}',?,1)",
        )
        .bind(
          owner,
          group,
          n,
          entity,
          key,
          await seal('import_identities', 'source_record_enc', key, unit),
        ),
    ]);
  }
  return { ...f, family, ids, batch, group };
}
test('one imported child is erased across preview, staging, alias and body at capacity, and a stale backup cannot bring it back', async () => {
  const f = await imported(),
    db = env.DB;
  const parentBefore = await (await f.client.request('/readings/' + f.ids[0])).json();
  const before = await snapshot(db);
  await db
    .prepare('UPDATE accounts SET storage_bytes=20971520 WHERE id=?')
    .bind(f.session.subjectId)
    .run();
  const r = await f.erase.removeImportedEdition(f.session, f.ids[1]!, 2, crypto.randomUUID(), {
    receiptId: crypto.randomUUID(),
    receiptToken: randomToken(),
  });
  expect(r.state).toBe('complete');
  const check = async () => {
    expect(
      await db
        .prepare('SELECT body_enc,result_enc FROM import_items WHERE batch_id=? AND item_index=1')
        .bind(f.batch)
        .first(),
    ).toEqual({ body_enc: null, result_enc: null });
    expect(
      await db
        .prepare(
          'SELECT count(*) n FROM import_staging WHERE group_id=? AND ordinal=1 AND field_enc IS NOT NULL',
        )
        .bind(f.group)
        .first('n'),
    ).toBe(0);
    expect(
      await db
        .prepare(
          'SELECT count(*) n FROM import_identities WHERE erased_at IS NOT NULL AND edition_id IS NULL AND source_record_enc IS NULL',
        )
        .first('n'),
    ).toBe(1);
    expect(
      await db
        .prepare('SELECT body_enc FROM reading_editions WHERE id=?')
        .bind(f.ids[1])
        .first('body_enc'),
    ).toBeNull();
  };
  await check();
  expect(await (await f.client.request('/readings/' + f.ids[0])).json()).toEqual(parentBefore);
  await restoreSnapshot(db, before);
  await new OfflineRestore(cleanupBindings()).replay();
  await check();
});
test('raw preview and staged ciphertext expire at 24 hours while committed results survive through their seven-day window', async () => {
  await imported();
  const db = env.DB;
  await new RetentionMaintenance(db).run();
  expect(
    await db.prepare('SELECT count(*) n FROM import_items WHERE body_enc IS NOT NULL').first('n'),
  ).toBe(0);
  expect(
    await db
      .prepare('SELECT count(*) n FROM import_staging WHERE field_enc IS NOT NULL')
      .first('n'),
  ).toBe(0);
  expect(
    await db.prepare('SELECT count(*) n FROM import_items WHERE result_enc IS NOT NULL').first('n'),
  ).toBe(2);
  expect(
    await db
      .prepare('SELECT count(*) n FROM import_identities WHERE source_record_enc IS NOT NULL')
      .first('n'),
  ).toBe(2);
});

test('offline restore expires interrupted import work and clears its private staging; completed account records stay readable', async () => {
  const f = await imported();
  await env.DB.prepare(
    "UPDATE import_groups SET state='committing',preview_hash='captured',expires_at=9999999999999,lease_token='interrupted',lease_until=9999999999999 WHERE id=?",
  )
    .bind(f.group)
    .run();
  await new OfflineRestore(cleanupBindings()).replay();
  expect(
    await env.DB.prepare('SELECT state,lease_token,preview_hash FROM import_groups WHERE id=?')
      .bind(f.group)
      .first(),
  ).toEqual({ state: 'expired', lease_token: null, preview_hash: null });
  expect(
    await env.DB.prepare(
      'SELECT count(*) AS n FROM import_staging WHERE group_id=? AND field_enc IS NOT NULL',
    )
      .bind(f.group)
      .first('n'),
  ).toBe(0);
  expect(
    await env.DB.prepare(
      'SELECT count(*) AS n FROM import_items WHERE group_id=? AND (body_enc IS NOT NULL OR result_enc IS NOT NULL)',
    )
      .bind(f.group)
      .first('n'),
  ).toBe(0);
  expect(
    await env.DB.prepare(
      'SELECT count(*) AS n FROM reading_editions WHERE session_id=? AND body_enc IS NOT NULL',
    )
      .bind(f.family)
      .first('n'),
  ).toBe(2);
});

test('erasing an imported edition follows explicitly copied authored and session fields while preserving independent revisions and annotations', async () => {
  const f = await imported(),
    owner = f.session.subjectId,
    db = env.DB;
  const reflection = (await (
    await f.client.request('/sessions/' + f.started.sessionId + '/reflections', {
      editionId: f.reading.editionId,
      stance: 'unsure',
      text: 'Copied statement',
    })
  ).json()) as { id: string };
  const independent = (await (
    await f.client.request('/sessions/' + f.started.sessionId + '/reflections', {
      editionId: f.reading.editionId,
      stance: 'unsure',
      text: 'Independent response',
    })
  ).json()) as { id: string };
  const note = await f.notes.create(
    f.session,
    { editionId: f.reading.editionId, stance: 'unsure', note: 'Copied historical note' },
    crypto.randomUUID(),
  );
  const current = await f.notes.update(f.session, note.id, 1, crypto.randomUUID(), {
    stance: 'resonates',
    note: 'Independent current revision',
  });
  const mirror = crypto.randomUUID();
  const question = {
    ownerId: owner,
    table: 'reading_sessions',
    column: 'question_enc',
    recordId: mirror,
    aadRevision: 1,
  };
  await db
    .prepare(
      "INSERT INTO reading_sessions(id,owner_id,status,question_enc,created_at,saved_at) VALUES(?,?,'saved',?,1,1)",
    )
    .bind(
      mirror,
      owner,
      await f.base.crypt.seal(question, { v: 1, text: 'Copied historical question' }, 1),
    )
    .run();
  const root = await db
    .prepare('SELECT source_entity_hmac FROM import_identities WHERE owner_id=? AND edition_id=?')
    .bind(owner, f.ids[1])
    .first<string>('source_entity_hmac');
  for (const [kind, sessionId, reflectionId, revisitId] of [
    ['reflection_revision', f.started.sessionId, reflection.id, null],
    ['revisit', f.started.sessionId, null, note.id],
    ['session', mirror, null, null],
  ] as const) {
    const entity = crypto.randomUUID(),
      key = crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          'INSERT INTO import_identities(owner_id,source_key_hmac,source_entity_hmac,original_hmac,session_id,entity_kind,reflection_id,reflection_revision,revisit_id,revisit_revision,source_record_enc,key_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)',
        )
        .bind(
          owner,
          key,
          entity,
          entity,
          sessionId,
          kind,
          reflectionId,
          reflectionId ? 1 : null,
          revisitId,
          revisitId ? 1 : null,
          await f.base.crypt.seal(
            {
              ownerId: owner,
              table: 'import_identities',
              column: 'source_record_enc',
              recordId: key,
              aadRevision: 1,
            },
            { kind },
            1,
          ),
        ),
      db.prepare('INSERT INTO import_copy_sources VALUES(?,?,?)').bind(owner, root, entity),
    ]);
  }
  const derived = await f.client.create('A reading that used the imported statement');
  const grant = crypto.randomUUID(),
    receiptAlias = crypto.randomUUID(),
    receiptEntity = crypto.randomUUID();
  const incoming = (
    await importIndex(f.base, owner, {
      source: { namespaceId: owner, revision: 'native-v1' },
      kind: 'reading',
      recordId: derived.reading.editionId,
      recordRevision: 1,
    })
  ).entity;
  await db.batch([
    db
      .prepare(
        "INSERT INTO context_grants(id,owner_id,reflection_id,reflection_revision,state,created_at,updated_at) VALUES(?,?,?,1,'allowed',1,1)",
      )
      .bind(grant, owner, reflection.id),
    db.prepare("INSERT INTO generation_context VALUES(?,?,0,?,1,?,'captured',1)").bind(
      derived.started.requestId,
      owner,
      grant,
      await f.base.crypt.seal(
        {
          ownerId: owner,
          table: 'generation_context',
          column: 'fragment_enc',
          recordId: derived.started.requestId + ':0',
          aadRevision: 1,
        },
        { text: 'Copied statement' },
        1,
      ),
    ),
    db
      .prepare('UPDATE generation_requests SET context_count=1 WHERE id=?')
      .bind(derived.started.requestId),
    db
      .prepare(
        "INSERT INTO import_identities(owner_id,source_key_hmac,source_entity_hmac,original_hmac,entity_kind,source_record_enc,key_version) VALUES(?,?,?,'original','receipt',?,1)",
      )
      .bind(
        owner,
        receiptAlias,
        receiptEntity,
        await f.base.crypt.seal(
          {
            ownerId: owner,
            table: 'import_identities',
            column: 'source_record_enc',
            recordId: receiptAlias,
            aadRevision: 1,
          },
          { text: 'Other copy' },
          1,
        ),
      ),
    db
      .prepare('INSERT INTO import_copy_sources VALUES(?,?,?)')
      .bind(owner, incoming, receiptEntity),
  ]);
  const receipt = { receiptId: crypto.randomUUID(), receiptToken: randomToken() };
  const held = new Proxy(env.RECOVERY, {
    get(target, key) {
      if (key === 'put')
        return () => {
          throw new Error('Synthetic ledger outage');
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const before = await db
    .prepare('SELECT question_enc FROM reading_sessions WHERE id=?')
    .bind(mirror)
    .first('question_enc');
  await expect(
    new SessionErasure(f.base, held).removeImportedEdition(
      f.session,
      f.ids[1]!,
      2,
      crypto.randomUUID(),
      receipt,
    ),
  ).rejects.toThrow();
  expect(
    await db
      .prepare('SELECT question_enc FROM reading_sessions WHERE id=?')
      .bind(mirror)
      .first('question_enc'),
  ).toBe(before);
  expect(await (await f.client.request('/sessions/' + mirror)).json()).toMatchObject({
    question: null,
    status: 'saved',
  });
  expect((await f.client.request('/reflections/' + reflection.id)).status).toBe(410);
  expect(await (await f.client.request('/reflections/' + independent.id)).json()).toMatchObject({
    text: 'Independent response',
  });
  expect((await f.client.request('/readings/' + f.ids[0])).status).toBe(200);
  expect((await f.client.request('/readings/' + derived.reading.editionId)).status).toBe(410);
  await f.erase.resume(receipt.receiptId);
  expect(
    await db
      .prepare(
        'SELECT source_record_enc FROM import_identities WHERE owner_id=? AND source_key_hmac=?',
      )
      .bind(owner, receiptAlias)
      .first('source_record_enc'),
  ).toBeNull();
  expect(
    await db
      .prepare('SELECT body_enc FROM reflection_revisions WHERE reflection_id=? AND revision=1')
      .bind(reflection.id)
      .first('body_enc'),
  ).toBeNull();
  expect(
    await db
      .prepare('SELECT body_enc FROM revisit_revisions WHERE revisit_id=? AND revision=1')
      .bind(note.id)
      .first('body_enc'),
  ).toBeNull();
  expect(await f.notes.read(f.session, note.id)).toEqual(current);
  expect(await (await f.client.request('/reflections/' + independent.id)).json()).toMatchObject({
    text: 'Independent response',
  });
  expect(await (await f.client.request('/sessions/' + mirror)).json()).toMatchObject({
    question: null,
    status: 'saved',
  });
});
