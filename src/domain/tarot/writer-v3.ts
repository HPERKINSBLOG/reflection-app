import { z } from 'zod';
import {
  ModelCandidateV3,
  ModelUnitV3,
  WriterReceiptV3,
  type PreparedPlanV3,
} from '../../contracts/index.ts';
import {
  READING_CONTINUITY_POLICY,
  type ReadingV3WriterPolicy,
} from '../../contracts/provider-policy.ts';
import { sha256Bytes, sha256Json } from '../json.ts';
import { providerPolicyHash } from '../provider-policy.ts';
import { validatePlanV3 } from './continuity.ts';
import { renderFacts } from './facts.ts';
export async function writerIdentitiesV3(
  policy: ReadingV3WriterPolicy = READING_CONTINUITY_POLICY,
) {
  return {
    promptHash: await sha256Json(policy.prompt),
    validatorHash: await sha256Json({
      version: policy.validatorVersion,
      outputSchema: z.toJSONSchema(ModelCandidateV3),
    }),
    generationPolicyHash: await providerPolicyHash(policy),
  };
}
export function candidateSchemaV3(plan: PreparedPlanV3) {
  const ids = plan.sources.map((s) => s.id) as [string, ...string[]];
  const refs = z.array(z.enum(ids)).min(1).max(3);
  const contextRefs = z
    .array(
      z.enum(['reader:question', ...plan.selected.map((f) => `selection:${f.ordinal}`)] as [
        string,
        ...string[],
      ]),
    )
    .min(1)
    .max(4);
  const relationships = plan.canon.version === 2 ? plan.canon.relationships.map((r) => r.id) : [];
  return z.toJSONSchema(
    ModelCandidateV3.extend({
      units: z.array(ModelUnitV3.extend({ sourceIds: refs.length(1), contextRefs })).length(3),
      synthesis: ModelCandidateV3.shape.synthesis.extend({
        sourceIds: refs.min(2),
        contextRefs,
        relationshipIds: relationships.length
          ? z.array(z.enum(relationships as [string, ...string[]])).max(2)
          : z.array(z.string()).max(0),
      }),
      action: ModelCandidateV3.shape.action.extend({ sourceIds: refs, contextRefs }),
      reflectionQuestion: ModelCandidateV3.shape.reflectionQuestion
        .unwrap()
        .extend({ sourceIds: refs, contextRefs })
        .nullable(),
    }),
  );
}
export async function prepareWriterV3(
  value: PreparedPlanV3,
  policy: ReadingV3WriterPolicy = READING_CONTINUITY_POLICY,
): Promise<{ payload: Uint8Array; receipt: WriterReceiptV3 }> {
  const plan = await validatePlanV3(value),
    identities = await writerIdentitiesV3(policy);
  if (
    policy.schemaVersion !== 'tarot.interpretation.v3' ||
    plan.promptHash !== identities.promptHash ||
    plan.validatorHash !== identities.validatorHash ||
    plan.generationPolicyHash !== identities.generationPolicyHash ||
    !policy.evaluationOnly
  )
    throw new Error('POLICY_MISMATCH: v3 writer identity');
  const data = {
    reader: { id: 'reader:question', text: plan.question },
    draw: plan.draw.map((c) => ({ ...c })),
    facts: renderFacts(plan.basis),
    positions: plan.positionFrames.map((p) => ({ position: p.position, text: p.text })),
    ...(plan.canon.version === 1
      ? {
          sources: plan.canon.sources.map((s, i) => ({
            sourceId: s.id,
            version: s.version,
            factId: plan.basis.cards[i]!.id,
            text: s.text,
            attribution: s.rights.attribution,
          })),
        }
      : {
          spreadVersion: plan.canon.spreadVersion,
          meanings: plan.canon.sources.map((s, i) => ({
            sourceId: s.id,
            version: s.version,
            factId: plan.basis.cards[i]!.id,
            core: s.meaning.core,
            distinctions: [...s.meaning.distinctions],
            positive: s.meaning.positive,
            limits: [...s.meaning.limits],
            ...(s.meaning.imagery
              ? {
                  imagery: { text: s.meaning.imagery.text, reference: s.meaning.imagery.reference },
                }
              : {}),
            attribution: s.rights.attribution,
          })),
          relationships: plan.canon.relationships.map((r) => ({
            id: r.id,
            version: r.version,
            sourceIds: [...r.sourceIds],
            conditions: {
              cards: r.cards.map((c) => ({ cardId: c.cardId, orientations: [...c.orientations] })),
              themes: [...r.themes],
            },
            text: r.text,
            limits: r.limits,
            attribution: r.rights.attribution,
          })),
        }),
    selected: plan.selected.map((f) => ({
      label: `selection:${f.ordinal}`,
      authorship: f.authorship,
      text: f.text,
    })),
  };
  const schema = candidateSchemaV3(plan);
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
    throw new Error(
      'INPUT_TOO_LARGE: shorten question or selected context; no excerpt was omitted',
    );
  return {
    payload,
    receipt: WriterReceiptV3.parse({
      version: 'writer-packet.v3',
      diagnosticOnly: plan.diagnosticOnly,
      contextHash: plan.contextHash,
      contentHash: plan.contentHash,
      deckEdition: plan.basis.deckEdition,
      spreadVersion: plan.canon.version === 2 ? plan.canon.spreadVersion : null,
      sources: plan.sources.map(({ id, version, hash }) => ({ id, version, hash })),
      relationships:
        plan.canon.version === 2
          ? plan.canon.relationships.map(({ id, version, hash }) => ({ id, version, hash }))
          : [],
      selected: plan.selected.map((f) => ({
        label: `selection:${f.ordinal}`,
        authorship: f.authorship,
        textHash: f.textHash,
      })),
      omissions: [],
      promptHash: identities.promptHash,
      validatorHash: identities.validatorHash,
      policyHash: identities.generationPolicyHash,
      schemaHash: await sha256Json(schema),
      transmissionHash: await sha256Bytes(payload),
      payloadBytes: payload.length,
      estimatedInputTokens,
    }),
  };
}
/** Deterministic local candidate; it does not pretend to have interpreted the selected excerpts. */
export async function composeTemplateV3(value: PreparedPlanV3): Promise<ModelCandidateV3> {
  const plan = await validatePlanV3(value),
    refs = { sourceIds: plan.sources.map((s) => s.id), contextRefs: ['reader:question'] };
  return ModelCandidateV3.parse({
    schemaVersion: 3,
    kind: 'tarot.interpretation.v3',
    units: plan.basis.cards.map((c, i) => ({
      position: c.position,
      factIds: [c.id],
      sourceIds: [plan.sources[i]!.id],
      contextRefs: ['reader:question'],
      interpretation: plan.sources[i]!.fallbackText,
    })),
    synthesis: {
      ...refs,
      relationshipIds: [],
      text: plan.canon.version === 2 ? plan.canon.fallback.synthesis : plan.canon.fallbackClosing,
    },
    action: {
      ...refs,
      text:
        plan.canon.version === 2
          ? plan.canon.fallback.action
          : 'You could compare these perspectives with what matters in the current question.',
    },
    reflectionQuestion:
      plan.canon.version === 2 && plan.canon.fallback.question
        ? { ...refs, text: plan.canon.fallback.question }
        : null,
  });
}
