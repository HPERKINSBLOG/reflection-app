import { z } from 'zod';
import {
  ASTROLOGY_LIMITS,
  CHAPTER_BODIES,
  NATAL_BODIES,
  ZODIAC_SIGNS,
} from './astrology-policy.ts';

const Id = z.uuid();
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Instant = z.iso.datetime({ offset: false });
const Revision = z.number().int().positive();

export const CivilDate = z.iso
  .date()
  .refine((s) => s >= ASTROLOGY_LIMITS.earliestDate, 'Birth date must be 1900 or later');
export const CivilClock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/);
const PlaceFields = {
  label: z.string().trim().min(1).max(200),
  latitudeDeg: z.number().min(-90).max(90),
  longitudeEastDeg: z.number().min(-180).max(180),
  zone: z.string().min(1).max(100),
};
export const BirthPlace = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('manual'), ...PlaceFields }),
  z.strictObject({
    source: z.literal('geonames'),
    ...PlaceFields,
    sourceId: z.string().regex(/^\d+$/),
    datasetHash: Hash,
    country: z.string().min(1).max(100),
    administrativeArea: z.string().max(150),
  }),
]);
export type BirthPlace = z.infer<typeof BirthPlace>;
export const PlaceCandidate = BirthPlace.options[1];
export type PlaceCandidate = z.infer<typeof PlaceCandidate>;
export const BirthDraft = z.strictObject({
  date: CivilDate,
  place: BirthPlace,
  time: z.discriminatedUnion('certainty', [
    z.strictObject({
      certainty: z.literal('exact'),
      localTime: CivilClock,
      fold: z.enum(['earlier', 'later', 'unambiguous']).optional(),
      offsetSeconds: z.number().int().min(-86400).max(86400).optional(),
    }),
    z
      .strictObject({
        certainty: z.literal('approximate'),
        earliestLocalTime: CivilClock,
        latestLocalTime: CivilClock,
      })
      .refine(
        (t) =>
          (t.earliestLocalTime.length === 5 ? `${t.earliestLocalTime}:00` : t.earliestLocalTime) <
          (t.latestLocalTime.length === 5 ? `${t.latestLocalTime}:00` : t.latestLocalTime),
        'Earliest time must precede latest time',
      ),
    z.strictObject({ certainty: z.literal('unknown') }),
  ]),
  historicalZoneConfirmed: z.boolean(),
});
export type BirthDraft = z.infer<typeof BirthDraft>;
export const UtcInterval = z
  .strictObject({ startsAt: Instant, endsAt: Instant })
  .refine((r) => Date.parse(r.startsAt) < Date.parse(r.endsAt), 'Empty or reversed interval');
export const ResolvedBirthTime = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('instant'),
    certainty: z.literal('exact'),
    at: Instant,
    offsetSeconds: z.number().int(),
    fold: z.enum(['earlier', 'later', 'unambiguous']),
    historicalZone: z.boolean(),
  }),
  z
    .strictObject({
      kind: z.literal('intervals'),
      certainty: z.enum(['approximate', 'unknown']),
      intervals: z.array(UtcInterval).min(1).max(10),
      historicalZone: z.boolean(),
    })
    .refine(
      (r) =>
        r.intervals.every(
          (v, i) => i === 0 || Date.parse(r.intervals[i - 1]!.endsAt) <= Date.parse(v.startsAt),
        ),
      'Intervals must be ordered and nonoverlapping',
    ),
]);
export type ResolvedBirthTime = z.infer<typeof ResolvedBirthTime>;
export const BirthTimeResolution = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('resolved'), time: ResolvedBirthTime }),
  z.strictObject({
    kind: z.literal('fold'),
    choices: z.array(ResolvedBirthTime.options[0]).min(2).max(4),
  }),
  z.strictObject({ kind: z.literal('gap'), message: z.string() }),
  z.strictObject({ kind: z.literal('invalid'), message: z.string() }),
  z.strictObject({ kind: z.literal('historical_confirmation_required'), message: z.string() }),
]);
export type BirthTimeResolution = z.infer<typeof BirthTimeResolution>;
export const BirthProfileV1 = z.strictObject({
  kind: z.literal('birth.profile.v1'),
  id: Id,
  revision: Revision,
  birth: BirthDraft,
  resolved: ResolvedBirthTime,
  createdAt: Instant,
  updatedAt: Instant,
});
export type BirthProfileV1 = z.infer<typeof BirthProfileV1>;
export const AstrologyInputV2 = z.strictObject({
  kind: z.literal('astrology.natal.v2'),
  birth: BirthDraft,
  calendar: z.literal('gregorian'),
  zodiac: z.literal('tropical'),
  houses: z.literal('not_calculated'),
});
export type AstrologyInputV2 = z.infer<typeof AstrologyInputV2>;
export const CalculationIdentity = z.strictObject({
  engine: z.literal('astronomy-engine'),
  engineVersion: z.literal('2.1.19'),
  engineArtifactHash: Hash,
  tzdbVersion: z.literal('2026f'),
  tzdbHash: Hash,
  adapterVersion: z.literal('natal.v2.1'),
  reliabilityPolicy: z.string().min(1).max(100),
  reliabilityHash: Hash,
});
export type CalculationIdentity = z.infer<typeof CalculationIdentity>;
export const NatalPlacement = z.discriminatedUnion('status', [
  z
    .strictObject({
      status: z.literal('supported'),
      id: z.string(),
      body: z.enum(NATAL_BODIES),
      sign: z.enum(ZODIAC_SIGNS),
      representativeLongitudeDeg: z.number().min(0).lt(360),
      maximumDeviationDeg: z.number().min(0).max(180),
      guardDeg: z.number().min(ASTROLOGY_LIMITS.minimumGuardDeg),
    })
    .refine(
      (f) =>
        f.id === `sign:${f.body}` &&
        ZODIAC_SIGNS[Math.floor(f.representativeLongitudeDeg / 30)] === f.sign,
      'Fact identity or sign mismatch',
    ),
  z.strictObject({
    status: z.literal('suppressed'),
    body: z.enum(NATAL_BODIES),
    reason: z.enum(['boundary', 'interval_unqualified', 'budget_exhausted', 'engine_unavailable']),
  }),
]);
export type NatalPlacement = z.infer<typeof NatalPlacement>;
export const NatalCalculationResult = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('calculated'),
      input: AstrologyInputV2,
      resolved: ResolvedBirthTime,
      identity: CalculationIdentity,
      placements: z.array(NatalPlacement).length(10),
      evaluatedInstants: z.number().int().min(1).max(2048),
    })
    .refine((r) => new Set(r.placements.map((p) => p.body)).size === 10, 'Duplicate bodies'),
  z.strictObject({
    kind: z.literal('unavailable'),
    reason: z.enum(['invalid_input', 'engine_unavailable', 'budget_exhausted']),
  }),
]);
export type NatalCalculationResult = z.infer<typeof NatalCalculationResult>;
export const AstrologyBasisV2 = z.strictObject({
  kind: z.literal('astrology.natal.v2'),
  schemaVersion: z.literal(2),
  basisId: Id,
  calculationId: Id,
  profileId: Id,
  profileRevision: Revision,
  calculatedAt: Instant,
  semanticHash: Hash,
  calculation: NatalCalculationResult.options[0],
});
export type AstrologyBasisV2 = z.infer<typeof AstrologyBasisV2>;
export const ChapterId = z.enum(['self', 'connection', 'rest', 'growth']);
export type ChapterId = z.infer<typeof ChapterId>;
export const EditorialStatus = z.enum(['synthetic_local', 'human_approved']);
export const PatternChapterV1 = z
  .strictObject({
    kind: z.literal('pattern.chapter.v1'),
    id: ChapterId,
    body: z.enum(['sun', 'venus', 'saturn', 'jupiter']),
    factId: z.string(),
    sign: z.enum(ZODIAC_SIGNS),
    title: z.string().min(1).max(150),
    text: z.string().min(1).max(1600),
    prompt: z.string().min(1).max(180),
    factualLabel: z.string().min(1).max(100),
    sourceId: z.string().min(1).max(100),
    releaseHash: Hash,
    editorialStatus: EditorialStatus,
  })
  .refine(
    (c) => CHAPTER_BODIES[c.id] === c.body && c.factId === `sign:${c.body}`,
    'Chapter must use its declared body',
  );
export type PatternChapterV1 = z.infer<typeof PatternChapterV1>;
export const PatternChapterState = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('available'), chapter: PatternChapterV1 }),
  z.strictObject({
    status: z.literal('unavailable'),
    id: ChapterId,
    reason: z.enum(['placement_suppressed', 'content_unavailable']),
  }),
]);
export type PatternChapterState = z.infer<typeof PatternChapterState>;
export const PatternReadingV1 = z
  .strictObject({
    kind: z.literal('astrology.pattern.accepted.v1'),
    editionId: Id,
    sessionId: Id,
    editionNumber: Revision,
    parentEditionId: z.null(),
    basis: AstrologyBasisV2,
    chapter: PatternChapterV1,
    acceptedAt: Instant,
  })
  .refine(
    (r) =>
      r.basis.calculation.placements.some(
        (p) =>
          p.status === 'supported' &&
          p.id === r.chapter.factId &&
          p.body === r.chapter.body &&
          p.sign === r.chapter.sign,
      ),
    'Chapter requires its supported basis fact',
  );
export type PatternReadingV1 = z.infer<typeof PatternReadingV1>;
export const PatternSavedIdentity = z.strictObject({
  sessionId: Id,
  editionId: Id,
  reflectionId: Id.nullable(),
});
export type PatternSavedIdentity = z.infer<typeof PatternSavedIdentity>;
export const PatternPreview = z.strictObject({
  profileRevision: Revision,
  basisHash: Hash,
  releaseHash: Hash,
  basis: AstrologyBasisV2,
  chapters: z.array(PatternChapterState).length(4),
  saved: z.array(PatternSavedIdentity.extend({ chapterId: ChapterId })).max(4),
});
export type PatternPreview = z.infer<typeof PatternPreview>;
export const PatternSaveInput = z.strictObject({
  chapterId: ChapterId,
  expectedProfileRevision: Revision,
  basisHash: Hash,
  releaseHash: Hash,
  reflection: z
    .strictObject({
      text: z.string().max(10000),
      stance: z.enum(['resonates', 'unsure', 'disagree', 'unspecified']),
    })
    .nullable(),
});
export type PatternSaveInput = z.infer<typeof PatternSaveInput>;

export const PatternCatalogueEntry = z
  .strictObject({
    id: z.string().min(1).max(100),
    chapterId: ChapterId,
    body: z.enum(['sun', 'venus', 'saturn', 'jupiter']),
    sign: z.enum(ZODIAC_SIGNS),
    title: z.string().min(1).max(150),
    text: z.string().min(1).max(1600),
    prompt: z.string().min(1).max(180),
    sourceHash: Hash,
  })
  .refine(
    (e) => CHAPTER_BODIES[e.chapterId] === e.body && e.id === `${e.chapterId}.${e.sign}`,
    'Catalogue source binding mismatch',
  );
export const PatternCatalogue = z
  .strictObject({
    kind: z.literal('pattern.catalogue.v1'),
    version: Revision,
    language: z.literal('en'),
    rights: z.strictObject({
      status: z.literal('original'),
      attribution: z.string().min(1).max(500),
    }),
    entries: z.array(PatternCatalogueEntry).length(48),
  })
  .refine(
    (c) => new Set(c.entries.map((e) => e.id)).size === 48,
    'Catalogue must contain all 48 unique chapter/sign entries',
  );
export type PatternCatalogue = z.infer<typeof PatternCatalogue>;
export const PatternContentRelease = z.strictObject({
  kind: z.literal('pattern.content.v1'),
  catalogue: PatternCatalogue,
  releaseHash: Hash,
  state: z.enum(['active', 'withdrawn']),
  review: z
    .strictObject({
      kind: z.enum(['unreviewed', 'synthetic_local', 'human_approved']),
      reviewedHash: Hash,
      reviewer: z.string().min(1).max(200).nullable(),
      reviewedAt: Instant.nullable(),
      signature: z.string().max(200).nullable(),
    })
    .refine(
      (r) =>
        r.kind !== 'human_approved' ||
        (r.reviewer !== null && r.reviewedAt !== null && r.signature !== null),
      'Human approval requires a signed review',
    ),
});
export type PatternContentRelease = z.infer<typeof PatternContentRelease>;
