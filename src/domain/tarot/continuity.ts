import type { z } from 'zod';
import {
  AnyContentBundle,
  PreparedPlanV3,
  type ContinuityParent,
  TarotFactId,
} from '../../contracts/index.ts';
import { assertContextBounds, codePointLength } from '../../contracts/context-policy.ts';
import { canonicalJson, sha256Json } from '../json.ts';
import { assertBasis } from './facts.ts';
import { buildPlan, sourceHash, type BuildPlanInput } from './plan.ts';
import { buildPlanV2, eligibleReview, eligibleRelationship } from './context-v2.ts';

export type BuildPlanV3Input = Omit<BuildPlanInput, 'content'> & {
  content: z.infer<typeof AnyContentBundle>;
  /** Resolved owned parent identity only; never its old question or interpretation. */
  parent?: z.infer<typeof ContinuityParent> | null | undefined;
  diagnosticOnly?: boolean;
};
const unavailable = (detail: string): never => {
  throw new Error(`CONTENT_UNAVAILABLE: ${detail}`);
};
const sourceIdentities = (sources: PreparedPlanV3['sources']) =>
  sources.map(({ id, version, hash }) => ({ id, version, hash }));
export async function continuityContextHash(
  plan: Omit<PreparedPlanV3, 'contextHash'> | PreparedPlanV3,
) {
  const { contextHash: _hash, ...body } = plan as PreparedPlanV3;
  return sha256Json(body);
}
export async function buildPlanV3(input: BuildPlanV3Input): Promise<PreparedPlanV3> {
  const { content: raw, parent = null, diagnosticOnly = true, ...metadata } = input;
  const content = AnyContentBundle.parse(raw);
  // Reuse native validation, never upgrade v1 sources by inventing v2 meaning packages.
  const nativeInput = {
    ...metadata,
    operation: 'initial' as const,
    parentEditionId: null,
    selected: [],
  };
  const native =
    content.schemaVersion === 1
      ? await buildPlan({ ...nativeInput, content })
      : await buildPlanV2({ ...nativeInput, content }, diagnosticOnly);
  const canon: PreparedPlanV3['canon'] =
    native.version === 'tarot-plan.v1'
      ? {
          version: 1,
          sources: native.sources,
          fallbackClosing:
            input.operation === 'followup'
              ? content.productCopy.followupClosing
              : content.productCopy.initialClosing,
        }
      : {
          version: 2,
          sources: native.sources,
          spreadVersion: native.spread.version,
          relationships: native.relationships,
          fallback: native.fallbackV2,
        };
  const plan = {
    ...metadata,
    version: 'tarot-plan.v3' as const,
    contentHash: native.contentHash,
    sources: native.sources,
    canon,
    parent,
    diagnosticOnly,
    mandatoryFactIds: [...TarotFactId.options],
    draw: native.basis.cards.map((c) => ({
      cardId: c.cardId,
      name: content.deck.find((d) => d.id === c.cardId)!.name,
      orientation: c.orientation,
      position: c.position,
      factId: TarotFactId.parse(c.id),
      deckEdition: native.basis.deckEdition,
    })),
    positionFrames: native.basis.cards.map(
      (card) => content.positionFrames.find((frame) => frame.position === card.position)!,
    ),
  };
  return validatePlanV3({ ...plan, contextHash: await continuityContextHash(plan) });
}
export async function validatePlanV3(value: unknown): Promise<PreparedPlanV3> {
  const parsed = PreparedPlanV3.safeParse(value);
  if (!parsed.success) throw new Error('BAD_INPUT: v3 prepared plan');
  const plan = parsed.data;
  assertBasis(plan.basis);
  assertContextBounds(plan.selected);
  if (!plan.question.trim() || plan.contextHash !== (await continuityContextHash(plan)))
    unavailable('v3 snapshot identity');
  if (
    (plan.operation === 'followup') !== !!plan.parent ||
    plan.parentEditionId !== (plan.parent?.editionId ?? null)
  )
    unavailable('parent identity');
  if (
    plan.parent &&
    (canonicalJson(plan.parent.basis) !== canonicalJson(plan.basis) ||
      plan.parent.contentHash !== plan.contentHash ||
      canonicalJson(plan.parent.sources) !== canonicalJson(sourceIdentities(plan.sources)))
  )
    unavailable('parent evidence changed');
  if (
    canonicalJson(plan.sources) !== canonicalJson(plan.canon.sources) ||
    new Set(plan.sources.map((s) => s.id)).size !== 3 ||
    plan.mandatoryFactIds.some((id, i) => id !== TarotFactId.options[i])
  )
    unavailable('v3 sources');
  for (const [i, card] of plan.basis.cards.entries()) {
    const source = plan.sources[i]!,
      draw = plan.draw[i]!,
      frame = plan.positionFrames[i]!;
    if (
      !eligibleReview(source, plan.canon.version === 2 && plan.diagnosticOnly) ||
      source.hash !== (await sourceHash(source)) ||
      source.cardId !== card.cardId ||
      source.orientation !== card.orientation ||
      (source.position !== null && source.position !== card.position) ||
      draw.cardId !== card.cardId ||
      draw.position !== card.position ||
      draw.factId !== card.id ||
      draw.orientation !== card.orientation ||
      draw.deckEdition !== plan.basis.deckEdition ||
      !draw.name.trim() ||
      frame.position !== card.position ||
      !frame.text.trim()
    )
      unavailable('v3 selected binding');
  }
  if (plan.canon.version === 2) {
    const canon = plan.canon;
    if (new Set(canon.relationships.map((r) => r.id)).size !== canon.relationships.length)
      unavailable('duplicate relationship');
    for (const r of canon.relationships)
      if (
        r.hash !== (await sourceHash(r)) ||
        !eligibleRelationship(r, {
          basis: plan.basis,
          sources: canon.sources,
          diagnosticOnly: plan.diagnosticOnly,
        })
      )
        unavailable('v3 relationship');
  }
  for (const [i, fragment] of plan.selected.entries()) {
    if (
      fragment.ordinal !== i ||
      fragment.availability !== 'retained' ||
      fragment.text === null ||
      fragment.textHash === null ||
      fragment.end - fragment.start !== codePointLength(fragment.text)
    )
      throw new Error('CONTEXT_CHANGED: selected fragment');
  }
  return plan;
}
/** This projection is shared by the owned picker and C2 resolution; no question/provenance. */
export function editionContextText(value: {
  kind: string;
  units?: Array<{ interpretation: string; reflectionQuestion?: string }>;
  closing?: string;
  synthesis?: { text: string };
  action?: { text: string };
  reflectionQuestion?: { text: string } | null;
  record?: { generatedText?: string | null };
}): string {
  if (value.kind === 'legacy.imported.v1') return value.record?.generatedText ?? '';
  if (value.kind === 'tarot.accepted.v1')
    return [
      ...(value.units ?? []).flatMap((u) => [u.interpretation, u.reflectionQuestion ?? '']),
      value.closing ?? '',
    ].join('\n\n');
  if (value.kind === 'tarot.accepted.v2' || value.kind === 'tarot.accepted.v3')
    return [
      ...(value.units ?? []).map((u) => u.interpretation),
      value.synthesis!.text,
      value.action!.text,
      ...(value.reflectionQuestion ? [value.reflectionQuestion.text] : []),
    ].join('\n\n');
  throw new Error('CONTENT_UNAVAILABLE');
}
