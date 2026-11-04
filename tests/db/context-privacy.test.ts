import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { apiSchemas, SelectedFragment } from '../../src/contracts/index.ts';
import { statement as q } from '../../src/worker/db/core.ts';
import { randomToken } from '../../src/worker/identity/crypto.ts';
import { SessionErasure } from '../../src/worker/readings/erasure.ts';
import { objects, type Target } from '../../src/worker/recovery/ledger.ts';
import { OfflineRestore } from '../../src/worker/recovery/restore.ts';
import { OfflineCleanup } from '../../src/worker/recovery/cleanup.ts';
import { RetentionMaintenance } from '../../src/worker/maintenance/retention.ts';
import { cleanupBindings, localBackup } from '../fixtures/cleanup.ts';
import { ReadingClient, readingBindings } from '../fixtures/reading-client.ts';
import { failingDatabase } from '../fixtures/failing-generation-db.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { edited, fixture, note } from '../fixtures/revisits.ts';
import { restoreSnapshot, snapshot } from '../fixtures/snapshot.ts';

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(async () => {
  await clearDatabase(env.DB);
  for (const object of await objects(env.RECOVERY, '')) await env.RECOVERY.delete(object.key);
});
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Source = Extract<Target, { scope: 'context_copy' }>['source'];
const proof = () => ({ receiptId: crypto.randomUUID(), receiptToken: randomToken() });

// The continuity writer is still dormant. Seed its FK-backed provenance and real
// account ciphertext on requests/dispatches produced by the existing Worker.
async function select(f: Fixture, request: string, source: Source, text: string, ordinal = 0) {
  const owner = f.session.subjectId,
    id = crypto.randomUUID();
  const edition = source.kind === 'edition' ? source.editionId : null;
  const reflection = source.kind === 'reflection_revision' ? source.reflectionId : null;
  const revisit = source.kind === 'revisit_revision' ? source.revisitId : null;
  const revision = source.kind === 'edition' ? 1 : source.revision;
  const fragment = SelectedFragment.parse({
    ordinal,
    grantId: id,
    grantRevision: 1,
    sourceKind: source.kind,
    sourceId: edition ?? reflection ?? revisit,
    sourceRevision: revision,
    start: 0,
    end: [...text].length,
    text,
    textHash: 'a'.repeat(64),
    availability: 'retained',
    authorship: edition ? 'generated' : 'user',
  });
  const body = await f.base.crypt.seal(
    {
      ownerId: owner,
      table: 'generation_context',
      column: 'fragment_enc',
      recordId: `${request}:${ordinal}`,
      aadRevision: 1,
    },
    fragment,
    1,
  );
  await env.DB.batch([
    q(
      env.DB,
      "INSERT INTO context_grants(id,owner_id,edition_id,reflection_id,reflection_revision,revisit_id,revisit_revision,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'allowed',1,1)",
      id,
      owner,
      edition,
      reflection,
      reflection ? revision : null,
      revisit,
      revisit ? revision : null,
    ),
    q(
      env.DB,
      'INSERT INTO generation_context VALUES(?,?,?,?,1,?,?,1)',
      request,
      owner,
      ordinal,
      id,
      body,
      fragment.textHash,
    ),
    q(
      env.DB,
      'UPDATE generation_requests SET context_count=context_count+1 WHERE owner_id=? AND id=?',
      owner,
      request,
    ),
  ]);
  return id;
}
const noteSource = (id: string, revision = 1): Source => ({
  kind: 'revisit_revision',
  revisitId: id,
  revision,
});
const row = (sql: string, ...values: string[]) => q(env.DB, sql, ...values).first();
const copy = (grant: string) =>
  row('SELECT fragment_enc,fragment_hmac FROM generation_context WHERE grant_id=?', grant);
const grantState = (grant: string) =>
  q(env.DB, 'SELECT state FROM context_grants WHERE id=?', grant).first('state');
async function expectPrivateCopiesGone(request: string, edition: string) {
  expect(
    await row('SELECT input_enc,plan_enc,plan_hmac FROM generation_requests WHERE id=?', request),
  ).toEqual({ input_enc: null, plan_enc: null, plan_hmac: null });
  expect(
    await row(
      'SELECT transmission_enc,candidate_enc,provider_response_id_enc FROM provider_dispatches WHERE request_id=?',
      request,
    ),
  ).toEqual({ transmission_enc: null, candidate_enc: null, provider_response_id_enc: null });
  expect(
    await row('SELECT status,body_enc,invalidated_at FROM reading_editions WHERE id=?', edition),
  ).toEqual({ status: 'withdrawn', body_enc: null, invalidated_at: expect.any(Number) });
}

test('whole-note erasure traverses selections of derived editions and leaves independent excerpts, originals and cost liability intact at capacity', async () => {
  const f = await fixture(),
    original = await note(f),
    neighbor = await note(f, 'Keep this note');
  const one = await f.client.create('First downstream question'),
    two = await f.client.create('Second downstream question');
  const exact = await select(f, one.started.requestId, noteSource(original.id), original.note);
  const independent = await select(
    f,
    one.started.requestId,
    noteSource(neighbor.id),
    neighbor.note,
    1,
  );
  const downstream = await select(
    f,
    two.started.requestId,
    { kind: 'edition', editionId: one.reading.editionId },
    'Derived excerpt',
  );
  const keep = await copy(independent);
  await q(
    env.DB,
    "UPDATE cost_reservations SET state='unknown',actual_microusd=NULL WHERE dispatch_id IN (SELECT id FROM provider_dispatches WHERE request_id=?)",
    one.started.requestId,
  ).run();
  const liability = () =>
    row(
      'SELECT c.id,c.state,c.reserved_microusd,c.actual_microusd FROM cost_reservations c JOIN provider_dispatches d ON d.id=c.dispatch_id WHERE d.request_id=?',
      one.started.requestId,
    );
  const before = await liability();
  expect(before).toMatchObject({
    state: 'unknown',
    reserved_microusd: expect.any(Number),
    actual_microusd: null,
  });
  await q(
    env.DB,
    "WITH RECURSIVE pressure(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM pressure WHERE n<20480) INSERT INTO export_tickets SELECT 'pressure-'||n,?,1,1,9999999999999 FROM pressure",
    f.session.subjectId,
  ).run();
  expect(
    await q(
      env.DB,
      'SELECT storage_bytes FROM accounts WHERE id=?',
      f.session.subjectId,
    ).first<number>('storage_bytes'),
  ).toBeGreaterThan(20 * 1024 * 1024);
  expect(
    (await f.erase.removeRevisit(f.session, original.id, 1, crypto.randomUUID(), proof())).state,
  ).toBe('complete');
  for (const id of [exact, downstream]) {
    expect(await copy(id)).toEqual({ fragment_enc: null, fragment_hmac: '' });
    expect(await grantState(id)).toBe('revoked');
  }
  for (const value of [one, two])
    await expectPrivateCopiesGone(value.started.requestId, value.reading.editionId);
  expect(await liability()).toEqual(before);
  expect(await copy(independent)).toEqual(keep);
  expect(await f.notes.read(f.session, neighbor.id)).toEqual(neighbor);
  expect(await (await f.client.request(`/readings/${f.reading.editionId}`)).json()).toEqual(
    f.reading,
  );
});

test('the admission fence hides derived readings and revokes their eligibility before an interrupted erasure can be retried', async () => {
  const f = await fixture(),
    original = await note(f);
  const child = await f.client.create('Fenced child');
  const grant = await select(f, child.started.requestId, noteSource(original.id), original.note);
  const bucket = new Proxy(env.RECOVERY, {
    get(target, key) {
      if (key === 'put')
        return () => {
          throw new Error('ledger unavailable');
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const receipt = proof();
  await expect(
    new SessionErasure(f.base, bucket).removeRevisit(
      f.session,
      original.id,
      1,
      crypto.randomUUID(),
      receipt,
    ),
  ).rejects.toThrow();
  expect((await f.client.request(`/readings/${child.reading.editionId}`)).status).toBe(410);
  expect(await grantState(grant)).toBe('revoked');
  expect(await copy(grant)).toMatchObject({ fragment_enc: expect.any(String) });
  await f.erase.resume(receipt.receiptId);
  await expectPrivateCopiesGone(child.started.requestId, child.reading.editionId);
});

test('copy-only replay erases an exact absent historical revision and its downstream provenance after each stale restore', async () => {
  const f = await fixture(),
    { first, second } = await edited(f);
  const child = await f.client.create('Retained second revision'),
    next = await f.client.create('Follow-up to derived reading');
  const erase = await select(f, child.started.requestId, noteSource(first.id), first.note);
  const keep = await select(f, child.started.requestId, noteSource(first.id, 2), second.note, 1);
  await env.DB.batch([
    q(env.DB, 'DELETE FROM revisit_revisions WHERE revisit_id=? AND revision=1', first.id),
    q(
      env.DB,
      "UPDATE generation_requests SET parent_edition_id=?,operation='followup',session_id=?,basis_id=(SELECT basis_id FROM reading_editions WHERE id=?) WHERE id=?",
      child.reading.editionId,
      child.started.sessionId,
      child.reading.editionId,
      next.started.requestId,
    ),
    q(
      env.DB,
      'UPDATE reading_editions SET parent_edition_id=?,session_id=?,edition_number=2,basis_id=(SELECT basis_id FROM reading_editions WHERE id=?) WHERE id=?',
      child.reading.editionId,
      child.started.sessionId,
      child.reading.editionId,
      next.reading.editionId,
    ),
  ]);
  const backup = await snapshot(env.DB);
  const receipt = proof();
  await f.erase.ledger.putIntent(
    await f.erase.ledger.create(
      { scope: 'context_copy', subjectId: f.session.subjectId, source: noteSource(first.id) },
      receipt.receiptId,
      null,
      Date.now(),
    ),
  );
  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) await restoreSnapshot(env.DB, backup);
    const restore = new OfflineRestore(cleanupBindings());
    expect((await restore.replay()).status).toBe('verified');
    expect(await copy(erase)).toEqual({ fragment_enc: null, fragment_hmac: '' });
    expect(await copy(keep)).toMatchObject({ fragment_enc: expect.any(String) });
    expect(
      await row('SELECT note_enc,current_revision,deleted_at FROM revisits WHERE id=?', first.id),
    ).toMatchObject({ note_enc: expect.any(String), current_revision: 2, deleted_at: null });
    for (const value of [child, next])
      await expectPrivateCopiesGone(value.started.requestId, value.reading.editionId);
    expect(await grantState(keep)).toBe('revoked');
    expect(
      await row(
        'SELECT p.model_allowed,sys.generation_enabled,sys.dispatch_mode FROM accounts a JOIN permission_revisions p ON p.owner_id=a.id AND p.revision=a.permission_revision JOIN system_state sys ON sys.id=1 WHERE a.id=?',
        f.session.subjectId,
      ),
    ).toEqual({ model_allowed: 0, generation_enabled: 0, dispatch_mode: 'off' });
  }
  expect((await f.erase.ledger.load(receipt.receiptId)).passes).toHaveLength(2);
});

test.each(['session', 'account'] as const)(
  '%s deletion removes its owned copies and preserves unrelated accounts',
  async (scope) => {
    const f = await fixture(),
      first = await note(f);
    const other = await fixture(),
      child = await f.client.create('A separate reading that used my note');
    const grant = await select(f, child.started.requestId, noteSource(first.id), first.note);
    if (scope === 'session') {
      await f.erase.remove(f.session, f.started.sessionId, 2, crypto.randomUUID(), proof());
      await expectPrivateCopiesGone(child.started.requestId, child.reading.editionId);
      expect(await copy(grant)).toEqual({ fragment_enc: null, fragment_hmac: '' });
      expect(
        await row('SELECT body_enc,status FROM reading_editions WHERE id=?', f.reading.editionId),
      ).toEqual({ body_enc: null, status: 'deleted' });
      expect(await row('SELECT note_enc,deleted_at FROM revisits WHERE id=?', first.id)).toEqual({
        note_enc: null,
        deleted_at: expect.any(Number),
      });
      expect(
        await row('SELECT question_enc FROM reading_sessions WHERE id=?', child.started.sessionId),
      ).toMatchObject({ question_enc: expect.any(String) });
    } else {
      await f.erase.removeAccount(f.session, crypto.randomUUID(), proof());
      for (const table of [
        'generation_context',
        'context_grants',
        'generation_requests',
        'provider_dispatches',
        'reading_editions',
        'account_keys',
      ])
        expect(
          await row(`SELECT 1 FROM ${table} WHERE owner_id=?`, f.session.subjectId),
        ).toBeNull();
    }
    expect(
      await (await other.client.request(`/readings/${other.reading.editionId}`)).json(),
    ).toEqual(other.reading);
    expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  },
);

test('an erased reflection revision excludes its sibling from the sweep and cleanup checks the accepted copy before retiring evidence', async () => {
  const f = await fixture();
  const input = {
    editionId: f.reading.editionId,
    text: 'Exact old private revision',
    stance: 'unsure',
  };
  const first = apiSchemas.Reflection.parse(
    await (await f.client.request(`/sessions/${f.started.sessionId}/reflections`, input)).json(),
  );
  const second = apiSchemas.Reflection.parse(
    await (
      await f.client.request(
        `/reflections/${first.id}`,
        { ...input, text: 'New independent text' },
        { method: 'PUT', revision: 1 },
      )
    ).json(),
  );
  const child = await f.client.create('Used the exact first revision');
  const g1 = await select(
    f,
    child.started.requestId,
    { kind: 'reflection_revision', reflectionId: first.id, revision: 1 },
    first.text,
  );
  const g2 = await select(
    f,
    child.started.requestId,
    { kind: 'reflection_revision', reflectionId: first.id, revision: 2 },
    second.text,
    1,
  );
  const keep = await copy(g2);
  const encrypted = await q(
    env.DB,
    'SELECT body_enc FROM reading_editions WHERE id=?',
    child.reading.editionId,
  ).first<string>('body_enc');
  await f.erase.removeReflection(f.session, first.id, 1, 2, crypto.randomUUID(), proof());
  expect(await copy(g1)).toEqual({ fragment_enc: null, fragment_hmac: '' });
  expect(await copy(g2)).toEqual(keep);
  expect(await grantState(g2)).toBe('allowed');
  expect(await (await f.client.request(`/reflections/${first.id}`)).json()).toEqual(second);
  const cleanup = new OfflineCleanup(cleanupBindings(), localBackup());
  expect((await cleanup.run()).status).toBe('complete');
  await q(
    env.DB,
    'UPDATE reading_editions SET body_enc=? WHERE id=?',
    encrypted,
    child.reading.editionId,
  ).run();
  await expect(cleanup.run()).rejects.toThrow();
});

test('a failed selected request expires its private fragments and dispatch at 24 hours, then drops metadata without refunding spend', async () => {
  const f = await fixture(),
    original = await note(f);
  const interrupted = new ReadingClient({
    ...readingBindings,
    DB: failingDatabase('after-dispatch'),
  });
  interrupted.cookies = f.client.cookies;
  interrupted.csrf = f.client.csrf;
  const child = apiSchemas.StartResponse.parse(
    await (await interrupted.start('Failed downstream request')).json(),
  );
  const grant = await select(f, child.requestId, noteSource(original.id), original.note);
  await f.client.permission(false);
  await q(
    env.DB,
    'UPDATE generation_requests SET finished_at=? WHERE id=?',
    Date.now() - 2 * 86400000,
    child.requestId,
  ).run();
  const maintenance = new RetentionMaintenance(env.DB);
  const bill = await row(
    'SELECT c.id,c.reserved_microusd FROM cost_reservations c JOIN provider_dispatches d ON d.id=c.dispatch_id WHERE d.request_id=?',
    child.requestId,
  );
  expect(bill).toMatchObject({ id: expect.any(String), reserved_microusd: expect.any(Number) });
  await maintenance.run();
  expect(await copy(grant)).toEqual({ fragment_enc: null, fragment_hmac: '' });
  expect(
    await row('SELECT input_enc,plan_enc FROM generation_requests WHERE id=?', child.requestId),
  ).toEqual({ input_enc: null, plan_enc: null });
  expect(
    await row(
      'SELECT transmission_enc,candidate_enc,provider_response_id_enc FROM provider_dispatches WHERE request_id=?',
      child.requestId,
    ),
  ).toEqual({ transmission_enc: null, candidate_enc: null, provider_response_id_enc: null });
  expect(await grantState(grant)).toBe('allowed');
  await q(
    env.DB,
    'UPDATE generation_requests SET finished_at=? WHERE id=?',
    Date.now() - 31 * 86400000,
    child.requestId,
  ).run();
  await maintenance.run();
  expect(await row('SELECT 1 FROM generation_requests WHERE id=?', child.requestId)).toBeNull();
  expect(await copy(grant)).toBeNull();
  expect(
    await row(
      'SELECT owner_id,dispatch_id,reserved_microusd FROM cost_reservations WHERE id=?',
      String(bill!.id),
    ),
  ).toEqual({ owner_id: null, dispatch_id: null, reserved_microusd: bill!.reserved_microusd });
});

test('restore rejects a retained fragment sealed with a different immutable AAD revision', async () => {
  const f = await fixture(),
    original = await note(f),
    child = await f.client.create('Wrong AAD fixture');
  const grant = await select(f, child.started.requestId, noteSource(original.id), original.note);
  const field = {
    ownerId: f.session.subjectId,
    table: 'generation_context',
    column: 'fragment_enc',
    recordId: `${child.started.requestId}:0`,
    aadRevision: 1,
  };
  const payload = await f.base.crypt.open(
    field,
    String((await copy(grant))!.fragment_enc),
    SelectedFragment,
  );
  const wrong = await f.base.crypt.seal({ ...field, aadRevision: 2 }, payload, 1);
  await q(
    env.DB,
    'UPDATE generation_context SET fragment_enc=? WHERE grant_id=?',
    wrong,
    grant,
  ).run();
  await expect(new OfflineRestore(cleanupBindings()).replay()).rejects.toThrow();
  expect(await row('SELECT restore_in_progress,generation_enabled FROM system_state')).toEqual({
    restore_in_progress: 1,
    generation_enabled: 0,
  });
});
