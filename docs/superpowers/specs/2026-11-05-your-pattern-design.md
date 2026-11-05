# Your Pattern: first working astrology flow

Date: 2026-11-05. The owner approved proceeding with design-to-app mapping and the calculation foundation after completing the Figma flows. This document specifies the subsequent implementation slice. Engineering choices below are the builder's decisions, not additional statements attributed to the owner.

## Outcome and scope

A signed-in reader enters birth details, understands any time uncertainty, explores Self, Connection, Rest or Growth, saves a chapter with their own reflection, and later reopens that exact chapter and adds a dated revisit. Desktop and mobile use the approved Paper/Evening library.

The first implementation serves those four chapters using calculated Sun, Venus, Saturn and Jupiter placements and versioned editorial copy. The calculation adapter can produce the ten body longitudes already named in Reflection's reserved contract; unsupported facts never become prose. No new AI generation is needed for this slice. Calculation and personal writing work with AI permission off.

Timing, Time Travel, standalone journal notes, full-text journal search, advanced chart techniques, and astrology follow-up generation remain later increments. Existing tarot behavior, follow-up permission gates and import semantics retain their current meaning.

## Approaches and chosen direction

1. A broad port of Patternlike would bring its native Swiss service, schema, chapter-generation pipeline and licensing surface. It offers substantial prior work but conflicts with several Reflection boundaries.
2. A narrow native Reflection adapter reuses the present account, encrypted storage, journal and revision machinery while adding new astrology types. Astronomy Engine and pinned timezone data make this viable inside the Worker. **Chosen engineering approach.** The [foundation decision](../../architecture/ASTROLOGY_FOUNDATION.md) records comparison evidence and remaining qualification.
3. A frontend-only rendering of the Figma examples would demonstrate navigation but would not fulfill calculated chapters, persistence or returning to an exact reading.

The approved Figma views define presentation and user intent. Example chart placements and chapter text are illustrative. They do not supply calculation fixtures or approve an unseen editorial catalogue.

## Global constraints

- Node >=26.0.0 <27; retain the existing Hono/React/Vite/Zod/Workers/D1 architecture.
- Use the current Paper/Evening tokens and Newsreader/Figtree/Outfit components.
- Pin astronomy-engine 2.1.19, moment-timezone 0.6.6 and moment 2.31.0; use full IANA 2026f data in the server adapter.
- Product birth dates: 1900-01-01 through the current date in the selected birth zone; proleptic Gregorian calendar.
- Geodetic latitude is north-positive; longitude is east-positive, in decimal degrees.
- Exact time requires explicit resolution of a fold; gaps are rejected. Approximate time is a same-date interval. Unknown time is the whole local day, never a noon surrogate.
- The minimum model guard band is 0.05 degrees. Unqualified interval bounds suppress facts; this sampled threshold is not a universal accuracy guarantee.
- No houses, angles, lunar nodes, chapter aspect claims or transit facts in this first slice. New input metadata says houses are not calculated.
- Personal drafts stay in memory; no private localStorage, IndexedDB, service-worker cache or automatic background submission.
- Birth profiles, chart inputs, basis snapshots and personal writing use the existing owner-scoped encryption, revision, accounting, export, erasure and rekey mechanisms.
- Saved chapter content, calculation identity and birth-profile revision are immutable. New calculations never rewrite saved readings.
- The astrology feature makes no writer calls. The tarot handoff transfers only the explicitly chosen reflection question; separately granted excerpts of the reader's own writing remain subject to the existing context-confirmation flow.
- Production activation requires numerical/uncertainty qualification and review of the exact chapter catalogue; local synthetic work must identify illustrative content honestly.

## Flow and interaction

**Setup.** On Astrology → Your Pattern, an account without a profile sees the existing welcome/setup design. Date, birthplace and certainty are required. Selecting a place confirms its label, coordinates and IANA zone; manual coordinates and zone are available when a locality is absent. Place lookup uses a pinned first-party gazetteer, with attribution. No external place query contains a birth date or time.

Exact time offers recorded local HH:mm or HH:mm:ss. A repeated local time shows both UTC offsets and asks which occurrence applies; neither is preselected. A gap explains that the local clock skipped that time and preserves the draft. Approximate exposes earliest/latest local times; Unknown removes the clock inputs and uses the full local day. The review displays the source place/zone and uncertainty. A pre-1970 date includes a historical-zone qualification and explicit confirmation of the chosen zone.

**Create my chart.** This explicitly saves the private birth profile, then calculates a preview. The UI explains profile retention at this action. An initial calculation failure can retry using the saved profile; no fake chapter appears. Editing a profile requires its expected revision. A conflict keeps the user's draft and shows the saved version; it must not overwrite silently.

**Explore.** Chapters remain Self, Connection, Rest and Growth in the approved order. Self uses a reliable Sun sign; Connection uses Venus; Rest uses Saturn; Growth uses Jupiter. Each displays a code-rendered factual label, a short editorial reflection and an optional prompt. "Chart behind this chapter" displays the actual fact and its uncertainty/provenance. If that placement is not supported, the chapter explains why and offers the user's own writing without claiming a calculated sign. The person can still select other supported chapters.

**Save to journal.** A supported chapter can be saved with no authored reflection. Nonblank writing saves in the same transaction as the chapter; retain the existing 10,000-character Reflection contract and the current stance enum. An unsupported chapter cannot be saved as a calculated chapter; its writing can remain in memory until the person chooses a supported chapter. Standalone notes are a later capability, so do not show a nonfunctional save promise. Loading, failure and retry preserve the selected chapter and exact draft. Only a confirmed response shows Saved.

Each semantic chapter snapshot has one saved family: owner + profile revision + semantic basis hash + content release hash + chapter ID. A retry or return to the same snapshot opens that family. Additional personal writing uses its reflection/revisit controls. Changing profile or content creates a distinct snapshot/family and preserves the earlier one. Do not hide this distinction behind an automatic replacement.

If another save with a different idempotency key already created that family, a chapter-only save may return its existing identity. A submission carrying nonblank new writing returns an explicit 409 existing-family conflict with the saved identity and keeps the draft unsaved. It must not overwrite a reflection or report that the new words were saved. The person can open the saved chapter and deliberately create/edit a reflection using its normal revision guard. This also governs two tabs racing to submit different initial reflections. Replaying the identical successfully committed key returns the original successful result; changing that key's payload retains the existing idempotency-mismatch behavior.

**Return.** Saved confirmation opens the exact new journal entry. Shared history includes Tarot, Astrology and imported records; a method filter operates over all owned rows before pagination. A saved chapter shows original text, the fact/uncertainty snapshot, own reflection, and dated revisits. Updating a birth profile changes future previews only. Reopening and adding a revisit trigger zero calculation or writer calls.

**Tarot handoff.** Explore with tarot populates the question step with the selected chapter's prompt. The person still reviews the question, spread, language and AI permission. Do not add chart facts, birth details or prior writing to the request implicitly.

**Explicit journal context.** A reader may separately select an excerpt from their own Pattern reflection or dated revisit through the existing grants, preview and question-bound confirmation workflow. The projection contains only the selected writing and existing receipt metadata, never a joined birth profile, chart basis or chapter. Imported authored writing follows the existing import/context eligibility rules and does not acquire new verification authority. Pattern chapter/edition bodies are ineligible as `edition` context sources in this slice; return an explicit unsupported-source result rather than passing them through the tarot extractor. Pattern records also remain ineligible tarot follow-up parents. Source edits/deletion revoke excerpts under existing rules, and live continuity availability remains governed by the current provider gate.

## Calculation and content contracts

Add focused schemas in `src/contracts/astrology.ts`; preserve the frozen v1 contracts and existing encrypted tarot payloads. Re-export new schemas from `index.ts` and register relevant HTTP/export schemas through the current generator.

- `BirthDraft`: local date, certainty-specific time/interval, confirmed place, zone, optional fold selection, historical-zone acknowledgement and expected profile revision. Strings are semantically validated; accepting an arbitrary `z.string()` is not time validation.
- `BirthProfileV1`: stable profile ID, revision, normalized draft, place ID/source/hash or explicit manual source, confirmed IANA zone and server creation/update instants. There is one current profile per owner. Its payload is encrypted; no birth date/place/coordinates in SQL search columns or logs.
- `ResolvedBirthTime`: either one UTC instant with selected offset/fold, or a sorted nonoverlapping union of half-open UTC intervals. Unknown-day and approximate unions may span gaps/folds. Empty unions are rejected.
- `AstrologyInputV2`: normalized supported civil input, coordinates, Gregorian/tropical conventions and `houses: 'not_calculated'`. Do not coerce it into the reserved whole-sign v1 schema.
- `AstrologyBasisV2`: immutable input snapshot, resolved time, profile revision, ten-body results or explicit suppression, body-specific reliability, engine/artifact identity, tzdb/data hash, adapter/reliability-policy versions and calculation timestamp/ID. Do not mislabel a midpoint longitude as a stable sign.
- `PatternChapterV1`: chapter ID, associated fact IDs, immutable title/prose/prompt, factual display label, catalogue/source IDs, release hash and editorial status. Calculated facts and symbolic editorial text remain separately typed.
- `PatternReadingV1`: discriminator `astrology.pattern.accepted.v1`, session/edition IDs and edition number, null parent ID, full immutable basis and selected chapter snapshot, accepted timestamp and catalogue identity. It is a native deterministic record, not `legacy.imported.v1` and not a tarot model result.
- `PatternPreview`: profile revision, semantic basis hash, release hash, supported chapter previews and matching saved-family IDs. The semantic hash excludes random IDs and wall-clock calculation timestamps; it includes the full normalized input, results and versioned policies.

Preview data stays in memory. Saving submits chapter ID, expected profile revision, basis/release hashes, optional reflection/stance and an idempotency key. The server recalculates against the same pinned active identities and compares the semantic hash; it never accepts client-authored chart facts or prose. If profile/content changes, return a conflict and keep the draft. Replaying an already committed idempotency key returns its saved result before attempting to use a newer profile/content release.

The initial catalogue has four chapters × twelve signs. It contains newly authored, bounded English editorial copy, not predecessor-generated text transplanted as approved content. Exact review and rights metadata apply to the full release. Use a dedicated Pattern content release schema/store; the tarot `ContentBundle` must not be weakened to accept unrelated JSON. The catalogue can have an explicit synthetic-local release for tests while a reviewed release is prepared.

## Storage and service ownership

Use new modules under `src/worker/astrology/` for profiles, previews, chapter save and routes. Reuse `RecordBase` session/account checks, encrypted field codec, atomic assertion batches, idempotency and revisions. Do not instantiate `GenerationService` or fabricate an AI dispatch to satisfy old SQL constraints.

One additive migration (next available number, expected `0021`) introduces encrypted current birth profiles and a public Pattern content-release registry, widens basis/edition constraints for native Pattern records, and adds a typed session method for mixed history. Rebuild tables where SQLite CHECK constraints require it using the established quiesced-migration pattern. Preserve composite owner foreign keys, existing IDs/bytes/indexes/triggers and storage totals. No `foreign_keys=OFF` shortcut. A migration regression must start with populated tarot/follow-up/import data.

Pattern editions use an explicit native `pattern` mode with no generation request. Their basis and content references are mandatory and method-correct; a Pattern content FK is separate from the tarot content FK. Enforce that only one content reference applies. A reading family still owns its original reflection and all dated revisits. Future astrology follow-ups require a separate design; the existing tarot follow-up admission must reject Pattern parents explicitly.

`ReadingRecords.reading`, history, export, import previews and client dispatch must discriminate Pattern before accessing tarot cards/sources/provenance. Reflections/revisits can reuse their generic edition ownership checks once the new edition type is valid. Pattern content withdrawal preserves the same unavailable-reading/retained-writing semantics already used by the app.

A profile edit replaces the current encrypted profile; retained saved bases contain their original inputs independently. "Remove birth details" must disclose that saved chapter snapshots retain their original inputs and offer deletion of those readings too. Account deletion removes all copies. Register the new profile field and Pattern bodies for accounting, export, erasure, rekey, backup replay and recovery inventory before admitting writes.

Use a new versioned native portability envelope for the additional profile/Pattern record kinds. Preserve existing v1 export/import readers and exact old payloads. Imported Pattern snapshots stay immutable and verifiable only to the extent their provenance allows; restoring a profile is a separate explicit choice, never an automatic replacement of the active profile. Import/export round trips must not turn an imported record into authority for tarot generation.

## Proposed endpoints

All personal routes use existing authenticated sessions, CSRF, origin checks, bounded bodies, no-store responses and owner-scoped identifiers. Mutations use current idempotency and expected-revision semantics.

| Endpoint | Result |
| --- | --- |
| `POST /api/v1/astrology/places/search` | Bounded first-party place candidates; query body avoids URL query logging; no query retention |
| `POST /api/v1/astrology/birth/resolve` | Validated review or explicit invalid-date/place, fold, gap or historical-zone acknowledgement outcome; no personal persistence |
| `GET /api/v1/astrology/profile` | Current encrypted-profile projection or absent state |
| `PUT /api/v1/astrology/profile` | Explicit create/update with expected revision and idempotency |
| `DELETE /api/v1/astrology/profile` | Revision-checked removal of current profile; saved-basis retention disclosed |
| `GET /api/v1/astrology/pattern` | Current supported previews and existing saved-family references; no writer call |
| `POST /api/v1/astrology/pattern/saves` | Atomically save exact chapter/basis and optional initial reflection; return session/edition/reflection identities |
| Existing saved-reading/reflection/revisit routes | Read, edit writing and delete Pattern families using the established lifecycle |

Use a 32 KiB ceiling for birth/resolve/save request bodies, at most 20 place candidates, query length 2–120 Unicode code points, and the existing personal-storage quota. Birth-profile writes/calculations require an acknowledged recovery kit, matching other retained personal data. Bound calculation/refinement work independently of AI reading allowance; initial limit 30 new semantic calculations per owner per UTC day, with idempotent retries and reopening saved entries consuming none. Preview/save reuse the same normalized calculation identity rather than charging twice. Tune only from measured worst-case work; show a retry time for an exhausted calculation budget.

Admission metadata uses an owner-keyed HMAC of normalized calculation identity plus the UTC quota day. Keep no raw birth fields or globally comparable input hashes there. The metadata participates in accounting, account erasure and rekey/key-inventory policy and expires after the quota day plus the bounded retry window. It is not a persisted preview or an independent retained birth snapshot.

## Verification and acceptance

The foundation probe is already executed evidence, not acceptance of the feature. Implementation completion requires:

- Exact, approximate and unknown profiles produce correct facts or explicit suppression; ambiguity is never silently resolved; unsupported facts cannot reach chapter text.
- Place search handles duplicate names, manual entry and unavailable results; historical qualifiers remain attached to the saved basis.
- Saving and retrying produce one family and optional reflection; concurrent profile/content changes cannot publish a mismatched snapshot. A losing nonblank save keeps its writing unsaved and returns a conflict.
- Sign out/in, change the birth profile, and reopen the original: original facts/prose/uncertainty/writing are byte-for-byte preserved. Add/edit/delete a dated revisit without recalculating.
- Owner isolation, AI-off use, CSRF, expired sessions, acknowledgement loss, revision conflict, content withdrawal and deletion races behave coherently.
- Full lifecycle tests cover new fields, old tarot records, export/import compatibility, key rotation and restore deletion replay.
- Explicit excerpts of Pattern own writing use existing confirmation and revocation; chapter/basis/profile fields cannot leak into that projection or authorize a tarot follow-up.
- Paper/Evening at 320/390/768/1280 px, keyboard/focus, 200% zoom, supported forced colors and the existing cross-browser matrix.
- Appropriate domain/database/browser checks plus the repository verification gate pass. Hosted deployment and live content activation remain separate actions.

## Builder-owned choices and remaining qualifications

The builder chose a Worker-native MIT calculation stack, deterministic chapters, first-party place search, the four placement-backed chapters, bounded calculation admission and an initial date range. These can change if evidence shows they cannot support the promised experience; record the changed policy/version and preserve saved records.

The exact interval-stability proof, exhaustive engine/reference fixtures, editorial catalogue bytes and gazetteer artifact hashes are implementation deliverables, not facts established by this design. Inability to qualify a fact must produce an unavailable chapter, not fabricated certainty. A reviewer should focus on these boundaries and on native-edition SQL migration safety.
