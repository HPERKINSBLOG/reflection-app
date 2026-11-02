import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { apiSchemas } from '../../src/contracts/index.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { readingAccount } from '../fixtures/reading-client.ts';
import { importGroup, commitGroup, portableGroups } from '../fixtures/import-workflows.ts';
import { edited, fixture } from '../fixtures/revisits.ts';
import { buildImportGroups } from '../../src/domain/imports/chunks.ts';
import { parseImportFile } from '../../src/domain/imports/parse.ts';
import { Reflections } from '../../src/worker/readings/reflections.ts';
import { nativeImports } from '../../src/worker/readings/import-native-batch.ts';
import { RecordBase } from '../../src/worker/readings/base.ts';

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));

test('native reconciliation of a hundred authored revisions stays within a bounded D1 query budget', async () => {
  const f = await fixture(),
    service = new Reflections(f.base);
  const input = {
    editionId: f.reading.editionId,
    text: 'First authored revision',
    stance: 'unspecified' as const,
  };
  let record = await service.write(f.session, f.reading.sessionId, input, crypto.randomUUID());
  for (let revision = 2; revision <= 100; revision++)
    record = await service.write(
      f.session,
      f.reading.sessionId,
      { ...input, text: `Authored revision ${revision}` },
      crypto.randomUUID(),
      { id: record.id, revision: revision - 1 },
    );
  const exported = await portableGroups(f.client),
    units = exported.groups.flatMap((g) => g.units);
  let calls = 0;
  const counted = new Proxy(env.DB, {
    get(target, property) {
      if (property === 'batch')
        return (statements: D1PreparedStatement[]) => {
          calls++;
          return target.batch(statements);
        };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const results = await nativeImports(new RecordBase(counted, f.base.identity), f.session, units);
  expect([...results.values()].every((result) => result?.matches)).toBe(true);
  expect(calls).toBeLessThan(80);
});

test('legacy prose and independent authored text survive a portable round trip without wrapping raw bytes again', async () => {
  const first = await readingAccount(),
    raw = await importGroup({ children: 1, note: 'EXACT_AUTHORED_NOTE' });
  await commitGroup(first.client, raw);
  const exported = await portableGroups(first.client),
    second = await readingAccount(true, false);
  // Select the exact external session dependency before its differently namespaced legacy family.
  const selected = [...exported.groups].sort(
    (a, b) =>
      Number(b.units.some((u) => u.identity.kind === 'session')) -
      Number(a.units.some((u) => u.identity.kind === 'session')),
  );
  for (const group of selected)
    expect((await commitGroup(second.client, group)).status.state).toBe('complete');
  const again = await portableGroups(second.client);
  const originals = exported.pages
    .flatMap((p) => p.records)
    .filter((r) => r.kind === 'reading' || r.kind === 'reflection');
  const copies = again.pages
    .flatMap((p) => p.records)
    .filter((r) => r.kind === 'reading' || r.kind === 'reflection');
  const byIdentity = (a: (typeof copies)[number], b: (typeof copies)[number]) =>
    JSON.stringify(a.identity).localeCompare(JSON.stringify(b.identity));
  expect(copies.sort(byIdentity)).toEqual(originals.sort(byIdentity));
  expect(await env.DB.prepare('SELECT count(*) n FROM provider_dispatches').first('n')).toBe(0);
});

test('portable revisit histories retain both revisions and exact erasure removes every alias', async () => {
  const source = await fixture();
  await edited(source);
  const exported = await portableGroups(source.client),
    destination = await readingAccount();
  for (const group of exported.groups)
    expect((await commitGroup(destination.client, group)).status.state).toBe('complete');
  const row = await env.DB.prepare('SELECT id,current_revision FROM revisits WHERE owner_id != ?')
    .bind(source.session.subjectId)
    .first<{ id: string; current_revision: number }>();
  expect(row?.current_revision).toBe(2);
  const current = apiSchemas.Revisit.parse(
    await (await destination.client.request(`/revisits/${row!.id}`)).json(),
  );
  expect(current.note).toBe('Second note');
  const historical = await env.DB.prepare(
    'SELECT count(*) n FROM revisit_revisions WHERE revisit_id=?',
  )
    .bind(row!.id)
    .first('n');
  expect(historical).toBe(1);
  const { randomToken } = await import('../../src/worker/identity/crypto.ts');
  const erased = await destination.client.request(
    `/revisits/${row!.id}`,
    { receiptId: crypto.randomUUID(), receiptToken: randomToken() },
    { method: 'DELETE', revision: 2 },
  );
  expect(erased.status, await erased.clone().text()).toBe(202);
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM import_identities WHERE entity_kind='revisit' AND source_record_enc IS NOT NULL",
    ).first('n'),
  ).toBe(0);
});

test('declared historical snapshot identities reconcile owned content and remain compatibility aliases', async () => {
  const f = await fixture(),
    exported = await portableGroups(f.client);
  const pages = structuredClone(exported.pages);
  for (const page of pages)
    for (const record of page.records) record.identity.source.revision = 'snapshot-17';
  const source = { namespaceId: f.session.subjectId, revision: 'snapshot-17' };
  const parsed = await parseImportFile({
    format: 'reflection-export.v1',
    source,
    recovery: { kind: 'none' },
    document: pages.map((p) => JSON.stringify(p)).join('\n'),
  });
  expect(parsed.errors).toEqual([]);
  for (const group of await buildImportGroups(parsed.units, () => crypto.randomUUID())) {
    expect((await commitGroup(f.client, group)).status.state).toBe('complete');
    const results = apiSchemas.ImportGroupResultPage.parse(
      await (await f.client.request(`/imports/groups/${group.id}/results`)).json(),
    );
    expect(results.items.every((item) => item.status === 'duplicate')).toBe(true);
  }
  expect(await env.DB.prepare('SELECT count(*) n FROM reading_editions').first('n')).toBe(1);
  const again = await portableGroups(f.client);
  expect(
    again.pages.flatMap((p) => p.records).find((r) => r.kind === 'reading')!.identity.source
      .revision,
  ).toBe('snapshot-17');
});
