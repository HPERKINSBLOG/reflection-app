import {
  ModelCandidateV3,
  Position,
  type PreparedPlanV3,
  type WriterReceiptV3,
} from '../../contracts/index.ts';
import { canonicalJson } from '../json.ts';
import { validatePlanV3 } from './continuity.ts';
import { prepareWriterV3 } from './writer-v3.ts';
import { boundedCandidateJson, CandidateRejection, screenProse } from './safety.ts';
export const SAFETY_V3_VERSION = 'bounded-continuity-reading.v3';
const reject = (code: ConstructorParameters<typeof CandidateRejection>[0]): never => {
  throw new CandidateRejection(code);
};
/** Version-owned fork: normalization, quotation scope and supportedCurrentProse
 * intentionally retain the frozen v2 evidence rules. A mutable shared helper would
 * couple continuity changes to historical validation identities and receipts.
 * V3 alone permits exact quotations from explicitly cited user-authored excerpts;
 * generated/legacy-unknown excerpts never become user evidence. The common public
 * API corpus in tests/domain/safety-version-characterization.test.ts pins shared
 * behavior and the intended differences. Duplication carries maintenance cost;
 * changing these rules requires an explicit version/qualification decision. */
const normalize = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\bi'm\b/g, 'i am')
    .replace(/\bi've\b/g, 'i have')
    .replace(/\byou're\b/g, 'you are')
    .replace(/\byou've\b/g, 'you have')
    .replace(/\baren't\b/g, 'are not')
    .replace(/\bwasn't\b/g, 'was not')
    .replace(/\bweren't\b/g, 'were not');
const personal =
  /\b(?:you (?:are|were|have been|have always|had|suffer|suffered)|your (?:partner|family|parent|child|boss|friend) (?:is|was|has|caused))\b/g;
const escapePattern = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Quotation scope precedes sentence boundaries. A placeholder also prevents
 * removing an inline quotation from manufacturing a new declarative statement. */
function unquotedEvidence(text: string) {
  let result = '',
    closing: string | null = null;
  const word = (value: string) => /[\p{L}\p{N}]/u.test(value);
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!,
      apostrophe =
        (char === "'" || char === '’') && word(text[i - 1] ?? '') && word(text[i + 1] ?? '');
    if (closing) {
      if (char === '\\') i++;
      else if (char === closing && !apostrophe) closing = null;
    } else if (!apostrophe && ['"', '“', "'", '‘', '`'].includes(char)) {
      closing = char === '“' ? '”' : char === '‘' ? '’' : char;
      result += '"quoted material"';
    } else result += char;
  }
  return result;
}
/** Narrow, deterministic evidence match: entire declarative statements, never extracted keywords. */
function supportedCurrentProse(
  text: string,
  question: string,
  comparisonMethods = false,
  quoteSources = [question],
) {
  const quotations: Array<{ token: string; text: string }> = [];
  const protectedText = text.replace(
    /\bYou (?:wrote|said),?\s*[“"]([^”"]+)[”"]/gi,
    (whole, quote: string) => {
      if (!quoteSources.some((source) => source.includes(quote))) reject('BIOGRAPHY_UNSUPPORTED');
      let token = `attributedquotetoken${quotations.length}`;
      while (text.toLowerCase().includes(token)) token += 'x';
      quotations.push({ token, text: whole });
      return token;
    },
  );
  let result = normalize(protectedText);
  const sentences = [...normalize(unquotedEvidence(question)).matchAll(/([^.!?]+)([.!?]|$)/g)]
    .filter((m) => m[2] !== '?' && !/["“”]/.test(m[1]!))
    .map((m) => m[1]!.trim());
  // Split only explicitly asserted first-person coordination. A conditional or reported
  // sentence is never a pool of free-standing facts, even after an "and".
  const scoped =
    /\b(?:if|unless|when|whether|suppose|supposing|imagining|imagine|might|could|would|think|believe|wonder|says?|said|claims?|told|asked)\b|not sure/;
  const statements = sentences.flatMap((s) =>
    /^(?:i|my)\b/.test(s) && !scoped.test(s)
      ? [
          s,
          ...s
            .split(/(?:,\s*)?\band\s+(?=i (?:am|was|have been|have always|had|suffer|suffered)\b)/)
            .slice(1),
        ]
      : [s],
  );
  for (const source of statements) {
    if (
      !/^(?:i (?:am|was|have been|have always|had|suffer|suffered)|my (?:partner|family|parent|child|boss|friend) (?:is|was|has|caused))\b/.test(
        source,
      )
    )
      continue;
    const statement = source
      .replace(/\bi was\b/g, 'you were')
      .replace(/\bi am\b/g, 'you are')
      .replace(/\bi\b/g, 'you')
      .replace(/\bmy\b/g, 'your')
      .replace(/\bmyself\b/g, 'yourself');
    // A full matched statement retains its negation, temporal qualifiers and attribution.
    const pattern = new RegExp(
      `(^|[.!?;]\\s*|\\b(?:since|because|given that)\\s+)${escapePattern(statement)}(?=[.!?,;:]|$)`,
      'g',
    );
    result = result.replace(
      pattern,
      (_whole, prefix: string) =>
        prefix + statement.replace(personal, 'the supplied current statement describes'),
    );
  }
  // This possessive idiom refers back to an explicitly supplied imagined image;
  // it does not authorize other "you had" biography or invented past events.
  if (
    sentences.some((s) => /^i\b/.test(s) && !scoped.test(s) && /\bwhat i imagined(?=,|$)/.test(s))
  )
    result = result.replace(
      /\bthe image you had in mind\b/g,
      'the reader-described imagined image',
    );
  // Only the locally introduced hypothetical claim is exempt, not subsequent clauses.
  result = result.replace(
    /\b(if|whether)\s+(you (?:are|were|have been|had)|your (?:partner|family|parent|child|boss|friend) (?:is|was|has))\b/g,
    '$1 a possible circumstance involves',
  );
  // A direction to distinguish observations from assumptions is a method, not
  // invented biography. Exempt only that phrase; later personal assertions remain screened.
  if (comparisonMethods)
    result = result.replace(
      /\b((?:separate|distinguish) what you have observed\b[^.!?;]{0,160}? from )what you are assuming\b/g,
      '$1the assumptions to examine',
    );
  for (const quote of quotations) result = result.replace(quote.token, quote.text);
  return result;
}

export async function validateCandidateV3(
  value: PreparedPlanV3,
  candidate: unknown,
  receipt: WriterReceiptV3 | null,
  template = false,
): Promise<ModelCandidateV3> {
  const plan = await validatePlanV3(value),
    expected = await prepareWriterV3(plan);
  if (receipt ? canonicalJson(receipt) !== canonicalJson(expected.receipt) : !template)
    reject('CONTENT_CHANGED');
  boundedCandidateJson(candidate);
  const parsed = ModelCandidateV3.safeParse(candidate);
  if (!parsed.success) reject('SCHEMA');
  const output = parsed.data!,
    positions = new Set<string>();
  for (const unit of output.units) {
    const i = Position.options.indexOf(unit.position),
      card = plan.basis.cards[i]!;
    if (
      positions.has(unit.position) ||
      unit.sourceIds[0] !== plan.sources[i]!.id ||
      new Set(unit.factIds).size !== unit.factIds.length ||
      unit.factIds.filter((id) => id === card.id).length !== 1 ||
      unit.factIds.some((id) => id !== card.id && id !== `count:${card.cardId.split('-')[0]}`)
    )
      reject('POSITION_BINDING');
    positions.add(unit.position);
  }
  const parts = [
    ...output.units.map((u) => ({ ...u, text: u.interpretation })),
    output.synthesis,
    output.action,
    ...(output.reflectionQuestion ? [output.reflectionQuestion] : []),
  ];
  const sentences = new Set<string>();
  for (const part of parts) {
    if (
      new Set(part.sourceIds).size !== part.sourceIds.length ||
      part.sourceIds.some((id) => !plan.sources.some((s) => s.id === id))
    )
      reject('ENTITY_NOT_SUPPLIED');
    if (
      new Set(part.contextRefs).size !== part.contextRefs.length ||
      !part.contextRefs.includes('reader:question') ||
      part.contextRefs.some(
        (id) =>
          id !== 'reader:question' && !plan.selected.some((s) => id === `selection:${s.ordinal}`),
      )
    )
      reject('ENTITY_NOT_SUPPLIED');
    // Generated/unknown excerpts must never be attributed to the reader as authored evidence.
    screenProse(
      supportedCurrentProse(part.text, plan.question, true, [
        plan.question,
        ...plan.selected
          .filter(
            (f) =>
              f.authorship === 'user' &&
              part.contextRefs.some((id) => id === `selection:${f.ordinal}`),
          )
          .map((f) => f.text!),
      ]),
      {
        question: plan.question,
        selected: plan.selected.filter(
          (f) =>
            f.authorship === 'user' &&
            part.contextRefs.includes(`selection:${f.ordinal}` as 'selection:0'),
        ),
      },
    );
    for (const sentence of part.text.split(/[.!?]+/u)) {
      const key = sentence
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
      if (key && !template && sentences.has(key)) reject('REPETITION');
      if (key) sentences.add(key);
    }
  }
  const relationships = plan.canon.version === 2 ? plan.canon.relationships : [];
  if (
    new Set(output.synthesis.relationshipIds).size !== output.synthesis.relationshipIds.length ||
    output.synthesis.relationshipIds.some(
      (id) =>
        !relationships.some(
          (r) => r.id === id && r.sourceIds.every((s) => output.synthesis.sourceIds.includes(s)),
        ),
    )
  )
    reject('RELATIONSHIP_UNSUPPORTED');
  return output;
}
