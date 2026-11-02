import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { AcceptedReadingV3 } from '../../src/contracts/index.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { fixture } from '../fixtures/revisits.ts';
import { ContextRecords } from '../../src/worker/readings/context.ts';
import { buildPlanV3 } from '../../src/domain/tarot/continuity.ts';
import { writerIdentitiesV3, prepareWriterV3 } from '../../src/domain/tarot/writer-v3.ts';
import { syntheticPlanInput } from '../fixtures/canon.ts';
beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));
test('owned v3 edition previews expose generated prose without question or provenance', async () => {
  const f = await fixture();
  if (f.reading.kind !== 'tarot.accepted.v2') throw new Error('fixture requires native v2');
  const { spread, relationships, ...old } = f.reading;
  const reading = AcceptedReadingV3.parse({
    ...old,
    kind: 'tarot.accepted.v3',
    canon: {
      version: 2,
      sources: old.sources,
      spreadVersion: spread.version,
      relationships,
      fallback: { synthesis: old.synthesis.text, action: old.action.text, question: null },
    },
    positionFrames: spread.positions,
    units: old.units.map((u, i) => ({
      ...u,
      interpretation: ['Exact first.', 'Exact second.', 'Exact third.'][i],
    })),
    contextReceipt: null,
  });
  const encrypted = await f.base.crypt.seal(
    {
      ownerId: f.session.subjectId,
      table: 'reading_editions',
      column: 'body_enc',
      recordId: reading.editionId,
      aadRevision: 1,
    },
    reading,
    1,
  );
  await env.DB.prepare('UPDATE reading_editions SET body_enc=? WHERE id=?')
    .bind(encrypted, reading.editionId)
    .run();
  const context = new ContextRecords(f.base),
    g = await context.grant(f.session, crypto.randomUUID(), {
      kind: 'edition',
      editionId: reading.editionId,
    });
  const value = await context.preview(f.session, {
    clientIntentId: crypto.randomUUID(),
    question: 'New question',
    parentEditionId: null,
    permissionRevision: (await f.client.me()).permission.revision,
    items: [{ grantId: g.id, grantRevision: g.revision, start: 0, end: 12 }],
  });
  expect(value.items[0]).toMatchObject({ text: 'Exact first.', authorship: 'generated' });
  expect(JSON.stringify(value)).not.toContain(old.question);
});
test('owned export decodes retained v3 transmission receipt without dropping provenance', async () => {
  const f = await fixture(),
    input = await syntheticPlanInput();
  const text = 'An explicitly selected fragment';
  const plan = await buildPlanV3({
    ...input,
    ...(await writerIdentitiesV3()),
    selected: [
      {
        ordinal: 0,
        grantId: crypto.randomUUID(),
        grantRevision: 1,
        sourceKind: 'revisit_revision',
        sourceId: crypto.randomUUID(),
        sourceRevision: 1,
        start: 0,
        end: text.length,
        text,
        textHash: 'e'.repeat(64),
        availability: 'retained',
        authorship: 'user',
      },
    ],
  });
  const packet = await prepareWriterV3(plan);
  const dispatch = await env.DB.prepare('SELECT id FROM provider_dispatches WHERE request_id=?')
    .bind(f.started.requestId)
    .first<{ id: string }>();
  expect(dispatch).not.toBeNull();
  const encrypted = await f.base.crypt.seal(
    {
      ownerId: f.session.subjectId,
      table: 'provider_dispatches',
      column: 'transmission_enc',
      recordId: dispatch!.id,
      aadRevision: 1,
    },
    {
      v: 1,
      syntheticOnly: true,
      payload: new TextDecoder().decode(packet.payload),
      contextReceipt: packet.receipt,
    },
    1,
  );
  await env.DB.prepare('UPDATE provider_dispatches SET transmission_enc=? WHERE id=?')
    .bind(encrypted, dispatch!.id)
    .run();
  const ticket = await f.exports.create(f.session, crypto.randomUUID());
  let cursor: string | null = null;
  let found = false;
  do {
    const page = await f.exports.page(f.session, ticket.id, cursor);
    for (const item of page.records)
      if (item.kind === 'generation_receipt') {
        expect(item.value.contextReceipt?.version).toBe('writer-packet.v3');
        expect(item.value.transmission).toBe(new TextDecoder().decode(packet.payload));
        found = true;
      }
    cursor = page.nextCursor;
  } while (cursor);
  expect(found).toBe(true);
});
