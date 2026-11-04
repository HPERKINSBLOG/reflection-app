# Milestone 3 foundations — C1 and P1

Implemented locally on 2026-11-02 using Node 26.12.1. This increment supplies contracts, a dormant metadata migration and pure import helpers. Context/import runtime creation remains disabled until the later privacy and persistence tasks are complete. At the time of this run the follow-up retention decision was open. D8 has local transport evidence and still needs actual database publication and erasure proof before P2 persistence is frozen.

## Continuity contracts

- Exact owned revisit revisions join the grant/source union. Migration `0018_context_continuity.sql` preserves old grants and context rows, retains owner-scoped foreign keys, and restores storage triggers without changing existing counters. An injected DDL failure rolls back in workerd D1 tests.
- Excerpts use exact Unicode code-point offsets, at most 3 distinct sources, 1,200 points each and 3,000 total. Duplicate grants to the same source do not bypass those bounds. Other legacy string limits retain their existing UTF-16 semantics.
- Start's acknowledgement is optional without a default, so historical empty-context input keeps the same mutation-HMAC shape. A frozen old wire fixture is hashed independently of the new schema, then compared with the real stored request; retry joins the same request and adds no dispatch.
- The request acknowledgement tuple binds owner epoch, intent, question, parent, permission and ordered source/range/hash identities. C2 must resolve sources and HMAC/verify it before context use. No new context dispatch is enabled by this helper.
- V3 plan/writer/receipt identities are reserved. Full writer shapes, policy hashes, provider qualification and runtime unions belong to C3.

## Portability contracts

`src/domain/imports/parse.ts` exposes asynchronous `parseImport()` for a bounded request and `parseImportFile()` for browser-side normalization. Adapters cover canonical input/export, the documented Tarot journal shape and bounded Patternlike 0.7.0/0.8.0 artifacts. Native Pixel and unverified Patternlike versions fail explicitly. Parse/selection/chunking perform no persistence or provider calls.

Tarot's base reading, each authored reflection and each follow-up turn are independent units. The base excludes nested reflections, card notes, follow-ups and history context. Retained `selected-fields.v1` JSON preserves the selected values' exact lexical spans; its hash describes the projection. A whole enclosing object is never retained as a hidden raw parent copy. Ambiguous older canonical Tarot bodies with nested children are rejected for conversion through the bounded raw adapter.

Authored identities use a stable parent entity and relative child key, excluding source revision and entry position. Entity erasure projections remove all matching copies across revision aliases. Portable wrappers receive the same embedded-raw validation as direct legacy units. Actual preview/staging/body/alias erasure and backup replay remain P2 database requirements; the pure projection tests do not establish that service behavior.

The selected-unit carrier is `reflection-portable-chunk.v1`. Each chunk has a stable group ID, manifest hash, total unit count and explicit ordinals. Reassembly rejects missing, duplicated or modified records. The 192 KiB admission includes the complete normalized unit and raw provenance; document length and serialized/escaped request bytes are checked separately. Browser file normalization is bounded at 32 MiB, nesting at 64 and assembly size at 20,480 units; server preview chunks retain the 100-item/200,000-unit/2-MiB bounds. Unresolved exact dependencies stay explicit.

The future commit API accepts one complete group per submission with a keyed preview acknowledgement and matching recovery declaration. Group status and result pagination are specified in OpenAPI; the handlers remain P2 work. The client helper stops subsequent submissions after cancellation and reconciles the stable ID of an already submitted group, including lost acknowledgement. It never promises HTTP abort will roll back a commit.

## Executed local evidence

Focused tests cover Unicode/ranges, historical request HMACs, migration rollback/FKs/accounting, nested selection, alias-copy erasure projections, hostile/raw carrier rejection, near-limit records, mixed-source export pages and cancellation. The independent review's two important findings—unstable authored IDs and portable-wrapper bypass—were reproduced by failing tests and corrected. The old-wire test was strengthened with an independent HMAC and before/after dispatch counts.

The first full gate exposed five existing repeated-journal Windows cases exceeding the generic 30-second test timeout, with no assertion failures. Their real NTFS ACL checks now have explicit 90/120/180-second case bounds. Ordinary tests retain their defaults, non-Windows bounds are unchanged and the full Windows gate remains capped at 20 minutes. The failed receipt/log are preserved alongside the final evidence.

The [current foundation receipt](../artifacts/m3-foundations/summary.json) records final commands, actual counts, hashes and source identity after the full gate. Check its status and digest; this document is not a substitute for that receipt. The [earlier frozen baseline](verification/2026-11-01/milestone-3-baseline.json) retains its original meaning and hashes. Production qualification entries are unaffected.

## Handoff

C2 must complete every context-copy lifecycle before exposing grant/preview routes. P2 must complete encrypted import preview, staging, group publication, alias recovery, deletion/rekey/restore and expiry coverage. Source-revision/new-namespace recovery remains subject to authoritative owned alias/tombstone checks there. D8 remains open until the real D1 transaction/visibility path passes, including groups spanning previews and child deletion with surviving parents.

The owner resolved follow-up retention on 2026-11-03, after the foundation run. C4 must keep accepted follow-ups automatically with the saved original and erase them together when the reader deletes it. [Decision D1](MILESTONE_3_PREPARATION.md#decisions-and-proposed-defaults)

The later local implementation and integrated acceptance evidence are recorded in the [Milestone 3 results](MILESTONE_3_RESULTS.md).
