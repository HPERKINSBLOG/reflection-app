import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { AcceptedReadingV2, ImportedReading } from '../../src/contracts/index.ts';
import { ImportedReadingDetail } from '../../src/client/imported-reading.tsx';
import { sha256Json } from '../../src/domain/json.ts';
import { buildPlanV2 } from '../../src/domain/tarot/context-v2.ts';
import { v2Input } from '../fixtures/canon-v2.ts';

test('an imported native v2 snapshot exposes the exact separated historical interpretation, synthesis, action, question, canon and provenance', async () => {
  const plan = await buildPlanV2(await v2Input());
  const editionId = crypto.randomUUID(),
    sessionId = crypto.randomUUID(),
    acceptedAt = '2026-01-14T15:30:00Z';
  const sourceIds = plan.sources.map((s) => s.id),
    refs = { contextRefs: ['reader:question'], sourceIds };
  const native = AcceptedReadingV2.parse({
    kind: 'tarot.accepted.v2',
    editionId,
    sessionId,
    editionNumber: 2,
    parentEditionId: crypto.randomUUID(),
    question: 'An original historical question',
    basis: plan.basis,
    mode: 'model',
    contentHash: plan.contentHash,
    planHash: plan.contextHash,
    sources: plan.sources,
    units: plan.basis.cards.map((c, i) => ({
      position: c.position,
      basisText: 'Historical fact ' + i,
      factIds: [c.id],
      sourceIds: [sourceIds[i]],
      contextRefs: ['reader:question'],
      interpretation: 'Original paragraph ' + i,
    })),
    draw: plan.draw,
    spread: plan.spread,
    relationships: plan.relationships,
    synthesis: { ...refs, relationshipIds: [], text: 'An independently kept synthesis.' },
    action: { ...refs, text: 'The exact optional action.' },
    reflectionQuestion: { ...refs, text: 'A precise final question?' },
    contextReceipt: null,
    acceptedAt,
    provenance: {
      requestId: plan.requestId,
      dispatchId: null,
      provider: null,
      requestedModel: null,
      returnedModel: null,
      promptHash: plan.promptHash,
      validatorHash: plan.validatorHash,
      policyHash: plan.generationPolicyHash,
      contentHash: plan.contentHash,
      selected: [],
      transmissionHash: null,
      fallbackReason: null,
      schemaHash: plan.contextHash,
      contextHash: plan.contextHash,
    },
  });
  const identity = {
    source: { namespaceId: crypto.randomUUID(), revision: 'native-v1' },
    kind: 'reading',
    recordId: editionId,
    recordRevision: 1,
  };
  const raw = JSON.stringify({ kind: 'reading', identity, originalId: editionId, value: native });
  const reading = ImportedReading.parse({
    kind: 'legacy.imported.v1',
    editionId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    editionNumber: 1,
    importedAt: '2026-02-16T12:00:00Z',
    record: {
      format: 'reflection-import.v1',
      source: 'successor',
      identity,
      parentIdentity: null,
      originalId: editionId,
      originalParentId: native.parentEditionId,
      originalTimestamp: acceptedAt,
      occurredAt: acceptedAt,
      question: native.question,
      generatedText: 'Legacy fallback summary',
      userStatements: [],
      basis: {
        method: 'tarot',
        cards: [],
        sourceIds,
        rawBasisJson: null,
        verification: 'legacy_unverified',
      },
      originalJsonText: raw,
      originalSha256: await sha256Json(raw),
      provenanceGaps: ['review'],
      review: 'legacy_unknown',
    },
  });
  const html = renderToStaticMarkup(
    createElement(ImportedReadingDetail, { reading, headingRef: null }),
  );
  for (const text of [
    native.question,
    'Original paragraph 0',
    'Historical fact 2',
    'An independently kept synthesis.',
    'The exact optional action.',
    'A precise final question?',
    native.sources[0]!.text,
    native.acceptedAt,
    'Original sources and provenance',
    'Imported, unverified',
  ])
    expect(html).toContain(text);
});
