import { expect, test } from 'vitest';
import type { ModelCandidateV2, ModelCandidateV3 } from '../../src/contracts/index.ts';
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
import {
  composeTemplateV3,
  prepareWriterV3,
  writerIdentitiesV3,
} from '../../src/domain/tarot/writer-v3.ts';
import { v2Input } from '../fixtures/canon-v2.ts';

const versions = ['v2.2 archived', 'v2.3 comparison methods', 'v3 continuity'] as const;
type Version = (typeof versions)[number];
type Authorship = 'user' | 'generated' | 'legacy_unknown';
// Each row is an independently specified behavioral boundary, not a comparison of
// the implementations to each other. Both returning the same wrong result fails.
const sharedCases = [
  {
    name: 'exact direct statement',
    question: 'I am content with my routine.',
    prose: 'You are content with your routine.',
    accepted: true,
  },
  {
    name: 'unsupported biography',
    question: 'What could I consider?',
    prose: 'You are content with your routine.',
    accepted: false,
  },
  {
    name: 'curly contraction and case normalization',
    question: 'I’m comfortable with my workload.',
    prose: 'YOU’RE comfortable with your workload.',
    accepted: true,
  },
  {
    name: 'NFKC compatibility letters',
    question: 'Ｉ ａｍ ｃｏｎｔｅｎｔ.',
    prose: 'You are content.',
    accepted: true,
  },
  {
    name: 'negation retained',
    question: 'I am not discouraged.',
    prose: 'You are not discouraged.',
    accepted: true,
  },
  {
    name: 'negation removed',
    question: 'I am not discouraged.',
    prose: 'You are discouraged.',
    accepted: false,
  },
  {
    name: 'past tense and time retained',
    question: 'I was uncertain last month.',
    prose: 'You were uncertain last month.',
    accepted: true,
  },
  {
    name: 'past promoted to present',
    question: 'I was uncertain last month.',
    prose: 'You are uncertain.',
    accepted: false,
  },
  {
    name: 'named relation within scope',
    question: 'My friend is supportive.',
    prose: 'Your friend is supportive.',
    accepted: true,
  },
  {
    name: 'relation swapped',
    question: 'My friend is supportive.',
    prose: 'Your partner is supportive.',
    accepted: false,
  },
  {
    name: 'explicit coordinated assertion',
    question: 'My group is welcoming, and I am not discouraged.',
    prose: 'Since you are not discouraged, a small experiment may be useful.',
    accepted: true,
  },
  {
    name: 'coordinated assertion keeps full qualifier',
    question: 'My group is welcoming, and I am not discouraged about writing, only about work.',
    prose: 'You are not discouraged.',
    accepted: false,
  },
  {
    name: 'conditional source is not asserted',
    question: 'If I am ready, I could try again.',
    prose: 'You are ready.',
    accepted: false,
  },
  {
    name: 'reported coordination is not asserted',
    question: 'My friend says I am ready and I am confident.',
    prose: 'You are confident.',
    accepted: false,
  },
  {
    name: 'uncertain source is not asserted',
    question: 'I am not sure whether I am ready.',
    prose: 'You are ready.',
    accepted: false,
  },
  {
    name: 'question is not asserted',
    question: 'Am I ready?',
    prose: 'You are ready.',
    accepted: false,
  },
  {
    name: 'local hypothetical in output',
    question: 'What could I consider?',
    prose: 'If you are considering an adjustment, compare it with the current approach.',
    accepted: true,
  },
  {
    name: 'hypothesis does not excuse later claim',
    question: 'What could I consider?',
    prose:
      'If you are considering an adjustment, compare it with the current approach. You are overwhelmed.',
    accepted: false,
  },
  {
    name: 'exact attributed current quotation',
    question: 'I am not discouraged.',
    prose: 'You said, “I am not discouraged.”',
    accepted: true,
  },
  {
    name: 'attributed quotation cannot change negation',
    question: 'I am not discouraged.',
    prose: 'You said, “I am discouraged.”',
    accepted: false,
  },
  {
    name: 'quotation is exact despite normalized statement matching',
    question: 'I’m content.',
    prose: 'You wrote, “I am content.”',
    accepted: false,
  },
  {
    name: 'apostrophe is not a quotation delimiter',
    question: "I'm comfortable with my workload. My friend said, 'I am discouraged.'",
    prose: 'You are comfortable with your workload.',
    accepted: true,
  },
  {
    name: 'quoted multi-sentence material remains quoted',
    question: 'My friend said, “I am happy. I am discouraged. I am ready.”',
    prose: 'You are discouraged.',
    accepted: false,
  },
  {
    name: 'unclosed quotation does not expose later sentences',
    question: 'My friend wrote, "I am happy.\nI am discouraged. I am ready.',
    prose: 'You are discouraged.',
    accepted: false,
  },
  {
    name: 'inline quotation does not manufacture an assertion',
    question: 'I am "not" discouraged.',
    prose: 'You are discouraged.',
    accepted: false,
  },
  {
    name: 'assertion before quoted sentences remains available',
    question: 'I am comfortable with my workload. My friend said, "I am discouraged. I am ready."',
    prose: 'You are comfortable with your workload.',
    accepted: true,
  },
  {
    name: 'supplied imagined-image idiom',
    question:
      'I feel discouraged after my sketches did not match what I imagined, but a drawing session with a friend helped.',
    prose: 'The image you had in mind can offer direction without promising a match.',
    accepted: true,
  },
  {
    name: 'hypothetical image is not reader history',
    question: 'If my sketches did not match what I imagined, I would ask for help.',
    prose: 'The image you had in mind can guide another attempt.',
    accepted: false,
  },
] as const;

function fillNeutralProse(candidate: ModelCandidateV2 | ModelCandidateV3, prose: string) {
  candidate.units.forEach((unit, index) => {
    unit.interpretation = [
      'Compare what each option asks of the work.',
      'A provisional preference can remain open to revision.',
      'Consider which available perspective supports the goal.',
    ][index]!;
  });
  candidate.synthesis.text =
    'Use the supported ideas as a baseline for examining the alternatives.';
  candidate.action.text = prose;
  candidate.reflectionQuestion = null;
}
async function fixture(
  version: Version,
  question: string,
  excerpt?: { authorship: Authorship; cite: boolean },
) {
  const input = await v2Input();
  input.question = question;
  if (version === 'v3 continuity') {
    const text = 'I am content with my routine.';
    const plan = await buildPlanV3({
      ...input,
      ...(await writerIdentitiesV3()),
      selected: excerpt
        ? [
            {
              ordinal: 0,
              grantId: crypto.randomUUID(),
              grantRevision: 1,
              sourceKind: 'revisit_revision',
              sourceId: crypto.randomUUID(),
              sourceRevision: 1,
              start: 0,
              end: [...text].length,
              text,
              textHash: 'e'.repeat(64),
              availability: 'retained',
              authorship: excerpt.authorship,
            },
          ]
        : [],
    });
    const candidate = await composeTemplateV3(plan),
      { receipt } = await prepareWriterV3(plan);
    if (excerpt?.cite) candidate.action.contextRefs.push('selection:0');
    return { candidate, validate: () => validateCandidateV3(plan, candidate, receipt) };
  }
  const policy =
    version === 'v2.2 archived' ? READING_V2_EVALUATION_POLICY : LOCAL_LIVE_READING_POLICY;
  const plan = await buildPlanV2({ ...input, ...(await writerIdentitiesV2(policy)) });
  const candidate = await composeTemplateV2(plan),
    { receipt } = await prepareWriterV2(plan, policy);
  return { candidate, validate: () => validateCandidateV2(plan, candidate, receipt) };
}

for (const version of versions) {
  test.each(sharedCases)(`${version}: $name`, async ({ question, prose, accepted }) => {
    const f = await fixture(version, question);
    fillNeutralProse(f.candidate, prose);
    if (accepted) await expect(f.validate()).resolves.toEqual(f.candidate);
    else await expect(f.validate()).rejects.toMatchObject({ code: 'BIOGRAPHY_UNSUPPORTED' });
  });

  test.each([
    {
      authorship: 'user',
      cite: true,
      prose: 'You wrote, “I am content with my routine.”',
      continuityAccepts: true,
    },
    {
      authorship: 'user',
      cite: false,
      prose: 'You wrote, “I am content with my routine.”',
      continuityAccepts: false,
    },
    {
      authorship: 'generated',
      cite: true,
      prose: 'You wrote, “I am content with my routine.”',
      continuityAccepts: false,
    },
    {
      authorship: 'legacy_unknown',
      cite: true,
      prose: 'You wrote, “I am content with my routine.”',
      continuityAccepts: false,
    },
    {
      authorship: 'user',
      cite: true,
      prose: 'You wrote, “I am unhappy with my routine.”',
      continuityAccepts: false,
    },
    {
      authorship: 'user',
      cite: true,
      prose: 'You are content with your routine.',
      continuityAccepts: false,
    },
  ] as const)(
    `${version}: excerpt authorship=$authorship cite=$cite prose=$prose`,
    async ({ authorship, cite, prose, continuityAccepts }) => {
      // V2 has no selected-evidence channel. Do not inject an invalid v2 plan merely
      // to get a schema rejection: exercise its real current-question-only boundary.
      const f = await fixture(version, 'What could I consider?', { authorship, cite });
      fillNeutralProse(f.candidate, prose);
      if (version === 'v3 continuity' && continuityAccepts)
        await expect(f.validate()).resolves.toEqual(f.candidate);
      else await expect(f.validate()).rejects.toMatchObject({ code: 'BIOGRAPHY_UNSUPPORTED' });
    },
  );

  test(`${version}: existing comparison-method identity difference stays explicit`, async () => {
    const f = await fixture(version, 'What could I consider?');
    fillNeutralProse(f.candidate, 'Separate what you have observed from what you are assuming.');
    if (version === 'v2.2 archived')
      await expect(f.validate()).rejects.toMatchObject({ code: 'BIOGRAPHY_UNSUPPORTED' });
    else await expect(f.validate()).resolves.toEqual(f.candidate);
    f.candidate.action.text += ' You are overwhelmed.';
    await expect(f.validate()).rejects.toMatchObject({ code: 'BIOGRAPHY_UNSUPPORTED' });
  });
}
