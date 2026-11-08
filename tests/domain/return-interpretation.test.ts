import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { AcceptedReadingV2 } from '../../src/contracts/index.ts';
import { ReturnInterpretation } from '../../src/client/return-interpretation.tsx';
import { buildPlanV2 } from '../../src/domain/tarot/context-v2.ts';
import { v2Input } from '../fixtures/canon-v2.ts';

test('source headings name each card by its position, whatever order the draw lists them in', async () => {
  const plan = await buildPlanV2(await v2Input());
  const sourceIds = plan.sources.map((source) => source.id),
    refs = { contextRefs: ['reader:question'], sourceIds };
  const reading = AcceptedReadingV2.parse({
    kind: 'tarot.accepted.v2',
    editionId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    editionNumber: 1,
    parentEditionId: null,
    question: 'What is ready to begin?',
    basis: plan.basis,
    mode: 'model',
    contentHash: plan.contentHash,
    planHash: plan.contextHash,
    sources: plan.sources,
    units: plan.basis.cards.map((card, index) => ({
      position: card.position,
      basisText: `Drawn fact ${index}`,
      factIds: [card.id],
      sourceIds: [sourceIds[index]],
      contextRefs: ['reader:question'],
      interpretation: `Paragraph ${index}`,
    })),
    // Listed last to first, so a lookup by index names the wrong card.
    draw: [...plan.draw].reverse(),
    spread: plan.spread,
    relationships: plan.relationships,
    synthesis: { ...refs, relationshipIds: [], text: 'A synthesis.' },
    action: { ...refs, text: 'An action.' },
    reflectionQuestion: { ...refs, text: 'A question?' },
    contextReceipt: null,
    acceptedAt: '2026-11-08T12:00:00Z',
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
  const html = renderToStaticMarkup(
    createElement(ReturnInterpretation, { reading, runtimeMode: null, localRuntime: false }),
  );
  for (const card of reading.basis.cards) {
    const name = plan.draw.find((item) => item.position === card.position)!.name;
    const position = card.position[0]!.toUpperCase() + card.position.slice(1);
    expect(html, card.position).toContain(`${position}: ${name} (${card.cardId})`);
  }
});
