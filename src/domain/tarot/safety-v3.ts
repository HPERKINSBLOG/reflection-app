import {
  ModelCandidateV3,
  type PreparedPlanV3,
  type WriterReceiptV3,
} from '../../contracts/index.ts';
import { canonicalJson } from '../json.ts';
import { validateUnitBindings } from './plan.ts';
import { boundedCandidateJson, CandidateRejection, screenProse } from './safety.ts';
import { composeTemplateV3, prepareWriterV3 } from './writer-v3.ts';

export async function validateCandidateV3(
  plan: PreparedPlanV3,
  value: unknown,
  receipt: WriterReceiptV3 | null,
  template = false,
): Promise<ModelCandidateV3> {
  boundedCandidateJson(value);
  const candidate = ModelCandidateV3.safeParse(value);
  if (!candidate.success) throw new CandidateRejection('SCHEMA');
  const expected = await prepareWriterV3(plan);
  if (
    receipt
      ? canonicalJson(expected.receipt) !== canonicalJson(receipt)
      : !template || canonicalJson(candidate.data) !== canonicalJson(await composeTemplateV3(plan))
  )
    throw new CandidateRejection('CONTENT_CHANGED');
  validateUnitBindings(plan, candidate.data.units);
  const sentences = new Set<string>();
  function check(text: string, refs: readonly string[]) {
    const selected = plan.selected.filter((f) => refs.includes(`selection:${f.ordinal}`));
    const question = refs.includes('reader:question') ? plan.question : '';
    const supplied = [question, ...selected.map((f) => f.text!)];
    for (const match of text.matchAll(/[“"]([^”"]+)[”"]/gu))
      if (!supplied.some((source) => source.includes(match[1]!)))
        throw new CandidateRejection('ENTITY_NOT_SUPPLIED');
    screenProse(text, { question, selected: selected.filter((f) => f.authorship === 'user') });
    for (const part of text.split(/[.!?]+/u)) {
      const sentence = part
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
      if (!sentence) continue;
      if (!template && sentences.has(sentence)) throw new CandidateRejection('REPETITION');
      sentences.add(sentence);
    }
  }
  for (const unit of candidate.data.units) {
    const refs = unit.contextRefs;
    if (
      new Set(refs).size !== refs.length ||
      refs.some(
        (ref) =>
          ref !== 'reader:question' && !plan.selected.some((f) => ref === `selection:${f.ordinal}`),
      )
    )
      throw new CandidateRejection('ENTITY_NOT_SUPPLIED');
    check(unit.interpretation, refs);
    check(unit.reflectionQuestion, refs);
  }
  if (candidate.data.closing) check(candidate.data.closing, ['reader:question']);
  return candidate.data;
}
