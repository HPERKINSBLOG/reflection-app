import { canonicalJson, sha256Json } from '../src/domain/json.ts';
import { drawTarot } from '../src/domain/tarot/draw.ts';
import { providerPolicyHash } from '../src/domain/provider-policy.ts';
import { READING_V3_SYNTHETIC_POLICY as policy } from '../src/contracts/provider-policy.ts';
import { buildWriterPlan } from '../src/worker/readings/writer-versions.ts';
import { buildPlanV3 } from '../src/domain/tarot/continuity.ts';
import { validateCandidateV3 } from '../src/domain/tarot/safety-v3.ts';
import { prepareWriterV3 } from '../src/domain/tarot/writer-v3.ts';
import { localDevelopmentBundle, syntheticBundle } from '../src/worker/readings/local-content.ts';
import { CONTINUITY_CORPUS } from './provider-evaluation-corpus.ts';
import { sourceDigest } from './verification-state.ts';

const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const questions = [
  'Which detail seems useful?',
  'What makes a comparison worthwhile?',
  'How might an option be tried?',
];
async function parentSnapshot(version: 1 | 2, policyHash: string) {
  const content = version === 1 ? await syntheticBundle() : localDevelopmentBundle();
  const basis = await drawTarot({
    deck: content.deck.map((c) => c.id),
    deckEdition: content.deckEdition,
    basisId: id(version),
    drawnAt: '2026-11-01T00:00:00Z',
    reversals: true,
    seed: new Uint8Array(32).fill(version),
  });
  const input = {
    content,
    basis,
    requestId: id(3),
    question: 'Private historical question omitted from egress.',
    language: 'en' as const,
    operation: 'initial' as const,
    parentEditionId: null,
    selected: [],
    permissionRevision: 1,
    keyVersion: 1,
    promptHash: policyHash,
    validatorHash: policyHash,
    generationPolicyHash: policyHash,
  };
  const native = await buildWriterPlan(input);
  return {
    input,
    parent: {
      editionId: id(4),
      contentHash: native.contentHash,
      basis: native.basis,
      sources: native.sources,
    },
  };
}
export async function evaluateContinuityLocally() {
  const policyHash = await providerPolicyHash(policy),
    parents = await Promise.all([parentSnapshot(1, policyHash), parentSnapshot(2, policyHash)]);
  const cases = [];
  for (const [n, entry] of CONTINUITY_CORPUS.entries()) {
    const { input, parent } = parents[entry.canon - 1]!;
    const quoted = entry.excerpt;
    const selected =
      quoted === null
        ? []
        : [
            {
              ordinal: 0,
              grantId: id(50 + n),
              grantRevision: 1,
              sourceId: id(100 + n),
              sourceKind:
                entry.authorship === 'legacy_unknown'
                  ? ('edition' as const)
                  : ('revisit_revision' as const),
              sourceRevision: 1,
              start: 0,
              end: [...quoted].length,
              text: quoted,
              textHash: await sha256Json(['synthetic-fixture', quoted]),
              availability: 'retained' as const,
              authorship: entry.authorship,
            },
          ];
    let result: string,
      packet: {
        transmissionHash: string;
        receiptHash: string;
        payloadBytes: number;
        estimatedInputTokens: number;
      } | null = null;
    try {
      const plan = await buildPlanV3({
        ...input,
        requestId: id(10 + n),
        question: entry.question,
        selected,
        operation: 'followup',
        parentEditionId: parent.editionId,
        ...(entry.id === 'missing-parent' ? {} : { parent }),
      });
      const { payload, receipt } = await prepareWriterV3(plan);
      const wire = JSON.parse(new TextDecoder().decode(payload));
      const data = JSON.parse(wire.input[2].content);
      if (
        data.reader.text !== entry.question ||
        canonicalJson(data.selected) !==
          canonicalJson(
            selected.map((f) => ({ id: 'selection:0', authorship: f.authorship, text: quoted })),
          ) ||
        wire.input[2].content.includes(input.question)
      )
        throw new Error('Continuity packet diverged from reviewed input');
      packet = {
        transmissionHash: receipt.transmissionHash,
        receiptHash: await sha256Json(receipt),
        payloadBytes: payload.length,
        estimatedInputTokens: receipt.estimatedInputTokens,
      };
      const prose = [
        entry.response,
        'A comparison can leave room for the parts that already work.',
        'A small optional change gives the idea a practical test.',
      ];
      const candidate = {
        schemaVersion: 3,
        kind: 'tarot.interpretation.v3',
        units: plan.basis.cards.map((c, i) => ({
          position: c.position,
          factIds: [c.id],
          sourceIds: [plan.sources[i]!.id],
          contextRefs:
            i === 0 && quoted !== null ? ['reader:question', 'selection:0'] : ['reader:question'],
          interpretation: prose[i],
          reflectionQuestion: questions[i],
        })),
        closing: 'Choose the perspective that fits the present question.',
      };
      await validateCandidateV3(
        plan,
        candidate,
        entry.id === 'failed-provenance'
          ? { ...receipt, transmissionHash: '0'.repeat(64) }
          : receipt,
      );
      result = 'accepted-fixture';
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.startsWith('CONTENT_UNAVAILABLE:')) result = 'CONTENT_UNAVAILABLE';
      else if (message === 'INVALID_CANDIDATE: CONTENT_CHANGED') result = 'CONTENT_CHANGED';
      else throw error;
    }
    if (result !== entry.expected) throw new Error(`Unexpected continuity result for ${entry.id}`);
    cases.push({
      id: entry.id,
      result,
      canonVersion: entry.canon,
      contentHash: parent.contentHash,
      packet,
    });
  }
  return {
    version: 'reflection-continuity-evaluation.v1',
    profile: 'continuity-local',
    sourceDigest: sourceDigest(process.cwd()),
    corpusHash: await sha256Json(CONTINUITY_CORPUS),
    policyHash,
    qualificationEligible: false,
    liveCalls: 0,
    cases,
  };
}
/** Rebuild the frozen local evidence. Older manifests cannot gain v3 approval by renaming fields. */
export async function verifyContinuityEvidence(report: unknown) {
  if (canonicalJson(report) !== canonicalJson(await evaluateContinuityLocally()))
    throw new Error('Continuity evaluation evidence mismatch');
}
