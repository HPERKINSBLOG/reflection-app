import { z } from 'zod';
import {
  ContinuityRef,
  ModelCandidateV3,
  ModelUnitV3,
  type PreparedPlanV3,
  WriterReceiptV3,
} from '../../contracts/index.ts';
import {
  READING_V3_SYNTHETIC_POLICY,
  type ReadingV3WriterPolicy,
} from '../../contracts/provider-policy.ts';
import { sha256Bytes, sha256Json } from '../json.ts';
import { providerPolicyHash } from '../provider-policy.ts';
import { validatePlanV3 } from './continuity.ts';
import { renderFacts } from './facts.ts';

export async function prepareWriterV3(
  value: PreparedPlanV3,
  policy: ReadingV3WriterPolicy = READING_V3_SYNTHETIC_POLICY,
): Promise<{ payload: Uint8Array; receipt: WriterReceiptV3 }> {
  const plan = await validatePlanV3(value);
  if ((await providerPolicyHash(policy)) !== plan.writerPolicyHash)
    throw new Error('POLICY_MISMATCH: continuity profile');
  const selected = plan.selected.map((f) => ({
    id: ContinuityRef.parse(`selection:${f.ordinal}`),
    authorship: f.authorship,
    text: f.text,
  }));
  const data = {
    reader: { id: 'reader:question', text: plan.question },
    facts: renderFacts(plan.basis),
    sources: plan.sources.map((s, i) => ({
      id: s.id,
      version: s.version,
      position: plan.basis.cards[i]!.position,
      factId: plan.basis.cards[i]!.id,
      text: s.text,
      ...('meaning' in s
        ? {
            meaning: {
              core: s.meaning.core,
              distinctions: s.meaning.distinctions,
              positive: s.meaning.positive,
              limits: s.meaning.limits,
              ...(s.meaning.imagery
                ? {
                    imagery: {
                      text: s.meaning.imagery.text,
                      reference: s.meaning.imagery.reference,
                    },
                  }
                : {}),
            },
          }
        : {}),
    })),
    ...(plan.developed
      ? {
          draw: plan.developed.draw.map(({ name, cardId, position, orientation }) => ({
            name,
            cardId,
            position,
            orientation,
          })),
          positions: plan.developed.spread.positions.map(({ position, text }) => ({
            position,
            text,
          })),
          relationships: plan.developed.relationships.map((r) => ({
            id: r.id,
            sourceIds: r.sourceIds,
            text: r.text,
            limits: r.limits,
          })),
        }
      : {}),
    selected,
  };
  const refs = ['reader:question', ...selected.map((s) => s.id)] as [string, ...string[]];
  const sources = plan.sources.map((s) => s.id) as [string, ...string[]];
  const schema = z.toJSONSchema(
    ModelCandidateV3.extend({
      units: z
        .array(
          ModelUnitV3.extend({
            sourceIds: z.array(z.enum(sources)).length(1),
            contextRefs: z.array(z.enum(refs)).min(1).max(refs.length),
          }),
        )
        .length(3),
    }),
  );
  const payload = new TextEncoder().encode(
    JSON.stringify({
      model: policy.model,
      ...policy.request,
      input: [
        { role: 'system', content: policy.prompt.system },
        { role: 'developer', content: policy.prompt.developer },
        { role: 'user', content: JSON.stringify(data) },
      ],
      text: { format: { type: 'json_schema', name: 'tarot_interpretation', strict: true, schema } },
    }),
  );
  const estimatedInputTokens = payload.length + policy.estimator.framingTokens;
  if (
    payload.length > policy.estimator.maxPayloadBytes ||
    estimatedInputTokens > policy.estimator.maxInputTokens
  )
    throw new Error('INPUT_TOO_LARGE: shorten the question or reviewed excerpts');
  return {
    payload,
    receipt: WriterReceiptV3.parse({
      version: 'writer-packet.v3',
      diagnosticOnly: true,
      canonVersion: plan.canonVersion,
      contextHash: plan.contextHash,
      contentHash: plan.contentHash,
      deckEdition: plan.basis.deckEdition,
      sources: plan.sources.map(({ id, version, hash }) => ({ id, version, hash })),
      ...(plan.developed
        ? {
            relationships: plan.developed.relationships.map(({ id, version, hash }) => ({
              id,
              version,
              hash,
            })),
          }
        : {}),
      shared: plan.selected.map(({ ordinal, textHash }) => ({ ordinal, textHash })),
      promptHash: plan.promptHash,
      schemaHash: await sha256Json(schema),
      validatorHash: plan.validatorHash,
      policyHash: plan.writerPolicyHash,
      transmissionHash: await sha256Bytes(payload),
      estimatedInputTokens,
      payloadBytes: payload.length,
    }),
  };
}
export async function composeTemplateV3(value: PreparedPlanV3): Promise<ModelCandidateV3> {
  const plan = await validatePlanV3(value);
  return ModelCandidateV3.parse({
    schemaVersion: 3,
    kind: 'tarot.interpretation.v3',
    units: plan.basis.cards.map((card, i) => ({
      position: card.position,
      factIds: [card.id],
      sourceIds: [plan.sources[i]!.id],
      contextRefs: ['reader:question'],
      interpretation: plan.sources[i]!.fallbackText,
      reflectionQuestion: plan.sources[i]!.reflectionQuestion,
    })),
    closing: plan.fallbackClosing,
  });
}
