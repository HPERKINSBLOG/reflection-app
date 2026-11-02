import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { apiSchemas } from '../../src/contracts/index.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { readingAccount } from '../fixtures/reading-client.ts';
import {
  importGroup,
  uploadGroup,
  commitGroup,
  portableGroups,
} from '../fixtures/import-workflows.ts';
import { fixture } from '../fixtures/revisits.ts';
import { nativeImport } from '../../src/worker/readings/import-native.ts';
import { identityKey } from '../../src/domain/imports/identity.ts';

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));

test('encrypted preview is inert; one acknowledged group imports with AI off and a lost response is idempotent', async () => {
  const { client } = await readingAccount(true, false),
    group = await importGroup();
  const staged = await uploadGroup(client, group);
  expect(staged).toMatchObject({ state: 'staged', totalItems: 1, completedItems: 0 });
  expect(staged.previewHash).toMatch(/^[a-f0-9]{64}$/);
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_sessions').first('n')).toBe(0);
  const rows = await env.DB.prepare('SELECT body_enc FROM import_items').all();
  expect(JSON.stringify(rows)).not.toContain('EXACT_IMPORTED_PROSE');
  const key = crypto.randomUUID(),
    input = {
      version: 'import-group.v1',
      manifestHash: group.manifestHash,
      previewHash: staged.previewHash,
      confirmedRecovery: { kind: 'none' },
    };
  const response = await client.request(`/imports/groups/${group.id}/commit`, input, { key });
  expect(response.status, await response.clone().text()).toBe(200);
  const complete = apiSchemas.ImportGroupStatus.parse(await response.json());
  expect(complete).toMatchObject({ state: 'complete', completedItems: 1 });
  expect(
    await (await client.request(`/imports/groups/${group.id}/commit`, input, { key })).json(),
  ).toEqual(complete);
  const page = apiSchemas.ImportGroupResultPage.parse(
    await (await client.request(`/imports/groups/${group.id}/results`)).json(),
  );
  expect(page.items).toMatchObject([{ status: 'imported', identity: group.units[0]!.identity }]);
  expect(page.items[0]!.sessionId).not.toBeNull();
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_sessions').first('n')).toBe(1);
  expect(await env.DB.prepare('SELECT count(*) n FROM provider_dispatches').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT count(*) n FROM context_grants').first('n')).toBe(0);
  const me = await client.me();
  expect(me.permission.modelAllowed).toBe(false);
});

test('preview and commit enforce CSRF, ownership, exact key payloads and the reviewed hash', async () => {
  const { client } = await readingAccount(),
    other = await readingAccount(),
    group = await importGroup();
  const key = crypto.randomUUID(),
    chunk = group.chunks[0]!;
  expect(
    (await client.request('/imports/preview', chunk, { headers: { 'X-CSRF-Token': 'wrong' } }))
      .status,
  ).toBe(403);
  expect((await client.request('/imports/preview', chunk, { key })).status).toBe(201);
  expect(
    (
      await client.request(
        '/imports/preview',
        { ...chunk, document: chunk.document + ' ' },
        { key },
      )
    ).status,
  ).toBe(409);
  expect((await other.client.request(`/imports/groups/${group.id}`)).status).toBe(404);
  expect((await other.client.request(`/imports/groups/${group.id}/results`)).status).toBe(404);
  const input = {
    version: 'import-group.v1',
    manifestHash: group.manifestHash,
    previewHash: 'a'.repeat(64),
    confirmedRecovery: { kind: 'none' },
  };
  expect((await other.client.request(`/imports/groups/${group.id}/commit`, input)).status).toBe(
    404,
  );
  expect((await client.request(`/imports/groups/${group.id}/commit`, input)).status).toBe(409);
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_sessions').first('n')).toBe(0);
});

test('a group spanning bounded previews publishes all 102 readings together and pages durable results', async () => {
  const { client } = await readingAccount(true, false),
    group = await importGroup({ children: 101 });
  expect(group.chunks.length).toBeGreaterThan(1);
  expect((await client.request('/imports/preview', group.chunks[0])).status).toBe(201);
  const partial = apiSchemas.ImportGroupStatus.parse(
    await (await client.request(`/imports/groups/${group.id}`)).json(),
  );
  expect(partial.previewHash).toBeNull();
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_editions').first('n')).toBe(0);
  for (const chunk of group.chunks.slice(1))
    expect((await client.request('/imports/preview', chunk)).status).toBe(201);
  const ready = apiSchemas.ImportGroupStatus.parse(
    await (await client.request(`/imports/groups/${group.id}`)).json(),
  );
  const response = await client.request(`/imports/groups/${group.id}/commit`, {
    version: 'import-group.v1',
    manifestHash: group.manifestHash,
    previewHash: ready.previewHash,
    confirmedRecovery: { kind: 'none' },
  });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(apiSchemas.ImportGroupStatus.parse(await response.json())).toMatchObject({
    state: 'complete',
    completedItems: 102,
  });
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_editions').first('n')).toBe(102);
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_sessions').first('n')).toBe(1);
  const first = apiSchemas.ImportGroupResultPage.parse(
    await (await client.request(`/imports/groups/${group.id}/results`)).json(),
  );
  expect(first.items).toHaveLength(100);
  const second = apiSchemas.ImportGroupResultPage.parse(
    await (
      await client.request(
        `/imports/groups/${group.id}/results?cursor=${encodeURIComponent(first.nextCursor!)}`,
      )
    ).json(),
  );
  expect(second.items).toHaveLength(2);
  expect(second.nextCursor).toBeNull();
  expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});

test('duplicate identities do not create another reading; normalized content changes conflict', async () => {
  const { client } = await readingAccount(),
    group = await importGroup();
  expect((await commitGroup(client, group)).status.state).toBe('complete');
  const same = await importGroup({ source: group.chunks[0]!.source });
  expect((await commitGroup(client, same)).status.state).toBe('complete');
  const page = apiSchemas.ImportGroupResultPage.parse(
    await (await client.request(`/imports/groups/${same.id}/results`)).json(),
  );
  expect(page.items[0]!.status).toBe('duplicate');
  const changed = await importGroup({ source: group.chunks[0]!.source, text: 'CHANGED_PROSE' });
  const preview = await client.request('/imports/preview', changed.chunks[0]);
  expect(preview.status, await preview.clone().text()).toBe(201);
  expect(apiSchemas.ImportPreview.parse(await preview.json()).items[0]!.status).toBe('conflict');
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_editions').first('n')).toBe(1);
});

test('native portable identities are stable across unrelated mutations and immutable edition numbers', async () => {
  const f = await fixture();
  const first = await f.exports.page(
    f.session,
    (await f.exports.create(f.session, crypto.randomUUID())).id,
    null,
  );
  await f.client.permission(false);
  const second = await f.exports.page(
    f.session,
    (await f.exports.create(f.session, crypto.randomUUID())).id,
    null,
  );
  const reading = (page: typeof first) => page.records.find((r) => r.kind === 'reading')!;
  expect(reading(first).identity).toEqual(reading(second).identity);
  expect(reading(second).identity).toMatchObject({
    source: { revision: 'native-v1' },
    recordRevision: 1,
  });
});

test('an actual D1 constraint failure rolls the entire group back and leaves a durable failed outcome', async () => {
  const { client } = await readingAccount(),
    group = await importGroup({ children: 1 });
  const ready = await uploadGroup(client, group);
  await env.DB.prepare(
    "CREATE TRIGGER import_test_failure BEFORE INSERT ON reading_editions WHEN NEW.edition_number=2 BEGIN SELECT RAISE(ABORT,'synthetic group failure'); END",
  ).run();
  const input = {
    version: 'import-group.v1',
    manifestHash: group.manifestHash,
    previewHash: ready.previewHash,
    confirmedRecovery: { kind: 'none' },
  };
  let response: Response;
  try {
    response = await client.request(`/imports/groups/${group.id}/commit`, input);
  } finally {
    await env.DB.prepare('DROP TRIGGER import_test_failure').run();
  }
  expect(response.status, await response.clone().text()).toBe(200);
  expect(apiSchemas.ImportGroupStatus.parse(await response.json()).state).toBe('failed');
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_sessions').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_editions').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT count(*) n FROM import_identities').first('n')).toBe(0);
  const results = apiSchemas.ImportGroupResultPage.parse(
    await (await client.request(`/imports/groups/${group.id}/results`)).json(),
  );
  expect(results.items.map((r) => r.status)).toEqual(['failed', 'failed']);
});

test('duplicate ordinals and expired staging cannot create records; recovery acknowledgement is required', async () => {
  const { client } = await readingAccount(false, false),
    group = await importGroup();
  const chunk = group.chunks[0]!,
    document = JSON.parse(chunk.document);
  document.items.push(document.items[0]);
  expect(
    (await client.request('/imports/preview', { ...chunk, document: JSON.stringify(document) }))
      .status,
  ).toBe(422);
  const ready = await uploadGroup(client, group),
    input = {
      version: 'import-group.v1',
      manifestHash: group.manifestHash,
      previewHash: ready.previewHash,
      confirmedRecovery: { kind: 'none' },
    };
  expect((await client.request(`/imports/groups/${group.id}/commit`, input)).status).toBe(403);
  await client.acknowledge();
  await env.DB.prepare('UPDATE import_groups SET expires_at=1').run();
  expect((await client.request(`/imports/groups/${group.id}/commit`, input)).status).toBe(410);
  expect(
    apiSchemas.ImportGroupStatus.parse(
      await (await client.request(`/imports/groups/${group.id}`)).json(),
    ).state,
  ).toBe('expired');
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_sessions').first('n')).toBe(0);
});

test('new source revisions require explicit prior-source recovery and never overwrite old content', async () => {
  const { client } = await readingAccount(),
    old = await importGroup();
  await commitGroup(client, old);
  const changed = await importGroup({
    source: old.chunks[0]!.source,
    text: 'DELIBERATE_NEW_REVISION',
  });
  const recovery = { kind: 'new_revision' as const, previousSource: old.chunks[0]!.source };
  changed.chunks = changed.chunks.map((c) => ({
    ...c,
    source: { ...c.source, revision: 'fixture-2' },
    recovery,
  }));
  const ready = await uploadGroup(client, changed);
  const input = {
    version: 'import-group.v1',
    manifestHash: changed.manifestHash,
    previewHash: ready.previewHash,
    confirmedRecovery: { kind: 'none' },
  };
  expect((await client.request(`/imports/groups/${changed.id}/commit`, input)).status).toBe(409);
  const accepted = await client.request(`/imports/groups/${changed.id}/commit`, {
    ...input,
    confirmedRecovery: recovery,
  });
  expect(accepted.status, await accepted.clone().text()).toBe(200);
  expect(apiSchemas.ImportGroupStatus.parse(await accepted.json()).state).toBe('complete');
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_editions').first('n')).toBe(2);
});

test('portable native families import as unverified owned copies without restoring permission or dispatch authority', async () => {
  const original = await fixture(),
    { groups } = await portableGroups(original.client),
    destination = await readingAccount(true, false);
  const family = groups.find((g) => g.units.some((u) => u.identity.kind === 'session'))!;
  expect((await commitGroup(destination.client, family)).status.state).toBe('complete');
  const page = apiSchemas.ImportGroupResultPage.parse(
    await (await destination.client.request(`/imports/groups/${family.id}/results`)).json(),
  );
  const sessionId = page.items.find((i) => i.identity?.kind === 'reading')!.sessionId!;
  const session = apiSchemas.SessionRecord.parse(
    await (await destination.client.request(`/sessions/${sessionId}`)).json(),
  );
  const reading = apiSchemas.Reading.parse(
    await (await destination.client.request(`/readings/${session.editionIds[0]}`)).json(),
  );
  expect(reading.kind).toBe('legacy.imported.v1');
  if (reading.kind === 'legacy.imported.v1')
    expect(JSON.parse(reading.record.originalJsonText).value).toEqual(original.reading);
  expect((await destination.client.me()).permission.modelAllowed).toBe(false);
  expect(await env.DB.prepare('SELECT count(*) n FROM provider_dispatches').first('n')).toBe(1);
  const permission = groups.find((g) => g.units.some((u) => u.identity.kind === 'permission'))!;
  expect((await commitGroup(destination.client, permission)).status.state).toBe('complete');
  expect((await destination.client.me()).permission.modelAllowed).toBe(false);
});

test('own-namespace native reimport reconciles actual IDs, revisions and body rather than trusting the namespace', async () => {
  const original = await fixture(),
    { groups } = await portableGroups(original.client);
  const group = groups.find((g) => g.units.some((u) => u.identity.kind === 'session'))!;
  for (const unit of group.units)
    expect(
      (await nativeImport(original.base, original.session, unit))?.matches,
      unit.identity.kind,
    ).toBe(true);
  const before = await env.DB.prepare('SELECT count(*) n FROM reading_editions').first('n');
  expect((await commitGroup(original.client, group)).status.state).toBe('complete');
  const results = apiSchemas.ImportGroupResultPage.parse(
    await (await original.client.request(`/imports/groups/${group.id}/results`)).json(),
  );
  expect(results.items.every((i) => i.status === 'duplicate')).toBe(true);
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_editions').first('n')).toBe(before);
});

test('a forged typed identity cannot turn a reading into grant metadata', async () => {
  const { client } = await readingAccount(),
    group = await importGroup(),
    chunk = group.chunks[0]!,
    document = JSON.parse(chunk.document);
  const unit = document.items[0].unit;
  unit.identity.kind = 'grant';
  unit.record.identity.kind = 'grant';
  unit.key = identityKey(unit.identity);
  const response = await client.request('/imports/preview', {
    ...chunk,
    document: JSON.stringify(document),
  });
  expect(response.status, await response.clone().text()).toBe(422);
  expect(await env.DB.prepare('SELECT count(*) n FROM import_items').first('n')).toBe(0);
});

test('near-capacity preview and publication fail explicitly without leaving partial records', async () => {
  const { client } = await readingAccount(),
    group = await importGroup();
  const original = await env.DB.prepare('SELECT storage_bytes FROM accounts').first<number>(
    'storage_bytes',
  );
  await env.DB.prepare('UPDATE accounts SET storage_bytes=20971500').run();
  const full = await client.request('/imports/preview', group.chunks[0]);
  expect(((await full.json()) as { error: { code: string } }).error.code).toBe(
    'STORAGE_LIMIT_EXCEEDED',
  );
  expect(await env.DB.prepare('SELECT count(*) n FROM import_groups').first('n')).toBe(0);
  await env.DB.prepare('UPDATE accounts SET storage_bytes=?').bind(original).run();
  const ready = await uploadGroup(client, group);
  await env.DB.prepare('UPDATE accounts SET storage_bytes=20970000').run();
  const commit = await client.request(`/imports/groups/${group.id}/commit`, {
    version: 'import-group.v1',
    manifestHash: group.manifestHash,
    previewHash: ready.previewHash,
    confirmedRecovery: { kind: 'none' },
  });
  expect(((await commit.json()) as { error: { code: string } }).error.code).toBe(
    'STORAGE_LIMIT_EXCEEDED',
  );
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_sessions').first('n')).toBe(0);
});

test('a committing group resumes after interruption; changed AI permission is allowed and revoked authentication is not', async () => {
  const { client } = await readingAccount(),
    group = await importGroup(),
    ready = await uploadGroup(client, group);
  await client.permission(false);
  await env.DB.prepare("UPDATE import_groups SET state='committing',preview_hmac=? WHERE id=?")
    .bind(ready.previewHash, group.id)
    .run();
  const input = {
    version: 'import-group.v1',
    manifestHash: group.manifestHash,
    previewHash: ready.previewHash,
    confirmedRecovery: { kind: 'none' },
  };
  const response = await client.request(`/imports/groups/${group.id}/commit`, input);
  expect(response.status, await response.clone().text()).toBe(200);
  expect(apiSchemas.ImportGroupStatus.parse(await response.json()).state).toBe('complete');
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_editions').first('n')).toBe(1);
  await client.request('/auth/logout-all', {});
  expect((await client.request(`/imports/groups/${group.id}/commit`, input)).status).toBe(401);
});
