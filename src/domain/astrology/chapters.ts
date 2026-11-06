import {
  type AstrologyBasisV2,
  PatternCatalogue,
  PatternContentRelease,
  PatternChapterV1,
  type PatternChapterState,
} from '../../contracts/astrology.ts';
import { CHAPTER_BODIES } from '../../contracts/astrology-policy.ts';
import { sha256Json } from '../json.ts';

const unsupported =
  /\b(houses?|ascendant|rising|transits?|trines?|squares?|conjunctions?|oppositions?|sextiles?|nodes?|diagnos\w*|inevitable|destined|guaranteed)\b/i;
export async function validatePatternCatalogue(raw: unknown): Promise<PatternCatalogue> {
  const catalogue = PatternCatalogue.parse(raw);
  for (const entry of catalogue.entries) {
    if (unsupported.test(`${entry.title} ${entry.text} ${entry.prompt}`))
      throw Error('Unsupported technical or deterministic claim');
    const { sourceHash, ...source } = entry;
    if ((await sha256Json(source)) !== sourceHash) throw Error('Pattern source hash mismatch');
  }
  return catalogue;
}

/** Explicit local/test release. Production readers reject this review kind by default. */
export async function syntheticPatternRelease(raw: unknown): Promise<PatternContentRelease> {
  const catalogue = await validatePatternCatalogue(raw);
  const releaseHash = await sha256Json(catalogue);
  return {
    kind: 'pattern.content.v1',
    catalogue,
    releaseHash,
    state: 'active',
    review: {
      kind: 'synthetic_local',
      reviewedHash: releaseHash,
      reviewer: null,
      reviewedAt: null,
      signature: null,
    },
  };
}

export async function buildPatternChapters(
  basis: AstrologyBasisV2,
  release: PatternContentRelease,
  options: { allowSynthetic?: boolean } = {},
): Promise<PatternChapterState[]> {
  const entries = Object.entries(CHAPTER_BODIES) as Array<
    [keyof typeof CHAPTER_BODIES, (typeof CHAPTER_BODIES)[keyof typeof CHAPTER_BODIES]]
  >;
  const unavailable = (): PatternChapterState[] =>
    entries.map(([id]) => ({ status: 'unavailable', id, reason: 'content_unavailable' }));
  const parsed = PatternContentRelease.safeParse(release);
  if (
    !parsed.success ||
    release.state !== 'active' ||
    release.review.kind === 'unreviewed' ||
    (release.review.kind === 'synthetic_local' && !options.allowSynthetic)
  )
    return unavailable();
  let catalogue: PatternCatalogue;
  try {
    catalogue = await validatePatternCatalogue(release.catalogue);
  } catch {
    return unavailable();
  }
  if (
    (await sha256Json(catalogue)) !== release.releaseHash ||
    release.review.reviewedHash !== release.releaseHash
  )
    return unavailable();
  return entries.map(([id, body]) => {
    const fact = basis.calculation.placements.find((p) => p.body === body);
    if (!fact || fact.status !== 'supported')
      return { status: 'unavailable', id, reason: 'placement_suppressed' };
    const source = catalogue.entries.find((e) => e.chapterId === id && e.sign === fact.sign)!;
    const capitalize = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;
    return {
      status: 'available',
      chapter: PatternChapterV1.parse({
        kind: 'pattern.chapter.v1',
        id,
        body,
        factId: fact.id,
        sign: fact.sign,
        title: source.title,
        text: source.text,
        prompt: source.prompt,
        factualLabel: `${capitalize(body)} in ${capitalize(fact.sign)}`,
        sourceId: source.id,
        releaseHash: release.releaseHash,
        editorialStatus: release.review.kind,
      }),
    };
  });
}
