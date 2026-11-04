import type { z } from 'zod';
import {
  type AnyPreparedPlan,
  ModelCandidate,
  type AnyWriterReceipt,
} from '../../contracts/index.ts';
import {
  READING_PROVIDER_POLICY,
  READING_V2_EVALUATION_POLICY,
  READING_V3_SYNTHETIC_POLICY,
  type ReadingProviderPolicy,
  type ReadingV2WriterPolicy,
  type ReadingV3WriterPolicy,
} from '../../contracts/provider-policy.ts';
import { buildPlan, validatePlanIntegrity } from '../../domain/tarot/plan.ts';
import {
  buildPlanV3,
  validatePlanV3,
  type BuildPlanV3Input,
} from '../../domain/tarot/continuity.ts';
import { composeTemplateV3, prepareWriterV3 } from '../../domain/tarot/writer-v3.ts';
import { validateCandidateV3 } from '../../domain/tarot/safety-v3.ts';
import { buildPlanV2, validatePlanV2 } from '../../domain/tarot/context-v2.ts';
import { composeTemplate, projectWriterPayload } from '../../domain/tarot/render.ts';
import {
  composeTemplateV2,
  prepareWriterV2,
  writerIdentitiesV2,
} from '../../domain/tarot/writer-v2.ts';
import { validateCandidate } from '../../domain/tarot/safety.ts';
import { validateCandidateV2 } from '../../domain/tarot/safety-v2.ts';

export type VersionedPlan = z.infer<typeof AnyPreparedPlan>;
type Policy = ReadingV2WriterPolicy | ReadingProviderPolicy | ReadingV3WriterPolicy;
export function planPolicy(plan: VersionedPlan) {
  if (plan.version === 'tarot-plan.v3') return READING_V3_SYNTHETIC_POLICY;
  return plan.version === 'tarot-plan.v2' ? READING_V2_EVALUATION_POLICY : READING_PROVIDER_POLICY;
}
export async function buildWriterPlan(
  input: BuildPlanV3Input,
  policy?: Policy,
  diagnosticOnly = true,
) {
  if (input.operation === 'followup' || input.selected.length) {
    if (!diagnosticOnly || (policy && policy.schemaVersion !== 'tarot.interpretation.v3'))
      throw new Error('POLICY_MISMATCH: continuity is synthetic only');
    return buildPlanV3(input);
  }
  policy ??= READING_V2_EVALUATION_POLICY;
  if (policy.schemaVersion === 'tarot.interpretation.v3') throw new Error('POLICY_MISMATCH');
  if (input.content.schemaVersion === 1) return buildPlan({ ...input, content: input.content });
  if (policy.schemaVersion !== 'tarot.interpretation.v2') throw new Error('POLICY_MISMATCH');
  const identities = await writerIdentitiesV2(policy);
  return buildPlanV2(
    {
      ...input,
      content: input.content,
      promptHash: identities.promptHash,
      validatorHash: identities.validatorHash,
    },
    diagnosticOnly,
  );
}
export function validateWriterPlan(plan: VersionedPlan) {
  if (plan.version === 'tarot-plan.v3') return validatePlanV3(plan);
  return plan.version === 'tarot-plan.v2' ? validatePlanV2(plan) : validatePlanIntegrity(plan);
}
export async function prepareWriter(
  plan: VersionedPlan,
  policy: Policy = planPolicy(plan),
): Promise<{ payload: Uint8Array; receipt: AnyWriterReceipt | null }> {
  if (plan.version === 'tarot-plan.v3') {
    if (policy.schemaVersion !== 'tarot.interpretation.v3') throw new Error('POLICY_MISMATCH');
    return prepareWriterV3(plan, policy);
  }
  if (policy.schemaVersion === 'tarot.interpretation.v3') throw new Error('POLICY_MISMATCH');
  if (plan.version === 'tarot-plan.v2' && policy.schemaVersion !== 'tarot.interpretation.v2')
    throw new Error('POLICY_MISMATCH');
  return plan.version === 'tarot-plan.v2' && policy.schemaVersion === 'tarot.interpretation.v2'
    ? prepareWriterV2(plan, policy)
    : {
        payload: await projectWriterPayload(
          plan as Extract<VersionedPlan, { version: 'tarot-plan.v1' }>,
          policy,
        ),
        receipt: null,
      };
}
export async function preparedTemplate(plan: VersionedPlan) {
  if (plan.version === 'tarot-plan.v3') return composeTemplateV3(plan);
  if (plan.version === 'tarot-plan.v2') return composeTemplateV2(plan);
  const body = await composeTemplate(plan);
  return ModelCandidate.parse({
    schemaVersion: 1,
    kind: 'tarot.interpretation.v1',
    units: body.units.map(({ basisText: _text, ...unit }) => unit),
    closing: body.closing,
  });
}
export async function checkWriterCandidate(
  plan: VersionedPlan,
  candidate: unknown,
  receipt: AnyWriterReceipt | null,
  template = false,
) {
  if (plan.version === 'tarot-plan.v3') {
    if (receipt && receipt.version !== 'writer-packet.v3') throw new Error('CONTENT_CHANGED');
    return validateCandidateV3(plan, candidate, receipt, template);
  }
  if (receipt?.version === 'writer-packet.v3') throw new Error('CONTENT_CHANGED');
  return plan.version === 'tarot-plan.v2'
    ? validateCandidateV2(plan, candidate, receipt, template)
    : validateCandidate(plan, candidate, template);
}
