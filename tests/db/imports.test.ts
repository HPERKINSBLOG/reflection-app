import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { ImportChunkDocument, ImportedReading } from '../../src/contracts/index.ts';
import { buildImportGroups } from '../../src/domain/imports/chunks.ts';
import { parseImportFile } from '../../src/domain/imports/parse.ts';
import { localIdentity } from '../../src/worker/identity/routes.ts';
import { ReadingImports } from '../../src/worker/readings/imports.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { readingAccount, readingBindings } from '../fixtures/reading-client.ts';
import { largeImportFamilyDocument } from '../fixtures/imports/large-family.ts';

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));
const source = { namespaceId: '11111111-1111-4111-8111-111111111111', revision: 'original' };
const none = { kind: 'none' as const };
async function account() {
  const f = await readingAccount(true, false);
  const identity = localIdentity(readingBindings)!;
  const session = await identity.sessions.get(f.client.cookies.get('__Host-session'));
  return { ...f, session, imports: new ReadingImports(env.DB, identity) };
}
async function family(document: string, proposed = source) {
  const parsed = await parseImportFile({
    source: proposed,
    recovery: none,
    format: 'tarot-json',
    document,
  });
  const [group] = await buildImportGroups(parsed.units, () => crypto.randomUUID());
  return group!;
}
const small = (question = 'Original question') =>
  JSON.stringify({
    exportedAt: 'unknown',
    entryCount: 1,
    entries: [{ id: 'base', question, personalReading: 'Original text' }],
  });
test('the import service stages 102 units across 11 uploads, returns bounded durable outcomes and accepts the lost-ack retry', async () => {
  const f = await account();
  const group = await family(largeImportFamilyDocument());
  const key = crypto.randomUUID(),
    first = await f.imports.preview(f.session, key, group.chunks[0]!);
  expect(await f.imports.preview(f.session, key, group.chunks[0]!)).toEqual(first);
  await expect(f.imports.preview(f.session, key, group.chunks[1]!)).rejects.toMatchObject({
    code: 'IDEMPOTENCY_MISMATCH',
  });
  expect((await f.imports.groupStatus(f.session, group.id)).previewHash).toBeNull();
  for (const chunk of group.chunks.slice(1))
    await f.imports.preview(f.session, crypto.randomUUID(), chunk);
  const reviewed = await f.imports.groupStatus(f.session, group.id);
  expect(reviewed).toMatchObject({
    state: 'staged',
    totalItems: 102,
    completedItems: 0,
    previewHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  const body = {
    version: 'import-group.v1' as const,
    manifestHash: group.manifestHash,
    previewHash: reviewed.previewHash!,
    confirmedRecovery: none,
  };
  await expect(
    f.imports.commitGroup(f.session, group.id, crypto.randomUUID(), {
      ...body,
      previewHash: '0'.repeat(64),
    }),
  ).rejects.toMatchObject({ status: 409 });
  const commitKey = crypto.randomUUID();
  const completed = await f.imports.commitGroup(f.session, group.id, commitKey, body);
  expect(completed).toMatchObject({ state: 'complete', completedItems: 102 });
  expect(await f.imports.commitGroup(f.session, group.id, commitKey, body)).toEqual(completed);
  const page = await f.imports.groupResults(f.session, group.id, null);
  expect(page.items).toHaveLength(100);
  expect(page.nextCursor).not.toBeNull();
  const tail = await f.imports.groupResults(f.session, group.id, page.nextCursor);
  expect(tail.items.map((r) => r.index)).toEqual([100, 101]);
  expect(tail.nextCursor).toBeNull();
  expect(new Set([...page.items, ...tail.items].map((r) => r.sessionId)).size).toBe(1);
  expect(
    await env.DB.prepare("SELECT count(*) n FROM reading_editions WHERE status='imported'").first(
      'n',
    ),
  ).toBe(102);
  expect(await env.DB.prepare('SELECT count(*) n FROM provider_dispatches').first('n')).toBe(0);
  const foreign = await account();
  await expect(f.imports.groupStatus(foreign.session, group.id)).rejects.toMatchObject({
    status: 404,
  });
});

test('private preview expiry and a duplicate ordinal forbid publication and preserve saved rows', async () => {
  const f = await account();
  const g = await family(small());
  const key = crypto.randomUUID(),
    chunk = g.chunks[0]!;
  await f.imports.preview(f.session, key, chunk);
  const document = ImportChunkDocument.parse(JSON.parse(chunk.document));
  await expect(
    f.imports.preview(f.session, crypto.randomUUID(), {
      ...chunk,
      document: JSON.stringify({ ...document, items: [...document.items, ...document.items] }),
    }),
  ).rejects.toMatchObject({ code: 'IMPORT_INVALID' });
  const status = await f.imports.groupStatus(f.session, g.id);
  await env.DB.prepare('UPDATE import_groups SET expires_at=1 WHERE id=?').bind(g.id).run();
  expect((await f.imports.groupStatus(f.session, g.id)).state).toBe('expired');
  await expect(
    f.imports.commitGroup(f.session, g.id, crypto.randomUUID(), {
      version: 'import-group.v1',
      manifestHash: g.manifestHash,
      previewHash: status.previewHash!,
      confirmedRecovery: none,
    }),
  ).rejects.toMatchObject({ status: 410 });
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_editions').first('n')).toBe(0);
});

test('the same alias duplicates, changed content conflicts, and a revision label alone cannot bypass erasure', async () => {
  const f = await account();
  const submit = async (question: string, src = source) => {
    const g = await family(small(question), src);
    const p = await f.imports.preview(f.session, crypto.randomUUID(), g.chunks[0]!);
    return {
      g,
      p,
      commit: async () => {
        const status = await f.imports.groupStatus(f.session, g.id);
        return f.imports.commitGroup(f.session, g.id, crypto.randomUUID(), {
          version: 'import-group.v1',
          manifestHash: g.manifestHash,
          previewHash: status.previewHash!,
          confirmedRecovery: none,
        });
      },
    };
  };
  const first = await submit('Question');
  expect(first.p.items[0]?.status).toBe('ready');
  await first.commit();
  const duplicate = await submit('Question');
  expect(duplicate.p.items[0]?.status).toBe('duplicate');
  await duplicate.commit();
  expect((await submit('Changed')).p.items[0]?.status).toBe('conflict');
  const id = await env.DB.prepare(
    "SELECT id FROM reading_editions WHERE mode='legacy'",
  ).first<string>('id');
  expect(
    ImportedReading.parse(await (await f.client.request(`/readings/${id}`)).json()).record.question,
  ).toBe('Question');
  await env.DB.prepare(
    'UPDATE import_identities SET source_record_enc=NULL,session_id=NULL,edition_id=NULL,erased_at=1',
  ).run();
  const erased = await submit('Question', { ...source, revision: 'renamed' });
  expect(erased.p.items[0]?.status).toBe('erased');
});

async function stageOne(
  f: Awaited<ReturnType<typeof account>>,
  question: string,
  namespace = source,
  recovery: import('../../src/domain/imports/types.ts').Recovery = none,
) {
  const group = await family(
    small(question),
    recovery.kind === 'none' ? namespace : recovery.previousSource,
  );
  const input = { ...group.chunks[0]!, source: namespace, recovery };
  const preview = await f.imports.preview(f.session, crypto.randomUUID(), input);
  const reviewed = await f.imports.groupStatus(f.session, group.id);
  const body = {
    version: 'import-group.v1' as const,
    manifestHash: group.manifestHash,
    previewHash: reviewed.previewHash!,
    confirmedRecovery: recovery,
  };
  return {
    group,
    preview,
    body,
    commit: (key = crypto.randomUUID()) => f.imports.commitGroup(f.session, group.id, key, body),
  };
}
test('a confirmed source correction and a separately confirmed namespace recovery preserve previous live copies and tombstones', async () => {
  const f = await account(),
    first = await stageOne(f, 'First');
  await first.commit();
  const revised = { ...source, revision: 'correction' },
    declaration = { kind: 'new_revision' as const, previousSource: source };
  expect((await stageOne(f, 'Second', revised)).preview.items[0]?.status).toBe('conflict');
  const correction = await stageOne(f, 'Second', revised, declaration);
  expect(correction.preview.items[0]).toMatchObject({
    status: 'ready',
    identity: { source: revised },
  });
  await expect(
    f.imports.commitGroup(f.session, correction.group.id, crypto.randomUUID(), {
      ...correction.body,
      confirmedRecovery: none,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await correction.commit();
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_editions').first('n')).toBe(2);
  await env.DB.prepare(
    'UPDATE import_identities SET source_record_enc=NULL,session_id=NULL,edition_id=NULL,erased_at=1',
  ).run();
  const fresh = { namespaceId: crypto.randomUUID(), revision: 'restored' },
    recovery = { kind: 'reimport_erased' as const, previousSource: source };
  expect((await stageOne(f, 'First', source, recovery)).preview.items[0]?.status).toBe('invalid');
  const restored = await stageOne(f, 'First', fresh, recovery);
  expect(restored.preview.items[0]).toMatchObject({ status: 'ready', identity: { source: fresh } });
  await expect(
    f.imports.commitGroup(f.session, restored.group.id, crypto.randomUUID(), {
      ...restored.body,
      confirmedRecovery: none,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await restored.commit();
  expect(
    await env.DB.prepare(
      'SELECT count(*) n FROM import_identities WHERE erased_at IS NOT NULL AND source_record_enc IS NULL',
    ).first('n'),
  ).toBe(2);
  expect(
    await env.DB.prepare('SELECT count(*) n FROM import_identities WHERE erased_at IS NULL').first(
      'n',
    ),
  ).toBe(1);
});

test('cancellation reconciles a lost response for the submitted group and leaves the next real group staged', async () => {
  const { runImportGroups } = await import('../../src/domain/imports/chunks.ts');
  const f = await account(),
    one = await stageOne(f, 'One', source),
    two = await stageOne(f, 'Two', { ...source, namespaceId: crypto.randomUUID() });
  const abort = new AbortController();
  const result = await runImportGroups(
    [one.group.id, two.group.id],
    abort.signal,
    async (id) => {
      expect(id).toBe(one.group.id);
      await one.commit();
      abort.abort();
      throw new Error('Lost HTTP acknowledgement');
    },
    async (id) => (await f.imports.groupStatus(f.session, id)).state,
  );
  expect(result).toEqual([{ groupId: one.group.id, outcome: 'complete' }]);
  expect((await f.imports.groupStatus(f.session, two.group.id)).state).toBe('staged');
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_editions').first('n')).toBe(1);
});

test('a fresh worker reconciles interrupted submission as a failed group without exposing any edition', async () => {
  const f = await account(),
    staged = await stageOne(f, 'Interrupted'),
    id = staged.group.id;
  let lost = false;
  const db = new Proxy(env.DB, {
    get(target, property) {
      if (property === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          const value = await target.batch(statements);
          if (
            !lost &&
            (await target
              .prepare("SELECT 1 FROM import_groups WHERE id=? AND state='committing'")
              .bind(id)
              .first())
          ) {
            lost = true;
            throw new Error('Lost worker after accepted commit');
          }
          return value;
        };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const key = crypto.randomUUID();
  expect(
    (await new ReadingImports(db, f.imports.identity).commitGroup(f.session, id, key, staged.body))
      .state,
  ).toBe('committing');
  expect(lost).toBe(true);
  await env.DB.prepare('UPDATE import_groups SET lease_until=1 WHERE id=?').bind(id).run();
  expect((await f.imports.groupStatus(f.session, id)).state).toBe('failed');
  expect((await f.imports.commitGroup(f.session, id, key, staged.body)).state).toBe('failed');
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_editions').first('n')).toBe(0);
  expect(
    await env.DB.prepare('SELECT count(*) n FROM import_items WHERE body_enc IS NOT NULL').first(
      'n',
    ),
  ).toBe(0);
});

test('the daily group limit counts logical submissions while allowing more chunks and retrying an existing group', async () => {
  const f = await account();
  const large = await family(largeImportFamilyDocument());
  const firstKey = crypto.randomUUID();
  await f.imports.preview(f.session, firstKey, large.chunks[0]!);
  for (let n = 0; n < 9; n++)
    await stageOne(f, `Group ${n}`, { namespaceId: crypto.randomUUID(), revision: 'original' });
  const extra = await family(small('Eleventh'));
  await expect(
    f.imports.preview(f.session, crypto.randomUUID(), extra.chunks[0]!),
  ).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' });
  await f.imports.preview(f.session, firstKey, large.chunks[0]!);
  for (const chunk of large.chunks.slice(1))
    await f.imports.preview(f.session, crypto.randomUUID(), chunk);
  expect((await f.imports.groupStatus(f.session, large.id)).previewHash).toBeTruthy();
  expect(await env.DB.prepare('SELECT count(*) n FROM import_groups').first('n')).toBe(10);
});

test('capacity, pending erasure, and revoked authentication all keep an unsubmitted group private', async () => {
  const f = await account(),
    group = await family(small('Private'));
  await env.DB.prepare('UPDATE accounts SET storage_bytes=20971520 WHERE id=?')
    .bind(f.session.subjectId)
    .run();
  await expect(
    f.imports.preview(f.session, crypto.randomUUID(), group.chunks[0]!),
  ).rejects.toMatchObject({ code: 'STORAGE_LIMIT_EXCEEDED' });
  expect(await env.DB.prepare('SELECT count(*) n FROM import_batches').first('n')).toBe(0);
  await env.DB.prepare('UPDATE accounts SET storage_bytes=100000 WHERE id=?')
    .bind(f.session.subjectId)
    .run();
  const staged = await stageOne(f, 'Private');
  await env.DB.prepare(
    "INSERT INTO deletion_jobs(id,owner_id,scope,target_hmac,state,ledger_key,next_run_at,created_at) VALUES('pending',?,'session','target','ledger_pending','ledger',1,1)",
  )
    .bind(f.session.subjectId)
    .run();
  await expect(staged.commit()).rejects.toMatchObject({ status: 409 });
  expect((await f.imports.groupStatus(f.session, staged.group.id)).state).toBe('staged');
  await env.DB.prepare("DELETE FROM deletion_jobs WHERE id='pending'").run();
  await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?')
    .bind(f.session.tokenHash)
    .run();
  await expect(staged.commit()).rejects.toThrow();
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_editions').first('n')).toBe(0);
});

test('old snapshot identities require a match to the current owner and value; another account imports its own remapped history', async () => {
  const { fixture } = await import('../fixtures/revisits.ts');
  const f = await fixture(),
    imports = new ReadingImports(env.DB, f.base.identity);
  const page = await f.exports.page(
    f.session,
    (await f.exports.create(f.session, crypto.randomUUID())).id,
    null,
  );
  const native = page.records.find((r) => r.kind === 'session')!;
  const candidate = async (
    view: ReadingImports,
    session: typeof f.session,
    record: typeof native,
  ) => {
    const document = JSON.stringify({ ...page, account: null, records: [record] });
    const parsed = await parseImportFile({
      format: 'reflection-export.v1',
      source: record.identity.source,
      recovery: none,
      document,
    });
    const [g] = await buildImportGroups(parsed.units, () => crypto.randomUUID());
    const p = await view.preview(session, crypto.randomUUID(), g!.chunks[0]!);
    const status = await view.groupStatus(session, g!.id);
    return {
      status: p.items[0]?.status,
      commit: () =>
        view.commitGroup(session, g!.id, crypto.randomUUID(), {
          version: 'import-group.v1',
          manifestHash: g!.manifestHash,
          previewHash: status.previewHash!,
          confirmedRecovery: none,
        }),
    };
  };
  const identity = {
    ...native.identity,
    source: { ...native.identity.source, revision: `snapshot-${page.snapshotRevision}` },
  };
  const legacy = { ...native, identity };
  const exact = await candidate(imports, f.session, legacy);
  expect(exact.status).toBe('duplicate');
  await exact.commit();
  const forged = { ...legacy, value: { ...legacy.value, question: 'Changed native contents' } };
  expect((await candidate(imports, f.session, forged)).status).toBe('conflict');
  const ambiguous = {
    ...legacy,
    identity: { ...identity, recordRevision: 99 },
    value: { ...legacy.value, revision: 99 },
  };
  expect((await candidate(imports, f.session, ambiguous)).status).toBe('conflict');
  const foreign = await account();
  const copy = await candidate(foreign.imports, foreign.session, legacy);
  expect(copy.status).toBe('ready');
  await copy.commit();
  expect((await foreign.client.request(`/sessions/${native.value.id}`)).status).toBe(404);
  const local = await env.DB.prepare('SELECT id FROM reading_sessions WHERE owner_id=?')
    .bind(foreign.session.subjectId)
    .first('id');
  expect(local).toBeTypeOf('string');
  expect(local).not.toBe(native.value.id);
});

test('invalid preview items count toward the 100-item bound before any encrypted rows are written', async () => {
  const f = await account();
  const document = JSON.stringify({
    entryCount: 101,
    exportedAt: 'unknown',
    entries: Array.from({ length: 101 }, () => ({ unsupportedField: true })),
  });
  await expect(
    f.imports.preview(f.session, crypto.randomUUID(), {
      format: 'tarot-json',
      source,
      recovery: none,
      document,
    }),
  ).rejects.toMatchObject({ status: 413, code: 'INPUT_TOO_LARGE' });
  expect(await env.DB.prepare('SELECT count(*) n FROM import_items').first('n')).toBe(0);
});

test('an actual mid-publication failure rolls all imported targets and aliases back and releases private staging', async () => {
  const f = await account(),
    staged = await stageOne(f, 'Rollback');
  await env.DB.prepare(
    "CREATE TRIGGER injected_import_abort BEFORE INSERT ON import_identities BEGIN SELECT RAISE(ABORT,'injected final alias failure'); END",
  ).run();
  try {
    await expect(staged.commit()).rejects.toThrow();
    expect((await f.imports.groupStatus(f.session, staged.group.id)).state).toBe('failed');
    const counts = await env.DB.prepare(
      'SELECT (SELECT count(*) FROM reading_editions) editions,(SELECT count(*) FROM reading_sessions) sessions,(SELECT count(*) FROM import_identities) aliases,(SELECT count(*) FROM import_staging) staging',
    ).first();
    expect(counts).toEqual({ editions: 0, sessions: 0, aliases: 0, staging: 0 });
  } finally {
    await env.DB.prepare('DROP TRIGGER injected_import_abort').run();
  }
});

test('the preview capacity boundary includes the new group plus idempotency record and reports its actual limit', async () => {
  const f = await account(),
    owner = f.session.subjectId;
  const usage = () =>
    env.DB.prepare('SELECT storage_bytes FROM accounts WHERE id=?')
      .bind(owner)
      .first<number>('storage_bytes');
  const before = (await usage())!;
  await stageOne(f, 'Exact size');
  const footprint = (await usage())! - before;
  const second = await family(small('Exact size'));
  await env.DB.prepare('UPDATE accounts SET storage_bytes=? WHERE id=?')
    .bind(20971520 - footprint + 1, owner)
    .run();
  await expect(
    f.imports.preview(f.session, crypto.randomUUID(), second.chunks[0]!),
  ).rejects.toMatchObject({ status: 409, code: 'STORAGE_LIMIT_EXCEEDED' });
  await env.DB.prepare('UPDATE accounts SET storage_bytes=? WHERE id=?')
    .bind(20971520 - footprint, owner)
    .run();
  await f.imports.preview(f.session, crypto.randomUUID(), second.chunks[0]!);
  expect(await usage()).toBe(20971520);
});

test('an upload reports an oversized individual source record using the bounded adapter error', async () => {
  const f = await account();
  const document = JSON.stringify({
    schema_version: '0.7.0',
    readings: { items: [{ id: 'large', artifact: { data: 'x'.repeat(100000) }, evidence: null }] },
  });
  const p = await f.imports.preview(f.session, crypto.randomUUID(), {
    format: 'patternlike-export',
    source,
    recovery: none,
    document,
  });
  expect(p.items).toMatchObject([{ status: 'invalid', error: 'INPUT_TOO_LARGE' }]);
});

test('preview expiry during staging rolls publication back and reconciles the group as expired', async () => {
  const f = await account(),
    staged = await stageOne(f, 'Expires before commit');
  let crossed = false;
  const db = new Proxy(env.DB, {
    get(target, property) {
      if (property === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          const result = await target.batch(statements);
          if (
            !crossed &&
            (await target
              .prepare('SELECT 1 FROM import_staging WHERE owner_id=? AND group_id=?')
              .bind(f.session.subjectId, staged.group.id)
              .first())
          ) {
            crossed = true;
            await target
              .prepare('UPDATE import_groups SET expires_at=1 WHERE id=?')
              .bind(staged.group.id)
              .run();
          }
          return result;
        };
      const v = Reflect.get(target, property, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  await expect(
    new ReadingImports(db, f.imports.identity).commitGroup(
      f.session,
      staged.group.id,
      crypto.randomUUID(),
      staged.body,
    ),
  ).rejects.toMatchObject({ status: 410, code: 'EXPIRED' });
  expect(crossed).toBe(true);
  expect((await f.imports.groupStatus(f.session, staged.group.id)).state).toBe('expired');
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_editions').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT count(*) n FROM import_staging').first('n')).toBe(0);
});

test('two tabs staging the same chunk under different keys join one durable preview and one published group', async () => {
  const f = await account(),
    g = await family(small('Two tabs')),
    chunk = g.chunks[0]!;
  const keys = [crypto.randomUUID(), crypto.randomUUID()];
  const previews = await Promise.all(keys.map((key) => f.imports.preview(f.session, key, chunk)));
  expect(new Set(previews.map((p) => p.id)).size).toBe(1);
  expect(await env.DB.prepare('SELECT count(*) n FROM import_batches').first('n')).toBe(1);
  const status = await f.imports.groupStatus(f.session, g.id);
  const body = {
      version: 'import-group.v1' as const,
      confirmedRecovery: none,
      manifestHash: g.manifestHash,
      previewHash: status.previewHash!,
    },
    commitKey = crypto.randomUUID();
  const attempts = await Promise.all([
    f.imports.commitGroup(f.session, g.id, commitKey, body),
    f.imports.commitGroup(f.session, g.id, commitKey, body),
  ]);
  expect(attempts.every((r) => r.state === 'committing' || r.state === 'complete')).toBe(true);
  expect((await f.imports.groupStatus(f.session, g.id)).state).toBe('complete');
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_editions').first('n')).toBe(1);
});

test('joining the active commit with a second retry key preserves the first worker’s publication fence', async () => {
  const f = await account(),
    staged = await stageOne(f, 'Already committing');
  const joinKey = crypto.randomUUID();
  let joined = false;
  const driver = new Proxy(env.DB, {
    get(target, property) {
      if (property === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          const result = await target.batch(statements);
          if (
            !joined &&
            (await target
              .prepare('SELECT 1 FROM import_staging WHERE owner_id=? AND group_id=?')
              .bind(f.session.subjectId, staged.group.id)
              .first())
          ) {
            joined = true;
            expect(
              (await f.imports.commitGroup(f.session, staged.group.id, joinKey, staged.body)).state,
            ).toBe('committing');
          }
          return result;
        };
      const v = Reflect.get(target, property, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  const completed = await new ReadingImports(driver, f.imports.identity).commitGroup(
    f.session,
    staged.group.id,
    crypto.randomUUID(),
    staged.body,
  );
  expect(joined).toBe(true);
  expect(completed.state).toBe('complete');
  expect(
    (await f.imports.commitGroup(f.session, staged.group.id, joinKey, staged.body)).state,
  ).toBe('complete');
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_editions').first('n')).toBe(1);
});
