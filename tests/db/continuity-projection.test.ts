import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { apiSchemas, AcceptedReadingV3 } from '../../src/contracts/index.ts';
import { editionContextPassages } from '../../src/contracts/context-reading.ts';
import { ContextRecords } from '../../src/worker/readings/context.ts';
import { clearDatabase } from '../fixtures/database.ts';
import { fixture, note } from '../fixtures/revisits.ts';

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(() => clearDatabase(env.DB));

async function continued(f: Awaited<ReturnType<typeof fixture>>, selected = false) {
  const context = new ContextRecords(f.base.db, f.base.identity);
  const input = apiSchemas.StartRequest.parse({
    clientIntentId: crypto.randomUUID(),
    question: 'PRIVATE_PARENT_QUESTION: What could I explore now?',
    permissionRevision: (await f.client.me()).permission.revision,
    parentEditionId: f.reading.editionId,
    languageConfirmed: 'en',
    reversals: true,
    selection: [],
  });
  if (selected) {
    const entry = await note(f, 'Explicitly shared text. PRIVATE_UNSELECTED_TAIL');
    const grant = await context.grant(f.session, crypto.randomUUID(), {
      kind: 'revisit_revision',
      revisitId: entry.id,
      revision: entry.revision,
    });
    const preview = await context.preview(f.session, {
      clientIntentId: input.clientIntentId,
      question: input.question,
      permissionRevision: input.permissionRevision,
      parentEditionId: input.parentEditionId,
      items: [{ grantId: grant.id, grantRevision: grant.revision, start: 0, end: 23 }],
    });
    input.selection = preview.items.map((item) => item.selection);
    input.contextAcknowledgement = preview.acknowledgementHash;
  }
  const response = await f.client.request('/requests', input);
  expect(response.status, await response.clone().text()).toBe(202);
  const started = apiSchemas.StartResponse.parse(await response.json());
  expect(started.status.state).toBe('published');
  const reading = AcceptedReadingV3.parse(
    await (await f.client.request(`/readings/${started.status.editionId}`)).json(),
  );
  return { started, reading, context };
}

test('owned v3 edition previews expose generated prose without its question or provenance', async () => {
  const f = await fixture();
  const { reading, context } = await continued(f);
  const grant = await context.grant(f.session, crypto.randomUUID(), {
    kind: 'edition',
    editionId: reading.editionId,
  });
  const passage = editionContextPassages(reading)[0]!;
  const preview = await context.preview(f.session, {
    clientIntentId: crypto.randomUUID(),
    question: 'New question',
    parentEditionId: null,
    permissionRevision: (await f.client.me()).permission.revision,
    items: [{ grantId: grant.id, grantRevision: grant.revision, start: 0, end: 12 }],
  });
  expect(preview.items[0]).toMatchObject({
    text: [...passage.text].slice(0, 12).join(''),
    authorship: 'generated',
  });
  expect(JSON.stringify(preview)).not.toContain('PRIVATE_PARENT_QUESTION');
  expect(JSON.stringify(preview)).not.toContain(reading.provenance.requestId);
});

test('owned export preserves the actual v3 transmission receipt and only the selected text', async () => {
  const f = await fixture();
  const { started, reading } = await continued(f, true);
  const ticket = await f.exports.create(f.session, crypto.randomUUID());
  const page = await f.exports.page(f.session, ticket.id, null);
  const record = page.records.find(
    (r) => r.kind === 'generation_receipt' && r.originalId === started.requestId,
  );
  if (record?.kind !== 'generation_receipt') throw new Error('Missing v3 receipt');
  expect(record.value.contextReceipt).toMatchObject({
    version: 'writer-packet.v3',
    transmissionHash: reading.contextReceipt!.transmissionHash,
  });
  expect(record.value.transmission).toContain('Explicitly shared text.');
  expect(record.value.transmission).not.toContain('PRIVATE_UNSELECTED_TAIL');
  expect(record.value.selectedFragments).toMatchObject([{ text: 'Explicitly shared text.' }]);
});
