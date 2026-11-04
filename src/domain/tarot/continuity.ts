import { z } from 'zod';
import {
  AnyAcceptedReading,
  type AnyContentBundle,
  ModelCandidateV3,
  PreparedPlanV3,
} from '../../contracts/index.ts';
import { assertContextBounds, codePointLength } from '../../contracts/context-policy.ts';
import { READING_V3_SYNTHETIC_POLICY as policy } from '../../contracts/provider-policy.ts';
import { canonicalJson, sha256Json } from '../json.ts';
import { providerPolicyHash } from '../provider-policy.ts';
import { buildPlanV2, validatePlanV2 } from './context-v2.ts';
import { buildPlan, type BuildPlanInput, validatePlanIntegrity } from './plan.ts';

export type ParentEvidence = Pick<
  z.infer<typeof AnyAcceptedReading>,
  'editionId' | 'basis' | 'contentHash' | 'sources'
>;
export type BuildPlanV3Input = Omit<BuildPlanInput, 'content'> & {
  content: z.infer<typeof AnyContentBundle>;
  parent?: ParentEvidence;
};
export async function writerIdentitiesV3() {
  return {
    promptHash: await sha256Json(policy.prompt),
    validatorHash: await sha256Json({
      version: policy.validatorVersion,
      outputSchema: z.toJSONSchema(ModelCandidateV3),
    }),
    writerPolicyHash: await providerPolicyHash(policy),
  };
}

export async function buildPlanV3(input: BuildPlanV3Input): Promise<PreparedPlanV3> {
  const { content, parent, ...record } = input;
  const identities = await writerIdentitiesV3();
  const nativeInput = {
    ...record,
    operation: 'initial' as const,
    parentEditionId: null,
    selected: [],
    promptHash: identities.promptHash,
    validatorHash: identities.validatorHash,
  };
  const native =
    content.schemaVersion === 1
      ? await buildPlan({ ...nativeInput, content })
      : await buildPlanV2({ ...nativeInput, content }, true);
  if (record.operation === 'followup') {
    if (
      !parent ||
      !record.parentEditionId ||
      parent.editionId !== record.parentEditionId ||
      parent.contentHash !== native.contentHash ||
      canonicalJson(parent.basis) !== canonicalJson(native.basis) ||
      canonicalJson(parent.sources) !== canonicalJson(native.sources)
    )
      throw new Error('CONTENT_UNAVAILABLE: exact parent snapshot');
  } else if (parent || record.parentEditionId !== null || !record.selected.length) {
    throw new Error('BAD_INPUT: continuity request');
  }
  const snapshot = {
    ...record,
    ...identities,
    version: 'tarot-plan.v3' as const,
    canonVersion: content.schemaVersion,
    basis: native.basis,
    sources: native.sources,
    contentHash: native.contentHash,
    mandatoryFactIds: native.mandatoryFactIds,
    fallbackClosing:
      record.operation === 'followup'
        ? content.productCopy.followupClosing
        : content.productCopy.initialClosing,
    ...(native.version === 'tarot-plan.v2'
      ? {
          developed: {
            contextHash: native.contextHash,
            draw: native.draw,
            spread: native.spread,
            relationships: native.relationships,
            fallbackV2: native.fallbackV2,
          },
        }
      : {}),
  };
  return validatePlanV3({ ...snapshot, contextHash: await sha256Json(snapshot) });
}

export async function validatePlanV3(value: unknown): Promise<PreparedPlanV3> {
  const result = PreparedPlanV3.safeParse(value);
  if (!result.success) throw new Error('CONTENT_UNAVAILABLE: continuity snapshot');
  const plan = result.data,
    { contextHash, ...snapshot } = plan;
  const { canonVersion, developed, writerPolicyHash, fallbackClosing, ...common } = snapshot;
  if (
    !plan.question.trim() ||
    (plan.operation === 'followup') !== (plan.parentEditionId !== null) ||
    (plan.operation === 'initial' && !plan.selected.length) ||
    (canonVersion === 2) !== !!developed ||
    contextHash !== (await sha256Json(snapshot))
  )
    throw new Error('CONTENT_UNAVAILABLE: continuity snapshot identity');
  assertContextBounds(plan.selected);
  if (
    plan.selected.some(
      (f, i) =>
        f.ordinal !== i ||
        f.availability !== 'retained' ||
        f.text === null ||
        f.textHash === null ||
        f.end - f.start !== codePointLength(f.text),
    )
  )
    throw new Error('CONTEXT_CHANGED: captured selection');
  const ids = await writerIdentitiesV3();
  if (
    ids.writerPolicyHash !== writerPolicyHash ||
    ids.promptHash !== plan.promptHash ||
    ids.validatorHash !== plan.validatorHash
  )
    throw new Error('POLICY_MISMATCH: continuity writer identity');
  if (developed)
    await validatePlanV2({
      ...common,
      version: 'tarot-plan.v2',
      ...developed,
      diagnosticOnly: true,
      reader: { id: 'reader:question', text: plan.question },
      operation: 'initial',
      parentEditionId: null,
      selected: [],
    });
  else
    await validatePlanIntegrity({
      ...common,
      version: 'tarot-plan.v1',
      question: plan.question.trim(),
      fallbackClosing,
    });
  return plan;
}
