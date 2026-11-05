import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { apiSchemas, StartRequest, SelectedFragment } from '../../src/contracts/index.ts';
import { LocalGeneration } from '../../src/worker/readings/local-generation.ts';
import { ReadingRecords } from '../../src/worker/readings/records.ts';
import { ContextRecords } from '../../src/worker/readings/context.ts';
import { gate } from '../fixtures/barrier.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { fixture, note } from '../fixtures/revisits.ts';
import { ReadingClient, readingAccount, login } from '../fixtures/reading-client.ts';
import { snapshot, restoreSnapshot } from '../fixtures/snapshot.ts';
import { OfflineRestore } from '../../src/worker/recovery/restore.ts';
import { objects } from '../../src/worker/recovery/ledger.ts';
import { cleanupBindings } from '../fixtures/cleanup.ts';
import { randomToken } from '../../src/worker/identity/crypto.ts';

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(async () => {
  await clearDatabase(env.DB);
  for (const obj of await objects(env.RECOVERY, '')) await env.RECOVERY.delete(obj.key);
});

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function request(
  f: Fixture,
  parentEditionId: string | null,
  question = 'What can I try now?',
) {
  return StartRequest.parse({
    clientIntentId: crypto.randomUUID(),
    question,
    permissionRevision: (await f.client.me()).permission.revision,
    reversals:
      f.reading.kind.startsWith('tarot.accepted.') &&
      'basis' in f.reading &&
      f.reading.basis.kind === 'tarot.v1' &&
      f.reading.basis.reversals,
    parentEditionId,
    selection: [],
    languageConfirmed: 'en',
  });
}
async function selection(f: Fixture, parent: string | null) {
  const n = await note(f, 'Ask about this 🌱 Secret unselected tail');
  const ctx = new ContextRecords(f.base.db, f.base.identity);
  const grant = await ctx.grant(f.session, crypto.randomUUID(), {
    kind: 'revisit_revision',
    revisitId: n.id,
    revision: n.revision,
  });
  const input = await request(f, parent);
  const preview = await ctx.preview(f.session, {
    clientIntentId: input.clientIntentId,
    question: input.question,
    permissionRevision: input.permissionRevision,
    parentEditionId: parent,
    items: [{ grantId: grant.id, grantRevision: grant.revision, start: 0, end: 16 }],
  });
  return {
    ctx,
    grant,
    input: {
      ...input,
      selection: preview.items.map((x) => x.selection),
      contextAcknowledgement: preview.acknowledgementHash,
    },
  };
}
async function submit(
  f: Fixture,
  input: ReturnType<typeof StartRequest.parse>,
  key = crypto.randomUUID(),
) {
  const res = await f.client.request('/requests', input, { key });
  expect(res.status, await res.clone().text()).toBe(202);
  return apiSchemas.StartResponse.parse(await res.json());
}
test('a confirmed initial selection reaches only the intercepted writer and is sealed with immutable fragment identity', async () => {
  const f = await fixture(),
    { input } = await selection(f, null);
  let packet = '';
  const generation = new LocalGeneration(f.base, {
    async write(v) {
      packet = new TextDecoder().decode(v.payload);
      return { kind: 'uncertain', reason: 'network', receipt: null };
    },
  });
  const result = await generation.start(f.session, input, crypto.randomUUID());
  expect(result.status.state).toBe('published');
  expect(packet).toContain('Ask about this 🌱');
  expect(packet).not.toContain('Secret unselected tail');
  expect(packet).not.toContain(f.reading.editionId);
  expect(packet).not.toContain(input.clientIntentId);
  const child = await new ReadingRecords(f.base).reading(f.session, result.status.editionId!);
  expect(child.kind).toBe('tarot.accepted.v3');
  const row = await env.DB.prepare(
    'SELECT fragment_enc,fragment_hmac FROM generation_context WHERE request_id=? AND ordinal=0',
  )
    .bind(result.requestId)
    .first<{ fragment_enc: string; fragment_hmac: string }>();
  expect(row!.fragment_enc).not.toContain('Ask about this');
  expect(
    await f.base.crypt.open(
      {
        ownerId: f.session.subjectId,
        table: 'generation_context',
        column: 'fragment_enc',
        recordId: result.requestId + ':0',
        aadRevision: 1,
      },
      row!.fragment_enc,
      SelectedFragment,
    ),
  ).toMatchObject({ text: 'Ask about this 🌱', textHash: row!.fragment_hmac });
});
test('an original and two generations share one save and one erase, preserving unrelated history', async () => {
  const f = await fixture(),
    id = f.reading.editionId;
  await env.DB.prepare('UPDATE quota_buckets SET allowance=20').run();
  const unrelated = await f.client.create('An independent reading');
  const key = crypto.randomUUID(),
    input = await request(f, id, 'First follow-up question');
  const first = await submit(f, input, key);
  expect(first.status.state).toBe('published');
  expect((await submit(f, input, key)).requestId).toBe(first.requestId);
  const second = await submit(
    f,
    await request(f, first.status.editionId!, 'Second follow-up question'),
  );
  expect(second.status.state).toBe('published');
  const ids = [id, first.status.editionId!, second.status.editionId!];
  expect(new Set([f.started.sessionId, first.sessionId, second.sessionId]).size).toBe(1);
  expect(
    await env.DB.prepare('SELECT count(*) n FROM basis_snapshots WHERE session_id=?')
      .bind(f.started.sessionId)
      .first('n'),
  ).toBe(1);
  await f.client.permission(false);
  const fresh = new ReadingClient();
  await login(fresh, f.passkey, f.session.subjectId);
  const readings = await Promise.all(
    ids.map(async (x) => await (await fresh.request('/readings/' + x)).json()),
  );
  expect(readings[0]).toEqual(f.reading);
  for (const [i, parent] of [id, first.status.editionId].entries())
    expect(readings[i + 1]).toMatchObject({
      kind: 'tarot.accepted.v3',
      parentEditionId: parent,
      editionNumber: i + 2,
      basis: 'basis' in f.reading ? f.reading.basis : null,
    });
  const saved = apiSchemas.SessionRecord.parse(
    await (await fresh.request('/sessions/' + f.started.sessionId)).json(),
  );
  expect(saved.status).toBe('saved');
  expect(saved.editionIds).toEqual(ids);
  const backup = await snapshot(env.DB);
  expect(
    (
      await fresh.request(
        '/sessions/' + saved.id,
        { receiptId: crypto.randomUUID(), receiptToken: randomToken() },
        { method: 'DELETE', revision: saved.revision },
      )
    ).status,
  ).toBe(202);
  for (const x of ids) expect([404, 410]).toContain((await fresh.request('/readings/' + x)).status);
  expect((await fresh.request('/readings/' + unrelated.reading.editionId)).status).toBe(200);
  expect(
    apiSchemas.HistoryPage.parse(await (await fresh.request('/sessions')).json()).items.map(
      (x) => x.id,
    ),
  ).not.toContain(saved.id);
  const ticket = apiSchemas.ExportTicket.parse(await (await fresh.request('/exports', {})).json());
  const exported = await (await fresh.request('/exports/' + ticket.id)).text();
  expect(exported).not.toContain('First follow-up question');
  expect(exported).not.toContain('Second follow-up question');
  await restoreSnapshot(env.DB, backup);
  await new OfflineRestore(cleanupBindings()).replay();
  expect(
    await env.DB.prepare(
      'SELECT count(*) n FROM reading_editions WHERE session_id=? AND body_enc IS NOT NULL',
    )
      .bind(saved.id)
      .first('n'),
  ).toBe(0);
  expect(
    await env.DB.prepare(
      'SELECT count(*) n FROM reading_editions WHERE id=? AND body_enc IS NOT NULL',
    )
      .bind(unrelated.reading.editionId)
      .first('n'),
  ).toBe(1);
});
test.each(['dispatch', 'publish'] as const)(
  'a grant revoked at %s blocks publication with the correct number of writer calls',
  async (stage) => {
    const f = await fixture(),
      { input, ctx, grant } = await selection(f, f.reading.editionId);
    const barrier = gate((sql) =>
      sql.some((s) =>
        s.includes(
          stage === 'dispatch' ? 'INSERT INTO provider_dispatches' : 'INSERT INTO reading_editions',
        ),
      ),
    );
    const client = new ReadingClient({ ...f.client.bindings, DB: barrier.db });
    client.cookies = f.client.cookies;
    client.csrf = f.client.csrf;
    const response = client.request('/requests', input);
    const arrived = await Promise.race([
      barrier.ready.then(() => true),
      response.then(() => false),
    ]);
    expect(arrived).toBe(true);
    try {
      await ctx.revoke(f.session, grant.id, grant.revision, crypto.randomUUID());
    } finally {
      barrier.release();
    }
    const started = apiSchemas.StartResponse.parse(await (await response).json());
    expect(started.status).toMatchObject({ state: 'blocked', editionId: null });
    expect(
      await env.DB.prepare('SELECT count(*) n FROM provider_dispatches WHERE request_id=?')
        .bind(started.requestId)
        .first('n'),
    ).toBe(stage === 'dispatch' ? 0 : 1);
  },
);
test('cross-account, unsaved and missing parents are rejected before a draw or quota reservation', async () => {
  const f = await fixture(),
    other = await readingAccount(),
    unsaved = await f.client.create();
  const input = await request(f, f.reading.editionId);
  expect((await other.client.request('/requests', input)).status).toBe(404);
  expect(
    (await f.client.request('/requests', { ...input, parentEditionId: unsaved.reading.editionId }))
      .status,
  ).toBe(410);
  expect(
    (await f.client.request('/requests', { ...input, parentEditionId: crypto.randomUUID() }))
      .status,
  ).toBe(404);
  expect(await env.DB.prepare('SELECT count(*) n FROM generation_requests').first('n')).toBe(2);
});

test('simultaneous follow-ups keep distinct numbers and retries join the pinned requests', async () => {
  const f = await fixture();
  const a = await request(f, f.reading.editionId, 'An earlier question'),
    b = await request(f, f.reading.editionId, 'A different question');
  const [first, second] = await Promise.all([submit(f, a), submit(f, b)]);
  expect([first.status.state, second.status.state]).toEqual(['published', 'published']);
  const family = await new ReadingRecords(f.base).session(f.session, f.started.sessionId);
  expect(family.editionIds).toHaveLength(3);
  expect((await submit(f, b)).requestId).toBe(second.requestId);
  const rows = await env.DB.prepare(
    'SELECT edition_number,parent_edition_id FROM reading_editions WHERE parent_edition_id=? ORDER BY edition_number',
  )
    .bind(f.reading.editionId)
    .all();
  expect(rows.results.map((x) => x.edition_number)).toEqual([2, 3]);
});

test('the fifty-first follow-up is rejected without a new request or a second basis', async () => {
  const f = await fixture();
  const generation = new LocalGeneration(f.base);
  // Exercise the normal request/publication path. Lift synthetic-test quota only.
  await env.DB.prepare('UPDATE quota_buckets SET allowance=100').run();
  await env.DB.prepare('UPDATE spend_buckets SET ceiling_microusd=1000000000').run();
  const input = await request(f, f.reading.editionId);
  for (let i = 0; i < 50; i++) {
    const start = await generation.start(
      f.session,
      { ...input, clientIntentId: crypto.randomUUID() },
      crypto.randomUUID(),
    );
    expect(start.status.state).toBe('published');
  }
  await expect(
    generation.start(
      f.session,
      { ...input, clientIntentId: crypto.randomUUID() },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: 'FOLLOWUP_LIMIT_EXCEEDED' });
  expect(await env.DB.prepare('SELECT count(*) n FROM generation_requests').first('n')).toBe(51);
  expect(await env.DB.prepare('SELECT count(*) n FROM basis_snapshots').first('n')).toBe(1);
}, 60000);

test('an in-flight follow-up resumes by intent without an edition and cancellation leaves its sibling intact', async () => {
  const f = await fixture(),
    input = await request(f, f.reading.editionId),
    sibling = await request(f, f.reading.editionId);
  const g = gate((sql) => sql.some((s) => s.includes('INSERT INTO provider_dispatches')));
  const client = new ReadingClient({ ...f.client.bindings, DB: g.db });
  client.cookies = f.client.cookies;
  client.csrf = f.client.csrf;
  const pending = client.request('/requests', input);
  expect(await Promise.race([g.ready.then(() => true), pending.then(() => false)])).toBe(true);
  try {
    const resolved = apiSchemas.RequestStatus.parse(
      await (await f.client.request('/requests?intentId=' + input.clientIntentId)).json(),
    );
    expect(resolved.editionId).toBeNull();
    expect((await submit(f, input)).requestId).toBe(resolved.requestId);
    const other = await submit(f, sibling);
    const stopped = await f.client.request(
      '/requests/' + resolved.requestId + '/cancel',
      {},
      { revision: resolved.revision },
    );
    expect(apiSchemas.RequestStatus.parse(await stopped.json()).state).toBe('cancelled');
    expect(other.status.state).toBe('published');
  } finally {
    g.release();
  }
  expect(apiSchemas.StartResponse.parse(await (await pending).json()).status.state).toBe(
    'cancelled',
  );
});
test('withdrawal of the exact parent blocks an authorized child even when the request source still qualifies', async () => {
  const f = await fixture(),
    input = await request(f, f.reading.editionId);
  const barrier = gate((sql) => sql.some((s) => s.includes('INSERT INTO reading_editions')));
  const client = new ReadingClient({ ...f.client.bindings, DB: barrier.db });
  client.cookies = f.client.cookies;
  client.csrf = f.client.csrf;
  const response = client.request('/requests', input);
  expect(await Promise.race([barrier.ready.then(() => true), response.then(() => false)])).toBe(
    true,
  );
  try {
    // Independent legacy parent source. Its replacement remains eligible for the captured request.
    const source = 'a'.repeat(64);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO content_editions(hash,state,bundle_json,reviewed_hash,reviewer_kind,reviewer_id,rights_status,created_at,approved_at) SELECT ?,'approved',bundle_json,?,'human_approved','synthetic fixture','cleared',created_at,approved_at FROM content_editions LIMIT 1",
      ).bind(source, source),
      env.DB.prepare('UPDATE reading_editions SET content_hash=? WHERE id=?').bind(
        source,
        f.reading.editionId,
      ),
      env.DB.prepare(
        "UPDATE content_editions SET state='withdrawn',withdrawn_at=1,policy_revision=policy_revision+1 WHERE hash=?",
      ).bind(source),
    ]);
  } finally {
    barrier.release();
  }
  const r = apiSchemas.StartResponse.parse(await (await response).json());
  expect(r.status).toMatchObject({
    state: 'blocked',
    editionId: null,
    errorCode: 'CONTENT_UNAVAILABLE',
  });
  expect(
    await env.DB.prepare(
      'SELECT c.state FROM content_editions c JOIN generation_requests r ON c.hash=r.content_hash WHERE r.id=?',
    )
      .bind(r.requestId)
      .first('state'),
  ).toBe('approved');
});

test('a saved v1 parent reuses its superseded eligible source and the exact original draw after a newer source activates', async () => {
  const f = await fixture();
  const { syntheticBundle } = await import('../fixtures/canon.ts');
  const bundle = await syntheticBundle();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO content_editions(hash,state,bundle_json,reviewed_hash,reviewer_kind,reviewer_id,rights_status,created_at,approved_at) VALUES(?,'approved',?,?,'human_approved','legacy synthetic','cleared',1,1)",
    ).bind(bundle.editionHash, JSON.stringify(bundle), bundle.editionHash),
    env.DB.prepare('UPDATE system_state SET active_content_hash=?').bind(bundle.editionHash),
  ]);
  const parent = await f.client.create('Earlier native parent');
  expect(parent.reading.kind).toBe('tarot.accepted.v1');
  const family = apiSchemas.SessionRecord.parse(
    await (await f.client.request('/sessions/' + parent.started.sessionId)).json(),
  );
  expect(
    (
      await f.client.request(
        '/sessions/' + family.id + '/save',
        { saved: true },
        { method: 'PUT', revision: family.revision },
      )
    ).status,
  ).toBe(200);
  if (!('contentHash' in f.reading) || !('sources' in parent.reading))
    throw new Error('Expected native readings');
  await env.DB.batch([
    env.DB.prepare("UPDATE content_editions SET state='superseded' WHERE hash=?").bind(
      bundle.editionHash,
    ),
    env.DB.prepare('UPDATE system_state SET active_content_hash=?').bind(f.reading.contentHash),
  ]);
  const child = await submit(f, await request(f, parent.reading.editionId));
  expect(child.status.state).toBe('published');
  expect(
    await (await f.client.request('/readings/' + child.status.editionId)).json(),
  ).toMatchObject({
    kind: 'tarot.accepted.v3',
    canonVersion: 1,
    parentEditionId: parent.reading.editionId,
    basis: parent.reading.basis,
    sources: parent.reading.sources,
  });
  expect(await (await f.client.request('/readings/' + parent.reading.editionId)).json()).toEqual(
    parent.reading,
  );
});
test('deleting a family fences a pending follow-up and rejects its old parent link', async () => {
  const f = await fixture(),
    input = await request(f, f.reading.editionId);
  const barrier = gate((sql) => sql.some((s) => s.includes('INSERT INTO reading_editions')));
  const client = new ReadingClient({ ...f.client.bindings, DB: barrier.db });
  client.cookies = f.client.cookies;
  client.csrf = f.client.csrf;
  const response = client.request('/requests', input);
  expect(await Promise.race([barrier.ready.then(() => true), response.then(() => false)])).toBe(
    true,
  );
  try {
    const family = await new ReadingRecords(f.base).session(f.session, f.started.sessionId);
    expect(
      (
        await f.client.request(
          '/sessions/' + family.id,
          { receiptId: crypto.randomUUID(), receiptToken: randomToken() },
          { method: 'DELETE', revision: family.revision },
        )
      ).status,
    ).toBe(202);
  } finally {
    barrier.release();
  }
  await response;
  expect(
    await env.DB.prepare(
      'SELECT count(*) n FROM reading_editions WHERE session_id=? AND body_enc IS NOT NULL',
    )
      .bind(f.started.sessionId)
      .first('n'),
  ).toBe(0);
  expect(
    (await f.client.request('/requests', { ...input, clientIntentId: crypto.randomUUID() })).status,
  ).toBe(410);
});

test('failed attempts beyond 51 are still exported as individual receipts while the session summary includes the most recent request', async () => {
  const f = await fixture(),
    ids = Array.from({ length: 52 }, () => crypto.randomUUID());
  await env.DB.batch(
    ids.map((id, i) =>
      env.DB.prepare(`INSERT INTO generation_requests(id,owner_id,session_id,client_intent_id,basis_id,parent_edition_id,operation,payload_hmac,state,next_run_at,permission_revision,key_version,content_hash,content_policy_revision,policy_hash,created_at,expires_at,finished_at)
    SELECT ?,owner_id,session_id,?,basis_id,?,'followup',payload_hmac,'cancelled',next_run_at,permission_revision,key_version,content_hash,content_policy_revision,policy_hash,created_at+?,expires_at+?,created_at+? FROM generation_requests WHERE id=?`).bind(
        id,
        crypto.randomUUID(),
        f.reading.editionId,
        i + 1,
        i + 1,
        i + 1,
        f.started.requestId,
      ),
    ),
  );
  const ticket = await f.exports.create(f.session, crypto.randomUUID()),
    page = await f.exports.page(f.session, ticket.id, null);
  expect(page.records.filter((r) => r.kind === 'generation_receipt')).toHaveLength(53);
  const record = page.records.find((r) => r.kind === 'session');
  if (record?.kind !== 'session') throw new Error('missing session');
  expect(record.value.requests).toHaveLength(51);
  expect(record.value.requests.at(-1)?.requestId).toBe(ids.at(-1));
  expect(
    (await new ReadingRecords(f.base).session(f.session, f.started.sessionId)).requests,
  ).toEqual(record.value.requests);
});

test('a synthetic photo start keeps recognized cards and reviewed excerpts in separate transmissions', async () => {
  const f = await fixture(),
    { input } = await selection(f, null);
  const photo =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
  let writerPacket = '',
    recognition = '';
  const { DeterministicSpreadRecognizer } = await import(
    '../../src/worker/provider/meta-vision.ts'
  );
  const service = new LocalGeneration(
    f.base,
    {
      async write(v) {
        writerPacket = new TextDecoder().decode(v.payload);
        return { kind: 'uncertain', reason: 'network', receipt: null };
      },
    },
    {
      async recognize(v) {
        recognition = JSON.stringify(v);
        return new DeterministicSpreadRecognizer().recognize(v);
      },
    },
  );
  const result = await service.start(
    f.session,
    { ...input, spreadPhoto: photo },
    crypto.randomUUID(),
  );
  expect(result.status.state).toBe('published');
  expect(recognition).toContain(photo);
  expect(recognition).not.toContain('Ask about this');
  expect(writerPacket).toContain('Ask about this 🌱');
  expect(writerPacket).not.toContain('data:image');
  expect(writerPacket).not.toContain('Secret unselected tail');
});

test('an imported unknown-method parent, a changed reversal choice and a replacement photo are rejected without a new request', async () => {
  const f = await fixture(),
    input = await request(f, f.reading.editionId);
  const source = { namespaceId: crypto.randomUUID(), revision: 'unverified' };
  const doc = {
    schema_version: '0.8.0',
    readings: {
      items: [
        {
          id: 'pattern',
          revision: 1,
          local_date: '2026-10-26',
          artifact: { unverified: 'unknown' },
          evidence: null,
        },
      ],
    },
  };
  const { parseImportFile } = await import('../../src/domain/imports/parse.ts');
  const { buildImportGroups } = await import('../../src/domain/imports/chunks.ts');
  const units = await parseImportFile({
    format: 'patternlike-export',
    source,
    recovery: { kind: 'none' },
    document: JSON.stringify(doc),
  });
  const [group] = await buildImportGroups(units.units, () => crypto.randomUUID());
  for (const chunk of group!.chunks)
    expect((await f.client.request('/imports', chunk)).status).toBe(201);
  const path = '/imports/groups/' + group!.id,
    pending = apiSchemas.ImportGroupStatus.parse(await (await f.client.request(path)).json());
  expect(
    (
      await f.client.request(path + '/commit', {
        version: 'import-group.v1',
        manifestHash: pending.manifestHash,
        previewHash: pending.previewHash,
        confirmedRecovery: { kind: 'none' },
      })
    ).status,
  ).toBe(200);
  const history = (await new ReadingRecords(f.base).history(f.session)).items.find(
    (x) => x.imported,
  )!;
  expect(
    (await f.client.request('/requests', { ...input, parentEditionId: history.latestEditionId }))
      .status,
  ).toBe(410);
  expect(
    (await f.client.request('/requests', { ...input, reversals: !input.reversals })).status,
  ).toBe(422);
  expect(
    (
      await f.client.request('/requests', {
        ...input,
        spreadPhoto:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
      })
    ).status,
  ).toBe(422);
  expect(await env.DB.prepare('SELECT count(*) n FROM generation_requests').first('n')).toBe(1);
});
