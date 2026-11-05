import {
  AstrologyInputV2,
  ResolvedBirthTime,
  PatternReadingV1,
  type AstrologyBasisV2,
} from '../../src/contracts/astrology.ts';
import { calculateNatal, CALCULATION_IDENTITY } from '../../src/domain/astrology/calculate.ts';
import { semanticBasisHash } from '../../src/domain/astrology/identity.ts';
import {
  buildPatternChapters,
  syntheticPatternRelease,
} from '../../src/domain/astrology/chapters.ts';
import catalogue from '../../content/pattern-draft.json';
import parity from './astrology-node-parity.json';

/** Synthetic owned record built from a real pinned calculation, never personal birth data. */
export async function patternFixture() {
  const id = () => crypto.randomUUID();
  const calculation = calculateNatal(
    AstrologyInputV2.parse(parity[0]!.input),
    ResolvedBirthTime.parse(parity[0]!.resolved),
    CALCULATION_IDENTITY,
  );
  if (calculation.kind !== 'calculated') throw Error(calculation.reason);
  const basis: AstrologyBasisV2 = {
    kind: 'astrology.natal.v2',
    schemaVersion: 2,
    basisId: id(),
    calculationId: id(),
    profileId: id(),
    profileRevision: 1,
    calculatedAt: '2026-11-05T00:00:00Z',
    semanticHash: await semanticBasisHash(calculation),
    calculation,
  };
  const release = await syntheticPatternRelease(catalogue);
  const state = (await buildPatternChapters(basis, release, { allowSynthetic: true }))[0]!;
  if (state.status !== 'available') throw Error('Synthetic fixture unavailable');
  const reading = PatternReadingV1.parse({
    kind: 'astrology.pattern.accepted.v1',
    editionId: id(),
    sessionId: id(),
    editionNumber: 1,
    parentEditionId: null,
    basis,
    chapter: state.chapter,
    acceptedAt: '2026-11-05T00:00:00Z',
  });
  return { reading, release };
}
