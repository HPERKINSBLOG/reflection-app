import type { z } from 'zod';
import {
  type AnyPreparedPlan,
  ModelCandidate,
  type AnyContentBundle,
  type WriterReceiptV2,
  type WriterReceiptV3,
} from '../../contracts/index.ts';
import {
  READING_PROVIDER_POLICY,
  READING_V2_EVALUATION_POLICY,
  READING_CONTINUITY_POLICY,
  type ReadingProviderPolicy,
  type ReadingV2WriterPolicy,
  type ReadingV3WriterPolicy,
} from '../../contracts/provider-policy.ts';
import { buildPlan, type BuildPlanInput, validatePlanIntegrity } from '../../domain/tarot/plan.ts';
import { buildPlanV2, validatePlanV2 } from '../../domain/tarot/context-v2.ts';
import {
  buildPlanV3,
  validatePlanV3,
  type BuildPlanV3Input,
} from '../../domain/tarot/continuity.ts';
import { composeTemplate, projectWriterPayload } from '../../domain/tarot/render.ts';
import {
  composeTemplateV2,
  prepareWriterV2,
  writerIdentitiesV2,
} from '../../domain/tarot/writer-v2.ts';
import {
  composeTemplateV3,
  prepareWriterV3,
  writerIdentitiesV3,
} from '../../domain/tarot/writer-v3.ts';
import { validateCandidate } from '../../domain/tarot/safety.ts';
import { validateCandidateV2 } from '../../domain/tarot/safety-v2.ts';
import { validateCandidateV3 } from '../../domain/tarot/safety-v3.ts';
export type VersionedPlan = z.infer<typeof AnyPreparedPlan>;
export type VersionedWriterPolicy =
  | ReadingV2WriterPolicy
  | ReadingProviderPolicy
  | ReadingV3WriterPolicy;
export type VersionedWriterReceipt = WriterReceiptV2 | WriterReceiptV3;
export function planPolicy(plan: VersionedPlan) {
  return plan.version === 'tarot-plan.v3'
    ? READING_CONTINUITY_POLICY
    : plan.version === 'tarot-plan.v2'
      ? READING_V2_EVALUATION_POLICY
      : READING_PROVIDER_POLICY;
}
export async function buildWriterPlan(
  input: Omit<BuildPlanInput, 'content'> & {
    content: z.infer<typeof AnyContentBundle>;
    parent?: BuildPlanV3Input['parent'];
  },
  policy?: VersionedWriterPolicy,
  diagnosticOnly = true,
) {
  if (input.operation === 'followup' || input.selected.length) {
    const continuityPolicy = policy ?? READING_CONTINUITY_POLICY;
    if (continuityPolicy.schemaVersion !== 'tarot.interpretation.v3')
      throw new Error('POLICY_MISMATCH');
    return buildPlanV3({
      ...input,
      ...(await writerIdentitiesV3(continuityPolicy)),
      diagnosticOnly,
    });
  }
  const initialPolicy =
    policy ??
    (input.content.schemaVersion === 1 ? READING_PROVIDER_POLICY : READING_V2_EVALUATION_POLICY);
  if (input.content.schemaVersion === 1) {
    if (initialPolicy.schemaVersion !== 'tarot.interpretation.v1')
      throw new Error('POLICY_MISMATCH');
    return buildPlan({ ...input, content: input.content });
  }
  if (initialPolicy.schemaVersion !== 'tarot.interpretation.v2') throw new Error('POLICY_MISMATCH');
  const identities = await writerIdentitiesV2(initialPolicy);
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
  return plan.version === 'tarot-plan.v3'
    ? validatePlanV3(plan)
    : plan.version === 'tarot-plan.v2'
      ? validatePlanV2(plan)
      : validatePlanIntegrity(plan);
}
export async function prepareWriter(
  plan: VersionedPlan,
  policy: VersionedWriterPolicy = planPolicy(plan),
): Promise<{ payload: Uint8Array; receipt: VersionedWriterReceipt | null }> {
  if (plan.version === 'tarot-plan.v3') {
    if (policy.schemaVersion !== 'tarot.interpretation.v3') throw new Error('POLICY_MISMATCH');
    return prepareWriterV3(plan, policy);
  }
  if (plan.version === 'tarot-plan.v2') {
    if (policy.schemaVersion !== 'tarot.interpretation.v2') throw new Error('POLICY_MISMATCH');
    return prepareWriterV2(plan, policy);
  }
  if (policy.schemaVersion !== 'tarot.interpretation.v1') throw new Error('POLICY_MISMATCH');
  return { payload: await projectWriterPayload(plan, policy), receipt: null };
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
  receipt: VersionedWriterReceipt | null,
  template = false,
) {
  if (plan.version === 'tarot-plan.v3')
    return validateCandidateV3(plan, candidate, receipt as WriterReceiptV3 | null, template);
  if (plan.version === 'tarot-plan.v2')
    return validateCandidateV2(plan, candidate, receipt as WriterReceiptV2 | null, template);
  return validateCandidate(plan, candidate, template);
}
