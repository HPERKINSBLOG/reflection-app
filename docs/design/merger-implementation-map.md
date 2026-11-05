# Reflection merger: design to implementation

Checked 2026-11-05 against Reflection `ce9f21a7b6de07073906ff2e3b688bf655cde24e`, the connected Figma file, and the predecessor sources below. Design completion and application behavior are tracked separately.

## Completed design baseline

The [connected-flow page](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=14-55) uses the existing Paper/Evening system. The live inspection found all recorded frames and links in both directions between astrology, tarot and journal. Counts include guides where applicable: 66 astrology frames, 76 journal frames and 81 tarot frames. Previously executed prototype checks cover 12 astrology, 37 journal and 62 tarot scenarios; these inspect prototype reactions and screenshots, not app services.

| Journey | Figma references | App reuse | Remaining implementation |
| --- | --- | --- | --- |
| Birth setup, exact/approximate/unknown, review | [Desktop](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=29-175), [mobile](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=29-203) | `src/client/design/components.tsx`, `src/client/notice.tsx`, account/session and recovery controls | Place lookup, strict civil-time validation, fold/gap UI, encrypted profile, calculation adapter and uncertainty qualification |
| Your Pattern: Self, Connection, Rest, Growth | [Desktop](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=14-56), [mobile](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=29-211) | Paper/Evening tokens, typography, cards, links, reflection fields | Typed real chart facts, versioned chapter catalogue, supported/unsupported fact rendering, immutable previews |
| Astrology save and return to source | [Confirmation](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=29-197), [save failure](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=29-198) | Idempotent mutations, ownership/revision guards, encrypted records, reflections and revisit services | Native astrology edition/basis types, compatible SQL migration, atomic chapter+reflection save, source/profile-version snapshot |
| Shared journal, browse and filters | [Desktop](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=51-1608), [mobile](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=51-1643) | `ReadingRecords.history`, saved-reading reopening and imported records | Mixed native-method rows and filters first; full-text search, date/order controls, standalone notes and recent-activity ordering are later journal work |
| Journal editing, revisits, family timeline | [Journal flow guide](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=60-3332) | `Reflections`, `Revisits`, `ReadingDeletion`, `EditionHistory`, conflict/offline handling | Extend exact-edition rendering and lifecycle to native Pattern records; adapt presentation to the new journal designs |
| Tarot question → spread → cards → interpretation | [Tarot guide](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=78-4872) | `readings.tsx`, `card-face.tsx`, `request-progress.tsx`, draw/recognition/writer services | New multi-screen presentation and shared navigation; keep actual service behavior and product limits |
| Tarot follow-up → journal | [Follow-up](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=73-3535) | `follow-up.tsx`, `context-selection.tsx`, continuity, family save/delete and imports | Visual alignment; live continuity qualification remains distinct from the implemented synthetic/local flow |
| Timing | [Timing](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=14-57) | The future natal adapter, versioned factual rendering, journal links | Transit searches, start/exact/end windows, multiple hits, phase and uncertainty qualification; no current runtime |
| Time Travel | [Time Travel](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=14-58) | Immutable saved editions and dated revisits | Date comparisons, stored reference time, local-zone anchors, empty-date path and new calculated context; no current runtime |

`src/contracts/index.ts` has `AstrologyInput`, `AstrologyBasis` and `CalculationService`, but no enabled astrology route. `Reading` accepts native tarot, imported and unavailable records. Native astrology is therefore not just a new page. `basis_snapshots.kind` is restricted to tarot; `reading_editions` requires generation/basis/content identities for native model/template rows. Extend those boundaries explicitly rather than using `legacy` for new chapters.

The existing journal is a saved-reading collection. `HistoryItem` lacks a native method field, standalone-note identity and activity-sort metadata. Search/date controls drawn in Figma are not implemented by that API. Its pagination must remain owner-scoped and stable while adding a method filter; filtering only the first loaded page would be incorrect.

## What the original apps contribute

These are inspected sources, not licenses to transplant every dependency. Reuse test intent and narrow domain ideas; adapt code only after checking its exact ownership/terms. No predecessor source was copied in this phase.

| Source and inspected revision | Valuable contributions | Adaptation required |
| --- | --- | --- |
| [Patternlike](https://github.com/henryperkins/patternlike-app/tree/b84c4aa09384a668f4dcc74256d43d5192139911) | `apps/calc-stub/src/engine.ts`, golden/uncertainty/timezone tests, pinned calculation identity; `packages/pattern-engine/src/selection.ts` and `policy.ts` separate facts, supported ontology and chapter selection | Replace native service packaging for the selected runtime. Do not adopt Placidus/Porphyry, true-node facts, long generated chapter limits, placeholder container/tzdb identity, or its project-specific AGPL choice by implication. |
| [Pixel](https://github.com/henryperkins/pixel-perfect-view-757/tree/76ff8ca02ef5251236be940dbf4c36051958b21f) | `src/lib/ai/facts.ts` separates calculation from interpretation; `src/lib/birth-form.ts` validates date/place and preserves a revision; journal editor and returning-reading UX | Replace approximation authority and coarse time presets. Its unknown-time submission uses `12:00`; Reflection must retain unknown as a day interval. Never copy that sentinel into a known birth instant. |
| [Tarot](https://github.com/henryperkins/tarot/tree/ef16dc6f412705669955368deaab106885bb55ed) | Journal filtering/search, exact reading identity, follow-ups and own-word reflections, mature reading journey | Reflection already has its own encrypted family lifecycle. The predecessor's search endpoint, entitlement gates and plaintext-oriented row projection are not a drop-in API. Rebuild presentation over Reflection's own services. |

For historical comparison, earlier architecture reviews inspected older Tarot/Pixel revisions; see [the original source inventory](../architecture/ARCHITECTURE.md). The current source selections above were fetched again during this phase.

## Implementation order

1. **Foundation and exact first-slice plan:** completed in this phase. [Engine/timezone decision and evidence](../architecture/ASTROLOGY_FOUNDATION.md), [design](../superpowers/specs/2026-11-05-your-pattern-design.md), [task checklist](../superpowers/plans/2026-11-05-your-pattern.md).
2. **Your Pattern end to end:** birth details → qualified placement → chapter → own reflection → shared journal → reopen → dated revisit. Ship desktop and mobile together. Reuse lifecycle services after making their type/storage assumptions explicit.
3. **Broader shared-journal implementation:** standalone notes, full-text search, date/activity ordering and the remaining Figma presentation. These are tracked gaps; a limited method filter does not close them.
4. **Timing:** qualified transit/event engine, phases and linked notes.
5. **Time Travel:** date comparisons and new revisit context with the original reading retained.

The current task does not require redrawing completed Figma flows. Implementation should add targeted states only when real validation reveals a missing interaction, such as a daylight-saving occurrence chooser.
