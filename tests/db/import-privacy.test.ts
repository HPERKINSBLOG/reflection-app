import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { apiSchemas } from '../../src/contracts/index.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { readingAccount } from '../fixtures/reading-client.ts';
import { importGroup, commitGroup } from '../fixtures/import-workflows.ts';
import { randomToken } from '../../src/worker/identity/crypto.ts';
import { objects } from '../../src/worker/recovery/ledger.ts';
import { RetentionMaintenance } from '../../src/worker/maintenance/retention.ts';
import { fixture } from '../fixtures/revisits.ts';
import { snapshot, restoreSnapshot } from '../fixtures/snapshot.ts';
import { OfflineRestore } from '../../src/worker/recovery/restore.ts';
import { cleanupBindings } from '../fixtures/cleanup.ts';
import { ReadingImports } from '../../src/worker/readings/imports.ts';
import { RecordBase } from '../../src/worker/readings/base.ts';
import { SessionErasure } from '../../src/worker/readings/erasure.ts';
import { gate } from '../fixtures/barrier.ts';
import { uploadGroup } from '../fixtures/import-workflows.ts';
import { eraseImportCopies } from '../../src/worker/readings/import-lifecycle.ts';

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(async () => {
  await clearDatabase(env.DB);
  for (const object of await objects(env.RECOVERY, '')) await env.RECOVERY.delete(object.key);
});
test('imported bodies export with their effective identity and family erasure detaches every copy', async () => {
  const { client } = await readingAccount(true, false),
    group = await importGroup({ note: 'PRIVATE_IMPORTED_NOTE' });
  expect((await commitGroup(client, group)).status.state).toBe('complete');
  const ticket = apiSchemas.ExportTicket.parse(await (await client.request('/exports', {})).json());
  const response = await client.request(`/exports/${ticket.id}`);
  expect(response.status, await response.clone().text()).toBe(200);
  const page = apiSchemas.ExportPage.parse(await response.json());
  expect(
    page.records.filter(
      (r) => r.identity.source.namespaceId === group.chunks[0]!.source.namespaceId,
    ),
  ).toHaveLength(2);
  const results = apiSchemas.ImportGroupResultPage.parse(
    await (await client.request(`/imports/groups/${group.id}/results`)).json(),
  );
  const sessionId = results.items[0]!.sessionId!;
  const session = apiSchemas.SessionRecord.parse(
    await (await client.request(`/sessions/${sessionId}`)).json(),
  );
  const deleted = await client.request(
    `/sessions/${sessionId}`,
    { receiptId: crypto.randomUUID(), receiptToken: randomToken() },
    { method: 'DELETE', revision: session.revision },
  );
  expect(deleted.status, await deleted.clone().text()).toBe(202);
  expect(
    (
      await env.DB.prepare(
        'SELECT source_record_enc,session_id,edition_id,reflection_id,revisit_id FROM import_identities',
      ).all()
    ).results.every((r) => Object.values(r).every((v) => v === null)),
  ).toBe(true);
  expect(
    await env.DB.prepare('SELECT count(*) n FROM import_items WHERE body_enc IS NOT NULL').first(
      'n',
    ),
  ).toBe(0);
  const fresh = await importGroup({ source: group.chunks[0]!.source });
  const preview = await client.request('/imports/preview', fresh.chunks[0]);
  expect(preview.status, await preview.clone().text()).toBe(201);
  expect(apiSchemas.ImportPreview.parse(await preview.json()).items[0]!.status).toBe('erased');
});

test('preview expiry never changes a completed group into expired or removes its seven-day outcome', async () => {
  const { client } = await readingAccount(),
    group = await importGroup();
  const committed = await commitGroup(client, group);
  await env.DB.prepare('UPDATE import_batches SET expires_at=1').run();
  const status = apiSchemas.ImportGroupStatus.parse(
    await (await client.request(`/imports/groups/${group.id}`)).json(),
  );
  expect(status.state).toBe('complete');
  const replay = await client.request(`/imports/groups/${group.id}/commit`, committed.input, {
    key: committed.key,
  });
  expect(replay.status, await replay.clone().text()).toBe(200);
  expect(apiSchemas.ImportGroupStatus.parse(await replay.json()).completedItems).toBe(1);
  await new RetentionMaintenance(env.DB).run();
  expect(
    await env.DB.prepare('SELECT count(*) n FROM import_items WHERE body_enc IS NOT NULL').first(
      'n',
    ),
  ).toBe(0);
  expect(
    await env.DB.prepare('SELECT count(*) n FROM import_items WHERE result_enc IS NOT NULL').first(
      'n',
    ),
  ).toBe(1);
  await env.DB.prepare('UPDATE import_groups SET outcome_expires_at=1').run();
  await new RetentionMaintenance(env.DB).run();
  expect(
    await env.DB.prepare('SELECT count(*) n FROM import_items WHERE result_enc IS NOT NULL').first(
      'n',
    ),
  ).toBe(0);
  expect(
    await env.DB.prepare(
      'SELECT count(*) n FROM reading_editions WHERE body_enc IS NOT NULL',
    ).first('n'),
  ).toBe(1);
});

test('erased source entities stay erased across source revisions; confirmed new namespaces create deliberate new copies', async () => {
  const f = await fixture(),
    old = await importGroup();
  await commitGroup(f.client, old);
  const results = apiSchemas.ImportGroupResultPage.parse(
    await (await f.client.request(`/imports/groups/${old.id}/results`)).json(),
  );
  await f.erase.remove(f.session, results.items[0]!.sessionId!, 1, crypto.randomUUID(), {
    receiptId: crypto.randomUUID(),
    receiptToken: randomToken(),
  });
  const renamed = await importGroup({ source: { ...old.chunks[0]!.source, revision: 'renamed' } });
  const preview = await f.client.request('/imports/preview', renamed.chunks[0]);
  expect(apiSchemas.ImportPreview.parse(await preview.json()).items[0]!.status).toBe('erased');
  const fresh = await importGroup({ source: old.chunks[0]!.source }),
    recovery = { kind: 'reimport_erased' as const, previousSource: old.chunks[0]!.source },
    source = { namespaceId: crypto.randomUUID(), revision: 'recovered' };
  fresh.chunks = fresh.chunks.map((c) => ({ ...c, source, recovery }));
  expect((await commitGroup(f.client, fresh)).status.state).toBe('complete');
  expect(
    await env.DB.prepare(
      'SELECT count(*) n FROM import_identities WHERE erased_at IS NOT NULL',
    ).first('n'),
  ).toBe(1);
  expect(
    await env.DB.prepare('SELECT count(*) n FROM import_identities WHERE erased_at IS NULL').first(
      'n',
    ),
  ).toBe(1);
});

test('an independently selected imported note erases without deleting its parent prose', async () => {
  const f = await fixture(),
    group = await importGroup({ note: 'ERASE_THIS_IMPORTED_NOTE' });
  await commitGroup(f.client, group);
  const alias = (await env.DB.prepare(
    "SELECT reflection_id FROM import_identities WHERE entity_kind='reflection_revision'",
  ).first<{ reflection_id: string }>())!;
  const response = await f.client.request(
    `/reflections/${alias.reflection_id}/revisions/1`,
    { receiptId: crypto.randomUUID(), receiptToken: randomToken() },
    { method: 'DELETE', revision: 1 },
  );
  expect(response.status, await response.clone().text()).toBe(202);
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM import_identities WHERE entity_kind='edition' AND source_record_enc IS NOT NULL",
    ).first('n'),
  ).toBe(1);
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM import_identities WHERE entity_kind='reflection_revision' AND source_record_enc IS NOT NULL",
    ).first('n'),
  ).toBe(0);
});

test('stale backup replay erases imported aliases and previews and cancels unfinished groups without dispatch', async () => {
  const f = await fixture(),
    group = await importGroup();
  await commitGroup(f.client, group);
  const staged = await importGroup();
  await uploadGroup(f.client, staged);
  const before = await snapshot(env.DB),
    results = apiSchemas.ImportGroupResultPage.parse(
      await (await f.client.request(`/imports/groups/${group.id}/results`)).json(),
    );
  await f.erase.remove(f.session, results.items[0]!.sessionId!, 1, crypto.randomUUID(), {
    receiptId: crypto.randomUUID(),
    receiptToken: randomToken(),
  });
  const restore = new OfflineRestore(cleanupBindings());
  await restore.prepare();
  await restoreSnapshot(env.DB, before);
  await restore.replay();
  expect(
    await env.DB.prepare(
      'SELECT count(*) n FROM import_identities WHERE source_record_enc IS NOT NULL',
    ).first('n'),
  ).toBe(0);
  expect(
    await env.DB.prepare(
      'SELECT count(*) n FROM import_items WHERE body_enc IS NOT NULL OR result_enc IS NOT NULL',
    ).first('n'),
  ).toBe(0);
  expect(
    await env.DB.prepare('SELECT state FROM import_groups WHERE id=?')
      .bind(staged.id)
      .first('state'),
  ).toBe('expired');
  expect(await env.DB.prepare('SELECT count(*) n FROM provider_dispatches').first('n')).toBe(1);
  expect(
    await env.DB.prepare(
      'SELECT model_allowed FROM permission_revisions ORDER BY revision DESC LIMIT 1',
    ).first('model_allowed'),
  ).toBe(0);
});

test('family deletion racing final publication never resurrects a duplicate source', async () => {
  const f = await fixture(),
    original = await importGroup();
  await commitGroup(f.client, original);
  const duplicate = await importGroup({ source: original.chunks[0]!.source }),
    ready = await uploadGroup(f.client, duplicate);
  const control = gate((sql) => sql.some((s) => s.includes("SET state='complete',preview_hmac"))),
    service = new ReadingImports(new RecordBase(control.db, f.base.identity));
  const pending = service.commitGroup(f.session, duplicate.id, crypto.randomUUID(), {
    version: 'import-group.v1',
    manifestHash: duplicate.manifestHash,
    previewHash: ready.previewHash!,
    confirmedRecovery: { kind: 'none' },
  });
  await control.ready;
  const row = await env.DB.prepare(
    'SELECT session_id FROM import_identities WHERE erased_at IS NULL',
  ).first<{ session_id: string }>();
  try {
    await f.erase.remove(f.session, row!.session_id, 1, crypto.randomUUID(), {
      receiptId: crypto.randomUUID(),
      receiptToken: randomToken(),
    });
  } finally {
    control.release();
  }
  expect((await pending).state).toBe('failed');
  expect(
    await env.DB.prepare(
      'SELECT count(*) n FROM import_identities WHERE source_record_enc IS NOT NULL',
    ).first('n'),
  ).toBe(0);
});

test('a pending deletion ledger outage fences imported outcome identities until physical erasure', async () => {
  const f = await fixture(),
    group = await importGroup();
  await commitGroup(f.client, group);
  const row = await env.DB.prepare('SELECT session_id FROM import_identities').first<{
    session_id: string;
  }>();
  const failing = new Proxy(env.RECOVERY, {
    get(target, property) {
      if (property === 'put')
        return () => {
          throw new Error('synthetic ledger outage');
        };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await expect(
    new SessionErasure(f.base, failing).remove(f.session, row!.session_id, 1, crypto.randomUUID(), {
      receiptId: crypto.randomUUID(),
      receiptToken: randomToken(),
    }),
  ).rejects.toThrow();
  const response = await f.client.request(`/imports/groups/${group.id}/results`);
  expect(response.status, await response.clone().text()).toBe(200);
  expect(
    apiSchemas.ImportGroupResultPage.parse(await response.json()).items[0]!.identity,
  ).toBeNull();
});

test('erasing context copies preserves the imported source reading itself', async () => {
  const f = await fixture(),
    group = await importGroup();
  await commitGroup(f.client, group);
  const row = await env.DB.prepare('SELECT edition_id FROM import_identities').first<{
    edition_id: string;
  }>();
  await env.DB.batch(
    eraseImportCopies(f.base, {
      scope: 'context_copy',
      subjectId: f.session.subjectId,
      source: { kind: 'edition', editionId: row!.edition_id },
    }),
  );
  expect(
    await env.DB.prepare('SELECT body_enc FROM reading_editions WHERE id=?')
      .bind(row!.edition_id)
      .first('body_enc'),
  ).not.toBeNull();
  expect(
    await env.DB.prepare('SELECT source_record_enc FROM import_identities WHERE edition_id=?')
      .bind(row!.edition_id)
      .first('source_record_enc'),
  ).not.toBeNull();
});

test('a pending source-copy erasure fences materialized copies but keeps the primary readable', async () => {
  const { portableGroups } = await import('../fixtures/import-workflows.ts');
  const { importFence } = await import('../../src/worker/readings/import-lifecycle.ts');
  const f = await fixture(),
    exported = await portableGroups(f.client);
  const original = exported.groups.find((g) => g.units.some((u) => u.identity.kind === 'session'))!;
  await commitGroup(f.client, original);
  const { buildImportGroups } = await import('../../src/domain/imports/chunks.ts');
  const copy = (await buildImportGroups(original.units, () => crypto.randomUUID()))[0]!;
  copy.chunks = copy.chunks.map((c) => ({
    ...c,
    source: { ...c.source, revision: 'deliberate-copy' },
    recovery: { kind: 'new_revision' as const, previousSource: c.source },
  }));
  await commitGroup(f.client, copy);
  const row = await env.DB.prepare(
    'SELECT edition_id FROM import_identities WHERE materialized=1 AND edition_id IS NOT NULL',
  ).first<{ edition_id: string }>();
  const target = {
    scope: 'context_copy' as const,
    subjectId: f.session.subjectId,
    source: { kind: 'edition' as const, editionId: f.reading.editionId },
  };
  await f.base.atomic(f.session, importFence(f.base, target), true);
  expect((await f.client.request(`/readings/${row!.edition_id}`)).status).toBe(410);
  expect((await f.client.request(`/readings/${f.reading.editionId}`)).status).toBe(200);
  await env.DB.batch(eraseImportCopies(f.base, target));
  expect(
    await env.DB.prepare('SELECT body_enc FROM reading_editions WHERE id=?')
      .bind(row!.edition_id)
      .first('body_enc'),
  ).toBeNull();
});
