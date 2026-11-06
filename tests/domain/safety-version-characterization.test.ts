import { expect, test } from 'vitest';
import {
  LOCAL_LIVE_READING_POLICY,
  READING_V2_EVALUATION_POLICY,
} from '../../src/contracts/provider-policy.ts';
import { buildPlanV2 } from '../../src/domain/tarot/context-v2.ts';
import { buildPlanV3 } from '../../src/domain/tarot/continuity.ts';
import { validateCandidateV2 } from '../../src/domain/tarot/safety-v2.ts';
import { validateCandidateV3 } from '../../src/domain/tarot/safety-v3.ts';
import {
  composeTemplateV2,
  prepareWriterV2,
  writerIdentitiesV2,
} from '../../src/domain/tarot/writer-v2.ts';
import { composeTemplateV3, prepareWriterV3 } from '../../src/domain/tarot/writer-v3.ts';
import { v2Input } from '../fixtures/canon-v2.ts';

// Recovered behavioral boundaries from the older M3 branch. Expected outcomes
// are specified independently, not by comparing one validator with another.
const cases = [
  ['direct statement', 'I am content with my routine.', 'You are content with your routine.', true],
  ['unsupported biography', 'What could I consider?', 'You are content with your routine.', false],
  [
    'contraction',
    'I’m comfortable with my workload.',
    'YOU’RE comfortable with your workload.',
    true,
  ],
  ['NFKC', 'Ｉ ａｍ ｃｏｎｔｅｎｔ.', 'You are content.', true],
  ['negation retained', 'I am not discouraged.', 'You are not discouraged.', true],
  ['negation removed', 'I am not discouraged.', 'You are discouraged.', false],
  ['past retained', 'I was uncertain last month.', 'You were uncertain last month.', true],
  ['past promoted', 'I was uncertain last month.', 'You are uncertain.', false],
  ['relation retained', 'My friend is supportive.', 'Your friend is supportive.', true],
  ['relation swapped', 'My friend is supportive.', 'Your partner is supportive.', false],
  [
    'coordination',
    'My group is welcoming, and I am not discouraged.',
    'Since you are not discouraged, a small experiment may be useful.',
    true,
  ],
  [
    'qualifier removed',
    'My group is welcoming, and I am not discouraged about writing, only about work.',
    'You are not discouraged.',
    false,
  ],
  ['conditional source', 'If I am ready, I could try again.', 'You are ready.', false],
  ['reported source', 'My friend says I am ready and I am confident.', 'You are confident.', false],
  ['uncertain source', 'I am not sure whether I am ready.', 'You are ready.', false],
  ['question', 'Am I ready?', 'You are ready.', false],
  [
    'hypothetical output',
    'What could I consider?',
    'If you are considering an adjustment, compare it with the current approach.',
    true,
  ],
  [
    'later assertion',
    'What could I consider?',
    'If you are considering an adjustment, compare it with the current approach. You are overwhelmed.',
    false,
  ],
  ['exact quote', 'I am not discouraged.', 'You said, “I am not discouraged.”', true],
  ['changed quote', 'I am not discouraged.', 'You said, “I am discouraged.”', false],
  ['normalized quote', 'I’m content.', 'You wrote, “I am content.”', false],
  [
    'apostrophe',
    "I'm comfortable with my workload. My friend said, 'I am discouraged.'",
    'You are comfortable with your workload.',
    true,
  ],
  [
    'quoted sentences',
    'My friend said, “I am happy. I am discouraged. I am ready.”',
    'You are discouraged.',
    false,
  ],
  [
    'unclosed quotation',
    'My friend wrote, "I am happy.\nI am discouraged. I am ready.',
    'You are discouraged.',
    false,
  ],
  ['inline quotation', 'I am "not" discouraged.', 'You are discouraged.', false],
  [
    'assertion before quotation',
    'I am comfortable with my workload. My friend said, "I am discouraged. I am ready."',
    'You are comfortable with your workload.',
    true,
  ],
  [
    'imagined image',
    'I feel discouraged after my sketches did not match what I imagined, but a drawing session with a friend helped.',
    'The image you had in mind can offer direction without promising a match.',
    true,
  ],
  [
    'hypothetical image',
    'If my sketches did not match what I imagined, I would ask for help.',
    'The image you had in mind can guide another attempt.',
    false,
  ],
] as const;

const neutral = [
  'Compare what each option asks of the work.',
  'A provisional preference can remain open to revision.',
  'Consider which available perspective supports the goal.',
];
function neutralV2(candidate: Awaited<ReturnType<typeof composeTemplateV2>>) {
  candidate.units.forEach((unit, i) => {
    unit.interpretation = neutral[i]!;
  });
  candidate.synthesis.text =
    'Use the supported ideas as a baseline for examining the alternatives.';
  candidate.reflectionQuestion = null;
  return candidate;
}

for (const [name, policy] of [
  ['v2.2 archived', READING_V2_EVALUATION_POLICY],
  ['v2.3 comparison methods', LOCAL_LIVE_READING_POLICY],
] as const) {
  test.each(cases)(`${name}: %s`, async (_name, question, prose, accepted) => {
    const plan = await buildPlanV2({
      ...(await v2Input()),
      ...(await writerIdentitiesV2(policy)),
      question,
    });
    const candidate = neutralV2(await composeTemplateV2(plan));
    const { receipt } = await prepareWriterV2(plan, policy);
    candidate.action.text = prose;
    if (accepted)
      await expect(validateCandidateV2(plan, candidate, receipt)).resolves.toEqual(candidate);
    else
      await expect(validateCandidateV2(plan, candidate, receipt)).rejects.toMatchObject({
        code: 'BIOGRAPHY_UNSUPPORTED',
      });
  });
  test(`${name}: comparison-method identity stays explicit`, async () => {
    const plan = await buildPlanV2({
      ...(await v2Input()),
      ...(await writerIdentitiesV2(policy)),
      question: 'What could I consider?',
    });
    const candidate = neutralV2(await composeTemplateV2(plan));
    const { receipt } = await prepareWriterV2(plan, policy);
    candidate.action.text = 'Separate what you have observed from what you are assuming.';
    if (name === 'v2.2 archived')
      await expect(validateCandidateV2(plan, candidate, receipt)).rejects.toMatchObject({
        code: 'BIOGRAPHY_UNSUPPORTED',
      });
    else await expect(validateCandidateV2(plan, candidate, receipt)).resolves.toEqual(candidate);
    candidate.action.text += ' You are overwhelmed.';
    await expect(validateCandidateV2(plan, candidate, receipt)).rejects.toMatchObject({
      code: 'BIOGRAPHY_UNSUPPORTED',
    });
  });
}

// The current v3 contract differs from the retired branch: it deliberately keeps
// the conservative prose screen. Do not import its incompatible schema or loosen
// that policy while recovering its quotation/authorship regression coverage.
test.each([
  ['user', true, 'You wrote, “I am content with my routine.”', null],
  ['user', false, 'You wrote, “I am content with my routine.”', 'ENTITY_NOT_SUPPLIED'],
  ['generated', true, 'You wrote, “I am content with my routine.”', 'BIOGRAPHY_UNSUPPORTED'],
  ['legacy_unknown', true, 'You wrote, “I am content with my routine.”', 'BIOGRAPHY_UNSUPPORTED'],
  ['user', true, 'You wrote, “I am unhappy with my routine.”', 'ENTITY_NOT_SUPPLIED'],
  ['user', true, 'You are content with your routine.', 'BIOGRAPHY_UNSUPPORTED'],
] as const)('v3 cited authorship %s/%s: %s', async (authorship, cite, prose, code) => {
  const text = 'I am content with my routine.';
  const plan = await buildPlanV3({
    ...(await v2Input()),
    question: 'What could I consider?',
    selected: [
      {
        ordinal: 0,
        grantId: crypto.randomUUID(),
        grantRevision: 1,
        sourceKind: 'revisit_revision',
        sourceId: crypto.randomUUID(),
        sourceRevision: 1,
        start: 0,
        end: text.length,
        text,
        textHash: 'e'.repeat(64),
        availability: 'retained',
        authorship,
      },
    ],
  });
  const candidate = await composeTemplateV3(plan);
  candidate.units.forEach((unit, i) => {
    unit.interpretation = neutral[i]!;
    unit.reflectionQuestion = [
      'Which detail is useful?',
      'What deserves another look?',
      'Which option fits?',
    ][i]!;
  });
  candidate.closing = 'Keep only what fits.';
  candidate.units[0]!.interpretation = prose;
  if (cite) candidate.units[0]!.contextRefs.push('selection:0');
  const { receipt } = await prepareWriterV3(plan);
  if (code)
    await expect(validateCandidateV3(plan, candidate, receipt)).rejects.toMatchObject({ code });
  else await expect(validateCandidateV3(plan, candidate, receipt)).resolves.toEqual(candidate);
});
