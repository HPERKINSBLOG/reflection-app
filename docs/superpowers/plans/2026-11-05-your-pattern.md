# Your Pattern Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, or superpowers:subagent-driven-development if the owner selects delegated execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver birth details → calculated Your Pattern chapter → reflection → shared journal → exact reopening and dated revisit, on desktop and mobile.

**Architecture:** Add a Worker-native astrology adapter and a distinct immutable Pattern reading type. Extend the current encrypted reading-family lifecycle and journal rather than creating parallel reflection, ownership or erasure systems. Use deterministic reviewed chapter content for this first slice.

**Tech Stack:** Existing Node 26/Hono/React/Vite/Zod/Workers/D1; proposed exact pins astronomy-engine 2.1.19, moment-timezone 0.6.6 and moment 2.31.0 with IANA 2026f.

**Spec:** [Your Pattern design](../specs/2026-11-05-your-pattern-design.md). Supporting [implementation map](../../design/merger-implementation-map.md) and [foundation decision/evidence](../../architecture/ASTROLOGY_FOUNDATION.md).

**Status:** Mapping, dependency selection and the isolated numerical/timezone/Worker probe are complete. Tasks below are not implemented. No application dependencies, migrations or routes were changed by the preparation phase.

## Global Constraints

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

## Review Focus

- A local-time fold can include only part of an approximate interval; preserve the complete UTC union and reject a skipped day. Add to Task 2.
- Identical endpoint signs can hide an interior boundary crossing or turning point; suppress any placement without a qualified bound. Add to Task 3.
- Native-edition migrations can cascade away existing child rows despite copying parent rows; preserve IDs, encrypted bytes, foreign keys, references and storage totals. Add to Task 5.
- Profile/content changes after a preview or after an acknowledged-lost save must not overwrite a family or invalidate a successfully committed retry. Add to Task 7.
- Mixed-method pages, old native exports and imported astrology must never confer tarot follow-up authority or silently hide records. Add to Tasks 6 and 8.

## File ownership

| Area | New files | Existing integration points |
| --- | --- | --- |
| Contracts | `src/contracts/astrology.ts`, `src/contracts/astrology-policy.ts` | `src/contracts/index.ts`, `checks/generate-openapi.ts`, `scripts/schemas.ts` |
| Place and time | `src/domain/astrology/civil-time.ts`, `src/worker/astrology/places.ts`, `scripts/build-birthplaces.ts`, `content/astrology/places-manifest.json` | Existing public asset delivery and attribution |
| Calculation | `src/domain/astrology/calculate.ts`, `reliability.ts`, `identity.ts`, `content/astrology/calculation-manifest.json` | `package.json`, `package-lock.json`, local workerd verification |
| Chapters | `src/domain/astrology/chapters.ts`, `content/pattern-draft.json`, `scripts/pattern-content-activate.ts` | Existing content review/signing patterns, without weakening tarot schemas |
| Records | `src/worker/astrology/profiles.ts`, `patterns.ts`, `admission.ts`, `routes.ts` | Reading records, reflections/revisits, authenticated route dispatch |
| Migration/lifecycle | Next migration, expected `src/worker/db/migrations/0021_astrology_pattern.sql` | Registry, accounting, recovery inventory, rekey, export/import, erasure and restore tests |
| Client | `src/client/astrology/birth-details.tsx`, `pattern.tsx`, `pattern-reading.tsx`, `astrology.css`, `src/client/journal.tsx` | `identity.tsx`, `readings.tsx`, design components, revisit and deletion controls |

Resolve the next migration number at implementation time. Keep generated schema mirrors generated. Do not edit the proposed historical v1 schema instead of an additive migration.

### Task 1: Add explicit birth, basis, chapter and Pattern record contracts

**Files:** Create `src/contracts/astrology.ts`, `src/contracts/astrology-policy.ts`, `tests/domain/astrology-contracts.test.ts`; update `checks/check-contracts.ts` when registering exported schemas. Do not widen the live `Reading` union until its consumers are adapted in Task 5.

**Interfaces:** Produce `BirthDraft`, `BirthProfileV1`, `ResolvedBirthTime`, `AstrologyInputV2`, `AstrologyBasisV2`, `PatternChapterV1`, `PatternReadingV1`, `PatternPreview`, `PatternSaveInput` and corresponding inferred TypeScript types from the spec. Produce `ASTROLOGY_LIMITS` with 32 KiB body limit, 20 place results, 2–120-code-point queries and 30 new semantic calculations/day. Birth date/clock syntax validation is separate from timezone resolution.

- [ ] Write rejection/acceptance tests for all three certainties, invalid leap dates, NaN/out-of-range coordinates, unsupported conventions, extra fields and mismatched fact/chapter bodies. A Pattern record must not parse as `AnyAcceptedReading` or `ImportedReading`; old tarot fixtures still parse unchanged.
- [ ] Run `npm run test:domain -- tests/domain/astrology-contracts.test.ts`. Expected: FAIL for missing new contracts.
- [ ] Implement strict schemas and constants. Use `astrology.natal.v2` and `astrology.pattern.accepted.v1`; retain the reserved v1 shapes unchanged. Constrain chapter IDs to `self`, `connection`, `rest`, `growth` and declared sources to Sun, Venus, Saturn, Jupiter respectively.
- [ ] Run the focused suite and `npm run typecheck`. Expected: PASS; no old fixture changes required to make tests pass.
- [ ] Commit the contracts and tests as `feat: define native Pattern reading contracts`.

### Task 2: Resolve birthplaces and civil-time uncertainty

**Files:** Create `src/domain/astrology/civil-time.ts`, `src/worker/astrology/places.ts`, `scripts/build-birthplaces.ts`, `content/astrology/places-manifest.json`, `tests/domain/astrology-time.test.ts`, `tests/tooling/birthplaces.test.ts`; add exact moment pins and notices with this task.

**Interfaces:** Consume `BirthDraft`. Produce `resolveBirthTime(draft: BirthDraft, now: Date): BirthTimeResolution`, where the discriminated result is resolved, fold choices, gap, invalid, or historical-zone confirmation required. Produce `findBirthplaces(query: string, limit: number): PlaceCandidate[]`; candidates contain source ID, label, country/administrative labels, coordinates and zone. `BirthTimeResolution` must expose explicit UTC intervals/offsets, never a guessed instant.

- [ ] Write tests with the eleven explicit expected timezone cases in the foundation probe, plus malformed date/time, missing/alias zones, reversed intervals, a partially skipped interval, a partial half-hour fold and a future date in the selected zone. Assert exact offset/fold mismatches are rejected.
- [ ] Write gazetteer build tests for duplicate Portland-like names, corrupt coordinates, unknown zone IDs, missing small localities, non-Latin names, explicit manual selection and a dataset hash mismatch. Keep runtime queries first-party and unlogged.
- [ ] Run `npm run test:domain -- tests/domain/astrology-time.test.ts tests/tooling/birthplaces.test.ts`. Expected: FAIL before implementations.
- [ ] Pin/install moment-timezone and moment in the app, bundle complete transition data server-side, and implement strict round-trip resolution using transition tables. Never use the permissive default parser to decide gaps/folds. Build a versioned GeoNames artifact from `cities15000` and administrative labels; record source URLs, retrieval date, input/output hashes and attribution. Validate candidate zones against the pinned data.
- [ ] Run focused tests and `npm run typecheck`. Expected: PASS. The Havana fixture uses 2026f even when host `Intl` uses 2026e. The skipped Apia day has zero UTC intervals.
- [ ] Commit as `feat: resolve birth time and place explicitly`.

### Task 3: Implement and qualify the numerical adapter

**Files:** Create `src/domain/astrology/calculate.ts`, `reliability.ts`, `identity.ts`, `content/astrology/calculation-manifest.json`, `tests/domain/astrology-calculation.test.ts`, `tests/fixtures/astrology-reference.json`, `tests/db/astrology-worker.test.ts`; pin astronomy-engine exactly and add its notice.

**Interfaces:** Consume normalized `AstrologyInputV2` and `ResolvedBirthTime`. Produce `calculateNatal(input: AstrologyInputV2, resolved: ResolvedBirthTime, identity: CalculationIdentity): NatalCalculationResult` and `semanticBasisHash(result: NatalCalculationResult): Promise<string>`. Result is calculated with supported/suppressed facts, or unavailable with a bounded reason. Hash excludes random IDs and calculation timestamps and includes all input/model/data/policy identities.

- [ ] Freeze independently obtained expected longitudes and boundary cases before writing the adapter; record coordinate conventions/reference versions. Reuse the probe's cases as comparison evidence, not as sole proof of the full supported range. Add exact-time near-cusp, 0° wrap, Moon variability, both-endpoints-same/interior-crossing and refinement-exhaustion fixtures.
- [ ] Run `npm run test:domain -- tests/domain/astrology-calculation.test.ts`. Expected: FAIL for missing adapter/reliability behavior.
- [ ] Implement apparent geocentric true-ecliptic-of-date positions via `Ecliptic(GeoVector(body, at, true))`, with no early rounding. Add a justified conservative interval-bound policy and adaptive refinement; document its bound, failure conditions and version. Cap at 2,048 evaluated instants per calculation; if the bound/refinement cannot qualify a fact, suppress it. A finite sampling grid alone is not proof. Keep unsupported houses/angles/nodes absent.
- [ ] Hash the actual packaged engine artifact, timezone dataset and policies into the manifest; enforce these pins at build/qualification time. Do not copy the probe's CommonJS hash into an ESM deployment manifest without hashing its actual artifact.
- [ ] Run focused domain tests and `npm run test:db -- tests/db/astrology-worker.test.ts`. Expected: PASS, Node/workerd semantic parity and bounded worst-case behavior; no writer or external fetch calls. Record actual final bundle/startup/CPU evidence separately from the prototype probe.
- [ ] Commit as `feat: calculate qualified natal placements`.

### Task 4: Build four supported chapters and a reviewable catalogue

**Files:** Create `src/domain/astrology/chapters.ts`, `content/pattern-draft.json`, `scripts/pattern-content-activate.ts`, `docs/content-review/2026-11-05-pattern-catalogue.md`, `tests/domain/pattern-chapters.test.ts`, `tests/tooling/pattern-content.test.ts`.

**Interfaces:** Consume `AstrologyBasisV2` and a versioned `PatternContentRelease`. Produce `buildPatternChapters(basis, release): PatternChapterState[]`, preserving order Self/Connection/Rest/Growth and an explicit unavailable state. Activation accepts reviewed exact release bytes, not a bare approved flag.

- [ ] Write tests for all 48 body/sign combinations, unstable required placements, wrong-body bindings, withdrawn/unreviewed content, unsupported technical claims, exact-source hashes and deterministic output. Assert a suppressed Venus never yields a Connection sign claim.
- [ ] Run `npm run test:domain -- tests/domain/pattern-chapters.test.ts tests/tooling/pattern-content.test.ts`. Expected: FAIL.
- [ ] Author the catalogue and typed assembly. Keep code-rendered facts separate from symbolic editorial prose. Use a separate Pattern release schema and review envelope; preserve existing tarot content validators. Add an explicitly synthetic test release; prepare the complete review packet before requesting any new editorial approval.
- [ ] Run focused tests. Expected: PASS with zero AI calls, deterministic supported chapters and honest unavailable states. Production activation remains closed until the exact catalogue is reviewed; this does not block a labeled synthetic/local integration.
- [ ] Commit as `feat: assemble versioned Pattern chapters`.

### Task 5: Extend native storage without rewriting existing readings

**Files:** Create `src/worker/db/migrations/0021_astrology_pattern.sql` (or next free number), `tests/db/astrology-migration.test.ts`; update `src/worker/db/column-registry.json`, `src/contracts/index.ts`, `src/worker/readings/records.ts`, exhaustive reading dispatch in client/import/export, and generated schema artifacts.

**Interfaces:** Register `PatternReadingV1` in the top-level `Reading` union. Add encrypted current profiles, public Pattern content releases, calculation-admission metadata and owner-keyed saved-source identities. Extend native basis/edition constraints with `pattern` mode and the separate Pattern content reference; preserve generic session/edition IDs used by `Reflections` and `Revisits`.

- [ ] Write a migration fixture with existing tarot v1/v2/v3, child/grandchild editions, imported/unavailable readings, reflections/revisits, grants and storage totals. Capture IDs, ciphertext bytes and references before migrating. Test invalid cross-owner/cross-method inserts and missing Pattern basis/content.
- [ ] Run `npm run test:db -- tests/db/astrology-migration.test.ts`. Expected: FAIL before migration support.
- [ ] Implement the quiesced additive migration and explicit method metadata, preserving FK behavior and storage triggers. Use an owner-keyed HMAC for private semantic deduplication; do not create a public hash index of birth inputs. Native Pattern editions do not get fake generation requests or `legacy` mode. Keep writes/routes disabled until lifecycle support lands.
- [ ] Adapt discriminated readers without changing old encrypted payloads; render a valid Pattern detail branch before enabling it. Regenerate schema/OpenAPI/registry mirrors using `npm run schemas`.
- [ ] Run the migration suite, `npm run check:sql`, `npm run check:registry`, `npm run check:schemas`, `npm run typecheck`. Expected: PASS; exact old bytes/references/accounting preserved and foreign-key check empty.
- [ ] Commit as `feat: store native Pattern snapshots safely`.

### Task 6: Close portability, erasure, rekey and content-withdrawal coverage

**Files:** Update `src/worker/readings/export.ts`, `erase-data.ts`, `erasure.ts`, `import-targets.ts`, `context.ts`, `context-grant.ts`, `src/domain/imports/parse.ts`, import identity/codec modules as required, `src/worker/recovery/key-inventory.ts`, `account-rekey.ts`, `src/worker/maintenance/retention.ts`; create `tests/db/astrology-lifecycle.test.ts`, extend `tests/db/import-export.test.ts`, `tests/db/context-grants.test.ts` and `tests/db/storage-accounting.test.ts`.

**Interfaces:** Produce a versioned native portability envelope for profiles/Pattern records while retaining v1 readers. Add all new private columns to owner export/erasure/rekey and restore inventory. Current-profile deletion and saved-family deletion have distinct explicit scopes; account deletion removes both.

- [ ] Write tests for profile replacement/removal with retained original basis, complete account deletion, backup replay after erasure, key rotation, quota accounting, withdrawn Pattern content with retained own writing, and native export/import round trips. Assert importing a profile never overwrites an active one implicitly and Pattern/imported parents never authorize tarot follow-ups. Explicitly granted excerpts of Pattern own reflections/revisits must use current confirmation/revocation; reject Pattern edition context and prove that no joined chapter, basis or profile enters the writer packet. Preserve existing imported-writing eligibility.
- [ ] Run `npm run test:db -- tests/db/astrology-lifecycle.test.ts tests/db/import-export.test.ts tests/db/context-grants.test.ts tests/db/storage-accounting.test.ts`. Expected: FAIL on uncovered new fields/kinds.
- [ ] Implement the new envelope and complete lifecycle coverage. Reuse the existing assertion/erasure machinery; no second privacy lifecycle. Handle imports as explicit restoration candidates and preserve original calculation/content identities.
- [ ] Run focused suites plus `npm run check:registry` and `npm run check:schemas`. Expected: PASS with no orphan private fields, lost old records or invented verified provenance.
- [ ] Commit as `feat: preserve Pattern records through export and erasure`.

### Task 7: Add profile, preview and atomic save services

**Files:** Create `src/worker/astrology/profiles.ts`, `patterns.ts`, `admission.ts`, `routes.ts`, `tests/db/astrology-profiles.test.ts`, `tests/db/pattern-save.test.ts`, `tests/db/astrology-routes.test.ts`; update `src/worker/index.ts`, runtime construction and API schemas.

**Interfaces:** `BirthProfiles.read(session)`, `.write(session, input, mutation)`, `.remove(session, mutation)`; `Patterns.preview(session)` and `.save(session, input: PatternSaveInput, key: string)`; route adapter returns `Response | null` like the existing service adapter. Save returns exact session/edition/reflection identities. Produce day-scoped admission that reserves at most 30 new owner-keyed semantic calculations atomically and reuses the reservation for preview/save/retry.

- [ ] Write owner-isolation, unauthenticated/CSRF, recovery-kit, body-limit, revision conflict, duplicate/replayed-key, calculation-cap and concurrent-admission tests. Assert exact Fold/Gap review response shapes. Simulate a profile or content update between preview and publication, a deletion race and acknowledgement loss after commit. Two different keys racing with different nonblank reflections must produce one committed family/reflection and one 409 existing-family response; the losing draft is never acknowledged as saved.
- [ ] Run `npm run test:db -- tests/db/astrology-profiles.test.ts tests/db/pattern-save.test.ts tests/db/astrology-routes.test.ts`. Expected: FAIL before services.
- [ ] Implement the spec's endpoints with account/fence checks and no-store responses. Save recalculates against server-owned inputs and compares semantic basis/release hashes. Commit session, basis, edition, optional reflection and uniqueness identity atomically. Return a committed idempotent result before consulting a subsequently changed profile/content version.
- [ ] Keep calculation admission separate from AI allowance. Reopening saved records performs no calculation. Retries after a known failure may re-evaluate the same admitted identity within normal request rate limits; they do not create another saved family or exceed bounded per-request work. An existing family can satisfy a chapter-only save; new writing through a different save key gets the explicit conflict and must use normal reflection revision controls afterward.
- [ ] Run focused tests and contract/OpenAPI checks. Expected: PASS with AI permission off, one family per semantic snapshot, no writer calls and no birth values in logs/URLs.
- [ ] Commit as `feat: save calculated Pattern chapters to reading families`.

### Task 8: Adapt the shared journal and exact-record rendering

**Files:** Create `src/client/journal.tsx`, `src/client/astrology/pattern-reading.tsx`, `tests/db/journal-methods.test.ts`, `tests/browser/pattern-journal.spec.ts`; update `ReadingRecords.history`, history contracts, `readings.tsx`, `follow-up.tsx`, existing navigation/revisit/deletion controls and generated schemas.

**Interfaces:** Extend history with explicit native method and owner-scoped method filtering before pagination. Preserve existing `/saved/:sessionId/:editionId` links. `PatternReadingDetail` receives the stored Pattern record and the same reflection/revisit actions as the existing exact-edition page.

- [ ] Write mixed-page tests with more than one page of Tarot, Pattern and imports; verify method filters have stable cursors, unknown imported methods stay honest, and reopening old tarot exports remains unchanged. Browser test changes a birth profile after saving and asserts the original chapter/facts/writing remain identical.
- [ ] Run focused domain/database/browser checks. Expected: FAIL for missing method filters/detail branch before implementation.
- [ ] Implement the current-slice Journal presentation, source label, original chapter/basis details, own reflection and dated revisit timeline. Keep all old saved links valid. Hide later full-text/date/standalone-note controls until their own APIs exist; list those outstanding Figma gaps in the implementation map.
- [ ] Verify add/edit/delete revisit, conflict recovery, unavailable source and family deletion. Expected: saved reopening and note writes make zero calculation/writer calls; tarot follow-up remains type-restricted.
- [ ] Run `npm run test:db -- tests/db/journal-methods.test.ts` and `npm run test:browser -- tests/browser/pattern-journal.spec.ts`. Expected: PASS.
- [ ] Commit as `feat: revisit Pattern chapters in the shared journal`.

### Task 9: Build birth setup and Your Pattern desktop/mobile views

**Files:** Create `src/client/astrology/birth-details.tsx`, `pattern.tsx`, `astrology.css`, `tests/browser/your-pattern.spec.ts`; update `src/client/identity.tsx`, `api.ts`, app navigation and fixture journeys. Reuse design components/tokens; no new visual system.

**Interfaces:** `BirthDetails` renders editable/review/fold/gap/conflict states over the new profile API. `PatternWorkspace` renders supported/unavailable chapters and memory-only writing, invokes atomic saves and navigates to exact saved identities. Both participate in the current unsaved-draft navigation guard.

- [ ] Write browser journeys for exact, approximate and unknown setup; duplicated place names and manual place entry; fold/gap correction; unsupported chapter; save-without-writing; reflection save/retry; and Astro → Tarot transfer of the selected question only.
- [ ] Run `npm run test:browser -- tests/browser/your-pattern.spec.ts`. Expected: FAIL before views.
- [ ] Implement the approved layouts, informative uncertainty, loading/error states, save confirmation and source-return navigation. Include profile-retention disclosure at Create my chart. Failed requests retain drafts; stale responses cannot cross account/profile boundaries. Newly discovered interactions (fold chooser, historical zone confirmation) use existing components.
- [ ] Exercise Paper/Evening at 320/390/768/1280 px, keyboard/focus and overflow. Capture the real calculated views against Figma, including both supported and unavailable content. Expected: usable primary actions, labeled fields, no clipped prose or fabricated chart facts.
- [ ] Run focused browser tests and `npm run typecheck`. Expected: PASS, no personal data in browser storage or service-worker caches.
- [ ] Commit as `feat: complete the Your Pattern to journal journey`.

### Task 10: Qualify the integrated slice and update the delivery record

**Files:** Extend `tests/fixtures/browser-journey.ts` and existing cross-browser/accessibility/zoom/forced-color suites; add `docs/YOUR_PATTERN_RESULTS.md`; update `PRODUCT.md`, `docs/design/README.md` and the merger implementation map with actual evidence.

**Interfaces:** Produce a source-matched local acceptance receipt with executed commands, artifact hashes, catalogue/calculation identities and remaining hosted/editorial limits. A screenshot or a successful probe alone cannot mark this task complete.

- [ ] Add the complete create → chapter → write → save → sign out/in → reopen → change profile → revisit journey to the shared fixture, including AI-off and interruption variants. Confirm existing tarot/import/recovery journeys remain represented.
- [ ] Run affected focused tests, then `npm run verify` and `npm run test:journey`. Expected: all required gates pass without skipped/flaky cases; capture failures and fix causes before claiming completion.
- [ ] Check the actual compiled Worker/client bundles for correct calculation/data identities and that birth-time code/data remain server-side. Review numerical/uncertainty qualification and all new private fields against their lifecycle inventory.
- [ ] Have a fresh reviewer inspect the final change, especially migration safety, interval bounds, stale save publication and imported/native authority. Fix important findings with reproducing tests and a green affected suite.
- [ ] Write the results with exact executed counts and honest limitations, then commit as `docs: record Your Pattern local acceptance`.

## Completion boundary

This checklist implements Your Pattern and the journal support necessary to retain and revisit it. It does not mark Timing, Time Travel, standalone notes, full-text search or production deployment complete. Those have clear follow-on work in the [implementation map](../../design/merger-implementation-map.md). Any future engine or timezone-data change creates a new versioned basis and must preserve already saved readings.
