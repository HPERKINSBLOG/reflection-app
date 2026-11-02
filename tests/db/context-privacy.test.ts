import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { SelectedFragment } from '../../src/contracts/index.ts';
import { randomToken } from '../../src/worker/identity/crypto.ts';
import { OfflineRestore } from '../../src/worker/recovery/restore.ts';
import { objects } from '../../src/worker/recovery/ledger.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { fixture, note } from '../fixtures/revisits.ts';
import { snapshot, restoreSnapshot } from '../fixtures/snapshot.ts';
import { cleanupBindings, localBackup } from '../fixtures/cleanup.ts';
import { OfflineCleanup } from '../../src/worker/recovery/cleanup.ts';
import { ContextRecords } from '../../src/worker/readings/context.ts';
import { Reflections } from '../../src/worker/readings/reflections.ts';
import { eraseContextCopies, targetSelector } from '../../src/worker/readings/context-lifecycle.ts';
import { assertion } from '../../src/worker/identity/checkpoint.ts';
import { SessionErasure } from '../../src/worker/readings/erasure.ts';
import { LocalGeneration } from '../../src/worker/readings/local-generation.ts';
import { RecordBase } from '../../src/worker/readings/base.ts';

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(async () => {
  await clearDatabase(env.DB);
  for (const object of await objects(env.RECOVERY, '')) await env.RECOVERY.delete(object.key);
});
const proof = () => ({ receiptId: crypto.randomUUID(), receiptToken: randomToken() });

// The copies are real encrypted persisted records; no provider or lifecycle method is mocked.
async function copied() {
  const f = await fixture(),
    n = await note(f, 'Selected private note');
  const destination = await f.client.create('A separate owned question');
  const grant = crypto.randomUUID(),
    request = destination.started.requestId;
  await env.DB.prepare(
    "INSERT INTO context_grants(id,owner_id,revisit_id,revisit_revision,state,created_at,updated_at) VALUES(?,?,?,1,'allowed',1,1)",
  )
    .bind(grant, f.session.subjectId, n.id)
    .run();
  const fragment = SelectedFragment.parse({
    ordinal: 0,
    grantId: grant,
    grantRevision: 1,
    sourceKind: 'revisit_revision',
    sourceId: n.id,
    sourceRevision: 1,
    start: 0,
    end: 21,
    text: 'Selected private note',
    textHash: 'a'.repeat(64),
    availability: 'retained',
    authorship: 'user',
  });
  const body = await f.base.crypt.seal(
    {
      ownerId: f.session.subjectId,
      table: 'generation_context',
      column: 'fragment_enc',
      recordId: `${request}:0`,
      aadRevision: 1,
    },
    fragment,
    1,
  );
  await env.DB.prepare('INSERT INTO generation_context VALUES(?,?,0,?,1,?,?,1)')
    .bind(request, f.session.subjectId, grant, body, 'a'.repeat(64))
    .run();
  await env.DB.prepare('UPDATE generation_requests SET context_count=1 WHERE id=?')
    .bind(request)
    .run();
  return { ...f, n, destination, grant, request, fragment };
}

// Seed the retained dispatch/receipt boundary; selected-context admission belongs to C4.
async function unfinishedCopy(state: 'authorized' | 'received' = 'received') {
  const f = await copied();
  const dispatchId = await env.DB.prepare('SELECT id FROM provider_dispatches WHERE request_id=?')
    .bind(f.request)
    .first<string>('id');
  const transmission = JSON.stringify({ selected: f.fragment.text, question: 'Owned question' });
  const seal = (column: string, value: unknown) =>
    f.base.crypt.seal(
      {
        ownerId: f.session.subjectId,
        table: 'provider_dispatches',
        column,
        recordId: dispatchId!,
        aadRevision: 1,
      },
      value,
      1,
    );
  await env.DB.prepare(
    "UPDATE generation_requests SET state='validating',finished_at=NULL WHERE id=?",
  )
    .bind(f.request)
    .run();
  await env.DB.prepare(
    'UPDATE provider_dispatches SET state=?,transmission_enc=?,provider_response_id_enc=? WHERE id=?',
  )
    .bind(
      state,
      await seal('transmission_enc', { v: 1, syntheticOnly: true, payload: transmission }),
      await seal('provider_response_id_enc', { v: 1, id: 'synthetic-retained-response' }),
      dispatchId,
    )
    .run();
  await env.DB.prepare(
    "UPDATE cost_reservations SET state='reserved',actual_microusd=NULL,settled_at=NULL WHERE dispatch_id=?",
  )
    .bind(dispatchId)
    .run();
  const evidence = () =>
    env.DB.prepare(
      'SELECT transmission_enc,candidate_enc,provider_response_id_enc FROM provider_dispatches WHERE id=?',
    )
      .bind(dispatchId)
      .first();
  const before = (await evidence())!;
  expect(Object.values(before).every((v) => v !== null)).toBe(true);
  const generation = new LocalGeneration(f.base, {
    write: async () => {
      throw new Error('Unexpected replacement provider call');
    },
  });
  return { ...f, dispatchId, transmission, evidence, before, generation };
}

test.each(['revoke', 'edit'] as const)(
  'stop reconciliation retains exact owned provenance after context %s',
  async (action) => {
    const f = await unfinishedCopy(action === 'revoke' ? 'authorized' : 'received');
    if (action === 'revoke')
      await new ContextRecords(f.base).revoke(f.session, f.grant, 1, crypto.randomUUID());
    else
      await f.notes.update(f.session, f.n.id, 1, crypto.randomUUID(), {
        note: 'Edited',
        stance: 'unspecified',
      });
    expect(
      await env.DB.prepare('SELECT state,context_withdrawn_at FROM generation_requests WHERE id=?')
        .bind(f.request)
        .first(),
    ).toEqual({ state: 'blocked', context_withdrawn_at: null });
    await f.client.permission(false);
    for (let i = 0; i < 2; i++) expect(await f.generation.maintenance()).toEqual({ attempted: 0 });
    expect(await f.evidence()).toEqual(f.before);
    expect(
      await env.DB.prepare('SELECT state FROM cost_reservations WHERE dispatch_id=?')
        .bind(f.dispatchId)
        .first('state'),
    ).toBe('unknown');
    expect(
      await env.DB.prepare('SELECT state FROM provider_dispatches WHERE id=?')
        .bind(f.dispatchId)
        .first('state'),
    ).toBe(action === 'revoke' ? 'unknown' : 'received');
    const ticket = await f.exports.create(f.session, crypto.randomUUID());
    const page = await f.exports.page(f.session, ticket.id, null);
    expect(
      page.records.find((r) => r.kind === 'generation_receipt' && r.originalId === f.request)
        ?.value,
    ).toMatchObject({
      state: 'blocked',
      selected: [f.fragment],
      transmission: f.transmission,
      reproduction: 'complete',
    });
  },
);

test.each(
  (['source', 'session', 'account'] as const).flatMap((scope) => [
    { scope, afterScan: false },
    { scope, afterScan: true },
  ]),
)(
  'stop reconciliation scrubs revoked provenance behind pending $scope erasure (after scan: $afterScan)',
  async ({ scope, afterScan }) => {
    const f = await unfinishedCopy();
    await new ContextRecords(f.base).revoke(f.session, f.grant, 1, crypto.randomUUID());
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
    const erasure = new SessionErasure(f.base, failing);
    let fenced = false;
    const remove = async () => {
      const removal =
        scope === 'source'
          ? erasure.removeRevisit(f.session, f.n.id, 1, crypto.randomUUID(), proof())
          : scope === 'session'
            ? erasure.remove(
                f.session,
                f.destination.started.sessionId,
                1,
                crypto.randomUUID(),
                proof(),
              )
            : erasure.removeAccount(f.session, crypto.randomUUID(), proof());
      await expect(removal).rejects.toThrow();
      fenced = true;
    };
    let generation = f.generation;
    if (afterScan) {
      // Execute the real erasure admission after the real D1 scan and before its batch.
      const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
        new Proxy(statement, {
          get(target, property) {
            if (property === 'bind') return (...args: unknown[]) => wrap(target.bind(...args));
            if (property === 'all')
              return async () => {
                const result = await target.all();
                await remove();
                return result;
              };
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      const db = new Proxy(env.DB, {
        get(target, property) {
          if (property === 'prepare')
            return (sql: string) =>
              sql.startsWith('SELECT d.request_id FROM provider_dispatches')
                ? wrap(target.prepare(sql))
                : target.prepare(sql);
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      generation = new LocalGeneration(new RecordBase(db, f.base.identity), {
        write: async () => {
          throw new Error('Unexpected replacement provider call');
        },
      });
    } else await remove();
    expect(await f.evidence()).toEqual(f.before);
    expect(await generation.maintenance()).toEqual({ attempted: 0 });
    expect(fenced).toBe(true);
    expect(await f.evidence()).toEqual({
      transmission_enc: null,
      candidate_enc: null,
      provider_response_id_enc: null,
    });
    expect(
      await env.DB.prepare('SELECT state FROM cost_reservations WHERE dispatch_id=?')
        .bind(f.dispatchId)
        .first('state'),
    ).toBe('unknown');
    if (scope === 'source') {
      const ticket = await f.exports.create(f.session, crypto.randomUUID());
      const page = await f.exports.page(f.session, ticket.id, null);
      expect(
        page.records.find((r) => r.kind === 'generation_receipt' && r.originalId === f.request)
          ?.value,
      ).toMatchObject({ selected: [], transmission: null, reproduction: 'redacted' });
    } else if (scope === 'account')
      await expect(f.exports.create(f.session, crypto.randomUUID())).rejects.toThrow();
  },
);

test('repeated stop reconciliation advances past a full page of retained context evidence', async () => {
  const retained = [];
  for (let i = 0; i < 20; i++) {
    const f = await unfinishedCopy('received');
    await new ContextRecords(f.base).revoke(f.session, f.grant, 1, crypto.randomUUID());
    await env.DB.prepare('UPDATE provider_dispatches SET authorized_at=1 WHERE id=?')
      .bind(f.dispatchId)
      .run();
    retained.push(f);
  }
  const later = await unfinishedCopy('authorized');
  for (const f of retained)
    await env.DB.prepare("UPDATE provider_dispatches SET state='authorized' WHERE id=?")
      .bind(f.dispatchId)
      .run();
  await env.DB.prepare(
    "UPDATE generation_requests SET state='cancelled',error_code='CANCELLED' WHERE id=?",
  )
    .bind(later.request)
    .run();
  for (let i = 0; i < 3; i++)
    expect(await later.generation.maintenance()).toEqual({ attempted: 0 });
  expect(await later.evidence()).toEqual({
    transmission_enc: null,
    candidate_enc: null,
    provider_response_id_enc: null,
  });
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS n FROM cost_reservations WHERE state='reserved'",
    ).first('n'),
  ).toBe(0);
  for (const f of retained) expect(await f.evidence()).toEqual(f.before);
}, 60000);

test('selected context and grants survive paginated owned export with AI off', async () => {
  const f = await copied();
  await f.client.permission(false);
  await env.DB.prepare(
    "WITH RECURSIVE n(x) AS (SELECT 10 UNION ALL SELECT x+1 FROM n WHERE x<110) INSERT INTO permission_revisions SELECT ?,x,0,'egress.v1',1 FROM n",
  )
    .bind(f.session.subjectId)
    .run();
  const ticket = await f.exports.create(f.session, crypto.randomUUID()),
    records = [];
  let cursor: string | null = null;
  do {
    const page = await f.exports.page(f.session, ticket.id, cursor);
    records.push(...page.records);
    cursor = page.nextCursor;
  } while (cursor);
  expect(records.filter((r) => r.kind === 'grant')).toHaveLength(1);
  expect(
    records.find((r) => r.kind === 'generation_receipt' && r.originalId === f.request)?.value,
  ).toMatchObject({ selected: [f.fragment] });
});

test.each([false, true])(
  'export reports erased selection count without fabricated ranges (all erased: %s)',
  async (all) => {
    const f = await copied(),
      secondGrant = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO context_grants(id,owner_id,edition_id,state,created_at,updated_at) VALUES(?,?,?,'revoked',1,1)",
    )
      .bind(secondGrant, f.session.subjectId, f.reading.editionId)
      .run();
    await env.DB.prepare('INSERT INTO generation_context VALUES(?,?,1,?,1,NULL,?,1)')
      .bind(f.request, f.session.subjectId, secondGrant, 'b'.repeat(64))
      .run();
    if (all)
      await env.DB.prepare('UPDATE generation_context SET fragment_enc=NULL WHERE request_id=?')
        .bind(f.request)
        .run();
    const ticket = await f.exports.create(f.session, crypto.randomUUID());
    const page = await f.exports.page(f.session, ticket.id, null);
    expect(
      page.records.find((r) => r.kind === 'generation_receipt' && r.originalId === f.request)
        ?.value,
    ).toMatchObject({
      selected: all ? [] : [f.fragment],
      redactedSelectionCount: all ? 2 : 1,
      reproduction: 'redacted',
    });
  },
);

test.each(['revisit', 'session', 'account'] as const)(
  '%s erasure scrubs copies and derivative bodies without deleting unrelated authored text',
  async (scope) => {
    const f = await copied(),
      neighbor = await note(f, 'Unrelated authored note');
    if (scope === 'revisit')
      await f.erase.removeRevisit(f.session, f.n.id, 1, crypto.randomUUID(), proof());
    if (scope === 'session')
      await f.erase.remove(f.session, f.started.sessionId, 2, crypto.randomUUID(), proof());
    if (scope === 'account') await f.erase.removeAccount(f.session, crypto.randomUUID(), proof());
    expect(
      await env.DB.prepare(
        'SELECT fragment_enc FROM generation_context WHERE request_id=? AND fragment_enc IS NOT NULL',
      )
        .bind(f.request)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        'SELECT plan_enc FROM generation_requests WHERE id=? AND plan_enc IS NOT NULL',
      )
        .bind(f.request)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        'SELECT transmission_enc FROM provider_dispatches WHERE request_id=? AND (transmission_enc IS NOT NULL OR candidate_enc IS NOT NULL OR provider_response_id_enc IS NOT NULL)',
      )
        .bind(f.request)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        'SELECT body_enc FROM reading_editions WHERE id=? AND body_enc IS NOT NULL',
      )
        .bind(f.destination.reading.editionId)
        .first(),
    ).toBeNull();
    if (scope === 'revisit')
      expect((await f.notes.read(f.session, neighbor.id)).note).toBe('Unrelated authored note');
  },
);

test('source edit revokes grants and fences a dependent request atomically without erasing its retained copies', async () => {
  const f = await copied();
  await env.DB.prepare(
    "UPDATE generation_requests SET state='validating',finished_at=NULL WHERE id=?",
  )
    .bind(f.request)
    .run();
  await f.notes.update(f.session, f.n.id, 1, crypto.randomUUID(), {
    note: 'Edited',
    stance: 'unspecified',
  });
  expect(
    await env.DB.prepare('SELECT state FROM context_grants WHERE id=?')
      .bind(f.grant)
      .first('state'),
  ).toBe('revoked');
  expect(
    await env.DB.prepare('SELECT state FROM generation_requests WHERE id=?')
      .bind(f.request)
      .first('state'),
  ).toBe('blocked');
  expect(
    await env.DB.prepare('SELECT fragment_enc FROM generation_context WHERE request_id=?')
      .bind(f.request)
      .first('fragment_enc'),
  ).not.toBeNull();
});

test('stale backup replay cannot resurrect selected context after whole-note deletion', async () => {
  const f = await copied(),
    saved = await snapshot(env.DB);
  await f.erase.removeRevisit(f.session, f.n.id, 1, crypto.randomUUID(), proof());
  const restore = new OfflineRestore(cleanupBindings());
  await restore.prepare();
  await restoreSnapshot(env.DB, saved);
  await restore.replay();
  expect(
    await env.DB.prepare('SELECT fragment_enc FROM generation_context WHERE request_id=?')
      .bind(f.request)
      .first('fragment_enc'),
  ).toBeNull();
  expect(
    await env.DB.prepare('SELECT plan_enc FROM generation_requests WHERE id=?')
      .bind(f.request)
      .first('plan_enc'),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT count(*) AS n FROM context_grants WHERE state='allowed'").first(
      'n',
    ),
  ).toBe(0);
  expect(
    await env.DB.prepare(
      'SELECT model_allowed FROM permission_revisions p JOIN accounts a ON p.owner_id=a.id AND p.revision=a.permission_revision',
    ).first('model_allowed'),
  ).toBe(0);
});

test('at full capacity grants reject admission while deletion still erases copied text and keeps cost liability', async () => {
  const f = await copied();
  await env.DB.prepare(
    "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<20480) INSERT INTO export_tickets SELECT 'context-pressure-'||x,?,1,1,9999999999999 FROM n",
  )
    .bind(f.session.subjectId)
    .run();
  const context = new ContextRecords(f.base);
  await expect(
    context.grant(f.session, crypto.randomUUID(), {
      kind: 'revisit_revision',
      revisitId: f.n.id,
      revision: 1,
    }),
  ).rejects.toMatchObject({ code: 'STORAGE_LIMIT_EXCEEDED' });
  const costs = (
    await env.DB.prepare('SELECT id,state,actual_microusd FROM cost_reservations ORDER BY id').all()
  ).results;
  await f.erase.removeRevisit(f.session, f.n.id, 1, crypto.randomUUID(), proof());
  expect(
    await env.DB.prepare('SELECT fragment_enc FROM generation_context WHERE request_id=?')
      .bind(f.request)
      .first('fragment_enc'),
  ).toBeNull();
  expect(
    (
      await env.DB.prepare(
        'SELECT id,state,actual_microusd FROM cost_reservations ORDER BY id',
      ).all()
    ).results,
  ).toEqual(costs);
});

test('erasure follows derived editions recursively and terminates a cyclic dependency', async () => {
  const f = await copied(),
    third = await f.client.create('Third question');
  const grant = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO context_grants(id,owner_id,edition_id,state,created_at,updated_at) VALUES(?,?,?,'allowed',1,1)",
  )
    .bind(grant, f.session.subjectId, f.destination.reading.editionId)
    .run();
  await env.DB.prepare('INSERT INTO generation_context VALUES(?,?,0,?,1,?,?,1)')
    .bind(
      third.started.requestId,
      f.session.subjectId,
      grant,
      'opaque-private-copy',
      'a'.repeat(64),
    )
    .run();
  // An imported/corrupt graph must not loop forever while erasing dependent copies.
  await env.DB.prepare(
    "UPDATE generation_requests SET operation='followup',parent_edition_id=? WHERE id=?",
  )
    .bind(third.reading.editionId, f.request)
    .run();
  await f.erase.removeRevisit(f.session, f.n.id, 1, crypto.randomUUID(), proof());
  expect(
    await env.DB.prepare('SELECT body_enc FROM reading_editions WHERE id=?')
      .bind(third.reading.editionId)
      .first('body_enc'),
  ).toBeNull();
  expect(
    await env.DB.prepare('SELECT fragment_enc FROM generation_context WHERE request_id=?')
      .bind(third.started.requestId)
      .first('fragment_enc'),
  ).toBeNull();
});

test('an already unavailable original cannot bypass copied-context erasure during ledger replay', async () => {
  const f = await copied();
  // Replay uses ledger identities, never a successful source read, to erase every surviving copy.
  await env.DB.prepare('UPDATE revisits SET note_enc=NULL,deleted_at=1 WHERE id=?')
    .bind(f.n.id)
    .run();
  const intent = await f.erase.ledger.create(
    { scope: 'revisit', subjectId: f.session.subjectId, revisitId: f.n.id },
    crypto.randomUUID(),
    null,
    Date.now(),
  );
  await f.erase.ledger.putIntent(intent);
  const restore = new OfflineRestore(cleanupBindings());
  await restore.prepare();
  await restore.replay();
  expect(
    await env.DB.prepare('SELECT plan_enc FROM generation_requests WHERE id=?')
      .bind(f.request)
      .first('plan_enc'),
  ).toBeNull();
  expect(
    await env.DB.prepare('SELECT fragment_enc FROM generation_context WHERE request_id=?')
      .bind(f.request)
      .first('fragment_enc'),
  ).toBeNull();
});

test('exact reflection revision erasure withdraws selected copies and preserves the newer authored revision', async () => {
  const f = await copied(),
    reflections = new Reflections(f.base);
  const first = await reflections.write(
    f.session,
    f.started.sessionId,
    { editionId: f.reading.editionId, text: 'Private reflection', stance: 'unsure' },
    crypto.randomUUID(),
  );
  await env.DB.prepare(
    'UPDATE context_grants SET revisit_id=NULL,revisit_revision=NULL,reflection_id=?,reflection_revision=1 WHERE id=?',
  )
    .bind(first.id, f.grant)
    .run();
  const second = await reflections.update(f.session, first.id, 1, crypto.randomUUID(), {
    editionId: f.reading.editionId,
    text: 'New reflection',
    stance: 'disagree',
  });
  await f.erase.removeReflection(f.session, first.id, 1, 2, crypto.randomUUID(), proof());
  expect(await reflections.read(f.session, first.id)).toEqual(second);
  expect(
    await env.DB.prepare('SELECT fragment_enc FROM generation_context WHERE request_id=?')
      .bind(f.request)
      .first('fragment_enc'),
  ).toBeNull();
});

test.each(['revisit', 'session'] as const)(
  '%s replay traversal does not require the original source row',
  async (scope) => {
    const f = await copied();
    const original = (await env.DB.prepare('SELECT * FROM revisits WHERE id=?')
      .bind(f.n.id)
      .first<Record<string, string | number | null>>())!;
    await env.DB.prepare('UPDATE context_grants SET source_session_id=? WHERE id=?')
      .bind(f.started.sessionId, f.grant)
      .run();
    const target =
      scope === 'session'
        ? { scope, subjectId: f.session.subjectId, sessionId: f.started.sessionId }
        : { scope, subjectId: f.session.subjectId, revisitId: f.n.id };
    // Simulate a damaged source graph within one FK-deferred transaction, restoring only
    // the source identity after verifying copy erasure. The eraser sees no source row.
    await env.DB.batch([
      env.DB.prepare('PRAGMA defer_foreign_keys=ON'),
      env.DB.prepare('DELETE FROM revisits WHERE id=?').bind(f.n.id),
      ...eraseContextCopies(f.base, f.session.subjectId, targetSelector(target)),
      assertion(
        env.DB,
        'NOT EXISTS(SELECT 1 FROM generation_context WHERE request_id=? AND fragment_enc IS NOT NULL)',
        f.request,
      ),
      assertion(
        env.DB,
        'NOT EXISTS(SELECT 1 FROM generation_requests WHERE id=? AND plan_enc IS NOT NULL)',
        f.request,
      ),
      env.DB.prepare(
        `INSERT INTO revisits(${Object.keys(original).join(',')}) VALUES(${Object.keys(original)
          .map(() => '?')
          .join(',')})`,
      ).bind(...Object.values(original)),
    ]);
    expect(
      await env.DB.prepare('SELECT body_enc FROM reading_editions WHERE id=?')
        .bind(f.destination.reading.editionId)
        .first('body_enc'),
    ).toBeNull();
  },
);

test('context-copy ledger replay erases copies while preserving the original authored note', async () => {
  const f = await copied();
  const intent = await f.erase.ledger.create(
    {
      scope: 'context_copy',
      subjectId: f.session.subjectId,
      source: { kind: 'revisit_revision', revisitId: f.n.id, revision: 1 },
    },
    crypto.randomUUID(),
    null,
    Date.now(),
  );
  await f.erase.ledger.putIntent(intent);
  const restore = new OfflineRestore(cleanupBindings());
  await restore.prepare();
  await restore.replay();
  expect(
    await env.DB.prepare('SELECT fragment_enc FROM generation_context WHERE request_id=?')
      .bind(f.request)
      .first('fragment_enc'),
  ).toBeNull();
  expect(
    await env.DB.prepare('SELECT note_enc FROM revisits WHERE id=?').bind(f.n.id).first('note_enc'),
  ).not.toBeNull();
});

test('pending ledger outage hides every copied payload from new exports and owned reads before physical erasure', async () => {
  const f = await copied();
  const third = await f.client.create('A transitive dependent question'),
    grant = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO context_grants(id,owner_id,edition_id,state,created_at,updated_at) VALUES(?,?,?,'allowed',1,1)",
  )
    .bind(grant, f.session.subjectId, f.destination.reading.editionId)
    .run();
  const body = await f.base.crypt.seal(
    {
      ownerId: f.session.subjectId,
      table: 'generation_context',
      column: 'fragment_enc',
      recordId: `${third.started.requestId}:0`,
      aadRevision: 1,
    },
    {
      ...f.fragment,
      grantId: grant,
      sourceKind: 'edition',
      sourceId: f.destination.reading.editionId,
      authorship: 'generated',
    },
    1,
  );
  await env.DB.prepare('INSERT INTO generation_context VALUES(?,?,0,?,1,?,?,1)')
    .bind(third.started.requestId, f.session.subjectId, grant, body, 'b'.repeat(64))
    .run();
  const previous = await f.exports.create(f.session, crypto.randomUUID());
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
  const receipt = proof();
  await expect(
    new SessionErasure(f.base, failing).removeRevisit(
      f.session,
      f.n.id,
      1,
      crypto.randomUUID(),
      receipt,
    ),
  ).rejects.toThrow();
  expect(
    await env.DB.prepare('SELECT fragment_enc FROM generation_context WHERE request_id=?')
      .bind(f.request)
      .first('fragment_enc'),
  ).not.toBeNull();
  expect((await f.client.request(`/readings/${f.destination.reading.editionId}`)).status).toBe(410);
  expect((await f.client.request(`/readings/${third.reading.editionId}`)).status).toBe(410);
  await expect(f.exports.page(f.session, previous.id, null)).rejects.toMatchObject({
    code: 'EXPORT_CHANGED',
  });
  const ticket = await f.exports.create(f.session, crypto.randomUUID());
  const page = await f.exports.page(f.session, ticket.id, null);
  expect(
    page.records.find((r) => r.kind === 'generation_receipt' && r.originalId === f.request)?.value,
  ).toMatchObject({
    selected: [],
    redactedSelectionCount: 1,
    transmission: null,
    reproduction: 'redacted',
  });
  expect(
    page.records.find(
      (r) => r.kind === 'generation_receipt' && r.originalId === third.started.requestId,
    )?.value,
  ).toMatchObject({
    selected: [],
    redactedSelectionCount: 1,
    transmission: null,
    reproduction: 'redacted',
  });
  expect(
    page.records.find(
      (r) => r.kind === 'reading' && r.originalId === f.destination.reading.editionId,
    )?.value,
  ).toMatchObject({ kind: 'reading.unavailable.v1' });
  await f.erase.resume(receipt.receiptId);
  expect(
    await env.DB.prepare('SELECT fragment_enc FROM generation_context WHERE request_id=?')
      .bind(f.request)
      .first('fragment_enc'),
  ).toBeNull();
});

test('replaying source erasure never changes a deleted derivative edition back to withdrawn', async () => {
  const f = await copied();
  await env.DB.prepare(
    "UPDATE reading_editions SET status='deleted',body_enc=NULL,invalidated_at=1 WHERE id=?",
  )
    .bind(f.destination.reading.editionId)
    .run();
  await f.erase.removeRevisit(f.session, f.n.id, 1, crypto.randomUUID(), proof());
  expect(
    await env.DB.prepare('SELECT status FROM reading_editions WHERE id=?')
      .bind(f.destination.reading.editionId)
      .first('status'),
  ).toBe('deleted');
});

test('offline cleanup validates erased context accounts while retaining the independent ledger until its deadline', async () => {
  const f = await copied();
  await f.erase.removeRevisit(f.session, f.n.id, 1, crypto.randomUUID(), proof());
  const result = await new OfflineCleanup(cleanupBindings(), localBackup()).run();
  expect(result.status).toBe('complete');
  expect(await env.DB.prepare('SELECT count(*) AS n FROM context_grants').first('n')).toBe(1);
});

test.each(['fragment', 'plan', 'transmission', 'candidate', 'accepted'] as const)(
  'cleanup independently rejects a resurrected %s copy after source erasure',
  async (field) => {
    const f = await copied();
    await f.erase.removeRevisit(f.session, f.n.id, 1, crypto.randomUUID(), proof());
    if (field === 'fragment')
      await env.DB.prepare(
        "UPDATE generation_context SET fragment_enc='retained-private-bytes' WHERE request_id=?",
      )
        .bind(f.request)
        .run();
    if (field === 'plan')
      await env.DB.prepare(
        "UPDATE generation_requests SET plan_enc='retained-private-bytes' WHERE id=?",
      )
        .bind(f.request)
        .run();
    if (field === 'transmission')
      await env.DB.prepare(
        "UPDATE provider_dispatches SET transmission_enc='retained-private-bytes' WHERE request_id=?",
      )
        .bind(f.request)
        .run();
    if (field === 'candidate')
      await env.DB.prepare(
        "UPDATE provider_dispatches SET candidate_enc='retained-private-bytes' WHERE request_id=?",
      )
        .bind(f.request)
        .run();
    if (field === 'accepted')
      await env.DB.prepare(
        "UPDATE reading_editions SET body_enc='retained-private-bytes' WHERE id=?",
      )
        .bind(f.destination.reading.editionId)
        .run();
    await expect(new OfflineCleanup(cleanupBindings(), localBackup()).run()).rejects.toThrow(
      'Context copies are not erased',
    );
  },
);
