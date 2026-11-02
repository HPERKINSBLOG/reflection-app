# Milestone 3 preparation

Status: C1/P1 foundations implemented locally on 2026-11-02; see [foundation evidence and handoff](MILESTONE_3_FOUNDATIONS.md). Follow-up retention (D1) remains an open product choice before C4. D8 has local parser/transport proof and remains open for actual D1 atomic publication and erasure proof before P2 persistence is frozen. Remaining workflows and production qualification are outstanding.

Milestone 3 extends Reflection with deliberate, bounded use of selected context, follow-ups tied to an exact saved edition, and supported legacy/portable imports. Dated revisit notes were brought forward and are already implemented. Ordinary saved history, exact reopening, initial reflections, recovery, export and deletion are existing regression requirements.

## Starting point and evidence

The preparation starts from Git HEAD `dd7bcca73b178812caaf9c39d04c0b639df858b4` plus the existing uncommitted Reflection design-system and Windows-tooling changes. HEAD alone does not identify the tested application. The verified working-tree source digest is `feacdbe7a2e6886b67fd2869e502d3a7f3cccb22c84122d6da47c5772cf248ad`.

The [frozen baseline receipt](verification/2026-11-01/milestone-3-baseline.json) records 14 passing stages, 409 domain/tooling tests, 525 database tests, 134 Chromium tests and 36 Chromium/Firefox/WebKit journeys. Native Chromium 200% zoom passed 56 captured states per theme, including exact 320/390/768/1280 CSS-pixel viewports. Zero skipped or flaky cases were reported in the final runs. The WebKit keyboard-readiness correction also passed three focused repetitions.

These results establish the preceding application snapshot, not Milestone 3 implementation. Adding this preparation changes the repository source digest because documentation is included. Keep the old receipt intact; a fresh full gate is required for a later source-matched release claim. This preparation uses document/link and baseline-integrity checks, not another application qualification run.

## What exists and what is missing

| Area | Current evidence | Remaining work |
| --- | --- | --- |
| Dated revisit notes | `Revisits`, revision storage, export, erasure and recovery tests; migration 0017 | Preserve this behavior; add exact-note-revision context support only through the new permission flow. |
| Context contracts | C1 adds exact revisit revisions, code-point bounds, request binding and migration 0018 | Runtime grant/preview services and UI remain C2/C3 work. Creation stays disabled until export/erasure support is complete. |
| Privacy and portability | Ciphertext registry includes dormant context/import families | `ReadingExports.page()` refuses accounts with grants/import identities; erasure also refuses unsupported copies. Complete family support before enabling creation. |
| Follow-ups | Generic v1 plan and synthetic publication prototype cover parent/context guards | `ReadingGeneration.start()` rejects a parent or selection. `PreparedPlanV2` and `buildPlanV2()` require initial requests with no selected context. |
| Imports | P1 implements pure bounded adapters, independent nested selection, manifest chunks and cancellation sequencing, with synthetic fixtures | Persistent preview/commit/erasure and imported-record UI remain P2/P3 work. Pure tests do not establish encrypted lifecycle behavior. |
| Portable identity | Native exports currently use `snapshot-<data revision>` as the source revision | P2 must make record identity stable across export snapshots and reconcile own-account native records before creating copies. Snapshot metadata is not dataset identity. |
| Design system | Paper/Evening tokens, Newsreader/Figtree/Outfit, shared controls and full theme tests | Reuse the system for all new states; no new palette or competing component library. |
| Production | All ten qualification entries remain pending | Keep hosted/provider/custody/operations qualification separate from this local implementation milestone. |

Code authorities: [`src/contracts/index.ts`](../src/contracts/index.ts), [`generation.ts`](../src/worker/readings/generation.ts), [`export.ts`](../src/worker/readings/export.ts), [`erase-data.ts`](../src/worker/readings/erase-data.ts), [`context-v2.ts`](../src/domain/tarot/context-v2.ts), [`readings.tsx`](../src/client/readings.tsx). Generated schemas and OpenAPI remain projections; edit their source authorities and regenerate them.

## Decisions and proposed defaults

| ID | Proposed choice | Basis and disposition |
| --- | --- | --- |
| D1 — follow-up retention | A follow-up is a new immutable edition of the **same saved reading/session**, with shared save state and family deletion. No separate child-save promise. | Matches the architecture, database and existing session erasure. An older visual design proposes independent children. An owner clarification is pending; do not implement the conflicting retention behavior by assumption. |
| D2 — eligible context | Exact owned available reading editions, current reflection revisions, and current revisit-note revisions. Start empty; grants establish eligibility only. A new revision requires a new preview/acknowledgement. | Revisit support is a proposed extension of the existing two-kind grant contract. Include storage, guard, export and erasure coverage in the same increment. Historical notes remain exportable but are not automatically eligible for new sharing. |
| D3 — excerpt policy | At most 3 distinct sources, 1,200 Unicode code points per excerpt, 3,000 total. No silent truncation. Photos, filenames, stance and unselected history are excluded from this text-context increment. | Existing selected-context bounds; explicitly reconcile Zod UTF-16 string limits with the documented code-point offsets. Larger notes need an explicit chosen range. |
| D4 — parent and source edition | Pin the parent's exact accepted draw and eligible source snapshot; disclose “No new draw.” Reuse facts and canon, not unselected parent questions, interpretations or private provenance. Never silently switch source editions. | Cover native v1/v2 parents explicitly; missing source evidence blocks the follow-up rather than inventing v2 metadata. Independently check parent, captured content and selected sources. The generic parent-A/content-B withdrawal race remains mandatory even if the first UI only reuses A. |
| D5 — writer version | Introduce a separately versioned continuity plan/prompt/validator/policy. Preserve existing v1/v2 decoding and historical receipts. Do not widen v2 silently or treat its question analysis as permission to share history. | Current v2 explicitly rejects these features. Exact new wire discriminants and schema compatibility are frozen in the first implementation task. |
| D6 — import formats | Required: `reflection-import.v1`, `reflection-export.v1` and the documented Tarot adapter. Bounded Patternlike 0.7.0/0.8.0 support needs versioned fixtures and inspected field allowlists. Native `pixel-json` stays explicitly unsupported. | Existing migration specification. No real accounts, live legacy export access or invented source fields are needed for synthetic qualification. Unsupported adapter capability must remain visible. |
| D7 — permission and activation | Preview itself sends nothing. A submission-specific acknowledgement binds the complete reviewed selections and current permission. Revocation is distinct from erasing retained copies. Live continuity remains disabled until its separate provider qualification is recorded. | Existing consent architecture; final recipient/retention copy must be accurate for the configured provider. No zero-retention claim, human-review gate, geography policy or age gate is introduced. |
| D8 — bounded import assembly | Selected-unit chunks preserve identities and exact scoped raw values; one group per commit, with no server queue of later groups. Groups may span bounded previews. | Local fixtures now cover large pages, mixed sources and 102-unit families. P2 still needs actual D1 publication, erasure and reconciliation proof before freezing persistence. |

D1 is the only outstanding owner choice. D2–D7 are proposed implementation defaults; D8 is a technical proof obligation. If independent follow-up records are chosen, revise the schema, retention, export, erasure and UI tasks together. Reviewing this package does not record an answer to D1.

## Delivery sequence

1. **Freeze contracts and complete context privacy support.** Define revision-safe source identities, preview acknowledgement and complete export/erasure/restore support. Do not expose a grant-creation route that breaks existing export or deletion.
2. **Deliver context selection and control.** Eligibility, complete excerpt review, remove/revoke, conflict handling and explicit per-request acknowledgement. No generation is enabled by creating a grant.
3. **Deliver exact-parent follow-ups.** New versioned writer path, existing request lifecycle, bounded edition history, exact-parent navigation and independent continuity evaluation.
4. **Deliver portability.** Bounded adapters, encrypted preview, typed aliases, group-atomic commits, durable status/resume, imported-record rendering and lossless round trips.
5. **Integrate and qualify locally.** Full suites, privacy races, restoration, Paper/Evening browser matrix and a source-matched evidence package. Assess hosted migration/restore work separately.

Detailed implementation plans:

- [Selected context and exact-parent follow-ups](superpowers/plans/2026-11-01-milestone-3-continuity.md)
- [Legacy imports and portable round trips](superpowers/plans/2026-11-01-milestone-3-portability.md)

The two tracks share erasure, export and account snapshot infrastructure. Portability's parser/fixture work can proceed independently after contracts are frozen; its runtime integration follows the privacy foundations. Each task must preserve the already dirty checkout and use a scoped file allowlist or an isolated checkout containing the intended baseline.

| Work | Prerequisite | Independently reviewable result |
| --- | --- | --- |
| C1 → C2 → C3 | Current source baseline; D2–D7 frozen as contracts | Context bounds, complete context privacy support, preview UI and synthetic writer projection. Import families may remain disabled. |
| C4 → C5 | C1–C3; D1 resolved before C4 retention behavior | Exact-parent requests and continuity evidence. Live policy activation is separate from synthetic success. |
| P1 | Existing portable contracts; no continuity UI dependency | Versioned fixtures, pure adapters and the D8 transport/group proof. |
| P2 → P3 | P1 and C2 privacy integration points | Import persistence with complete lifecycle support, review/resume UI and exact reopening. |
| P4 | Both implemented tracks | One final source-matched verification package covering the integrated milestone. |

C2 owns context copies; P2 extends the same lifecycle to import copies. Neither task depends on the other being fully implemented before it can prove its own supported families. Finish source and evidence-document edits before the integrated full gate; its changing run receipts belong under `artifacts/`, which is excluded from source identity. A later documentation change also changes the source digest and needs a new gate for a source-matched claim. Never rewrite a passing receipt to match a different tree.

## Constraints to carry into every task

- Use Node 26, the existing lockfile and TypeScript/Hono/React/Vite/Zod/Cloudflare stack. No new library is required by this preparation.
- Keep same-origin sessions, CSRF, owner-scoped queries, authentication epochs, CAS, idempotency and account write fences. Cross-owner resources return 404 before decryption.
- Acknowledging storage, saving, importing, granting eligibility and consenting to one context request are separate actions. AI-off preserves owned read/edit/export/delete/import operations.
- Current ordinary body limit: 256 KiB. Import requests: 2 MiB for the serialized request body and the existing 200,000 UTF-16-code-unit document ceiling. These are separate checks; JSON escaping also consumes transport bytes. Normalized legacy record plus preserved exact JSON: 192 KiB UTF-8. D8 must prove how complete export pages up to 1 MiB fit through bounded chunks without truncation or loss of raw-record bytes.
- Account admission limit: 20 MiB, including encrypted UTF-8 bytes plus at least 1 KiB per owned row. Export: at most 100 records and 1 MiB per page; snapshot tickets last at most 60 minutes and may end sooner at an unsaved-record retention boundary. Import previews expire after 24 hours. Follow-ups: at most 50 per session under D1.
- Preserve full imported questions up to the existing 10,000 UTF-16-code-unit contract; history previews use at most 500 units without splitting a surrogate pair, with `questionTruncated`. Context excerpt limits use code points instead. Do not shorten stored questions to fit the native new-question form.
- Revisit revision identities must follow the implemented `AnyRevisit`/v2 revision contract; the older architecture statement that all revisits are immutable revision 1 is historical.
- Permissions and grants imported from an export are historical metadata only. They cannot restore live permission, ownership, credentials, keys, quotas or provider authorization.
- Reuse [Reflection's exact palette, fonts, components and theme behavior](design/reflection-system.md). Keep complete disclosures, underlined links, keyboard focus, forced colors and private drafts in memory.
- No automatic biography, history summarization, embeddings, reminders, new reading methods, subscriptions, provider change, legacy shutdown or deployment belongs to this preparation.

## Acceptance checklist

All unchecked items are future implementation evidence, not completed work.

| ID | Required proof | Owning plan/task |
| --- | --- | --- |
| M3-C01 / A06 | Complete server-derived preview; 3/1,200/3,000 code-point limits; keyed binding to exact request/revisions/ranges and acknowledgement; no unselected parent or history marker at egress; old Start retries keep their payload HMAC | Continuity C1–C3 |
| M3-C02 / A06 | Revoke before dispatch yields zero calls; revoke after dispatch prevents publication/future use without claiming retraction; missing snapshot and source supersession fail closed | Continuity C2/C4 |
| M3-P01 | Every new private copy is encrypted, counted, exported/redacted, rekeyed and erased; missing source rows do not skip surviving copies; stale restore does not resurrect them | Continuity C2; Portability P2 |
| M3-F01 / R10, A11 | Exact parent edition, reused basis/source snapshot, no redraw, no parent mutation, no implicit context; concurrent follow-ups receive distinct bounded edition numbers | Continuity C4 |
| M3-F02 / A11 | Parent A withdrawn while a request captures B blocks publication; old reflection/note revisions, deleted/unsaved parents and imported unknown-method parents are rejected accurately | Continuity C4 |
| M3-F03 | Quiet/disagree/changed-context/declined-sharing sequences meet the independently frozen continuity corpus; existing v1/v2 receipts remain readable | Continuity C3/C5 |
| M3-I01 / R11, A12 | Canonical/Tarot/versioned bounded Patternlike fixtures parse without writes or egress; unknown native Pixel format is rejected; invalid markup remains inert text | Portability P1 |
| M3-I02 / A12 | Stable native/exported identity across snapshots; same identity/content duplicates across chunks; own-account native records are reconciled; changed content needs a confirmed revision; erased entities need a confirmed new namespace | Portability P2 |
| M3-I03 / A12 | Large/mixed-source exports and groups spanning previews retain all selected records; group visibility is atomic; partial success, interruption, expiry and lost acknowledgement reconcile through status; no guessed parents or ownership | Portability P1–P3 |
| M3-I04 / A12 | 501-character and surrogate-boundary questions, authored revisions, missing dates/provenance, metadata and unavailable tombstones survive import → history → exact reopen → export | Portability P3/P4 |
| M3-U01 | Paper/Evening at 320/390/768/1280, keyboard, native Chromium zoom, supported forced colors, offline/conflict/session-expiry flows and no private browser persistence | Both UI tasks |
| M3-Q01 | Current full verification and cross-engine reports, no skipped/flaky cases, exact source and artifact hashes, migration compatibility and explicit local/hosted boundaries | Continuity C5; Portability P4 |

- [ ] D1 and the remaining proposed product/permission defaults are resolved in a reviewed implementation contract.
- [ ] D8 has a concrete bounded transport/group contract and passing adversarial fixtures before persistence implementation; format/version changes, if needed, are recorded explicitly.
- [ ] Every acceptance row has linked executed evidence, including adverse/race cases.
- [ ] Context/import creation is enabled only with complete export and erasure coverage.
- [ ] New continuity writer policy has independent qualification; prior v2 evaluation is not reused as proof.
- [ ] Native Pixel remains explicitly unsupported unless a verified adapter is separately added.
- [ ] Any revised schema/private-copy lifecycle has fresh local restore/rekey/accounting proof and a documented hosted rollout/restore requirement.
- [ ] `qualification/acceptance.json` retains honest statuses; local Milestone 3 completion does not assert production readiness.

## Reference precedence

The implemented source contracts and approved dated-note contract describe the current app. The [milestone roadmap](architecture/IMPLEMENTATION_PLAN.md), [generation specification](architecture/GENERATION.md), [migration specification](architecture/ASSETS_AND_MIGRATION.md), and [selected-context](design/selected-context.md), [follow-up](design/follow-up-readings.md), [import](design/legacy-imports.md) designs supply intended behavior. Resolve the conflicts recorded above explicitly; do not silently treat old design proposals or generated OpenAPI entries as working features. [Production acceptance](PRODUCTION_ACCEPTANCE.md) remains a separate evidence lane.

## Review record — 2026-11-02

The polish corrected six planning gaps: defaulting a new Start field could change old idempotency hashes; v1-parent support and parent egress were ambiguous; context/import lifecycle ownership was circular; native export identities were unstable; transport chunks were conflated with atomic import groups; and import status omitted an in-progress commit and post-expiry reconciliation. The plans now assign specific compatibility tests and implementation boundaries to each issue. Application code, frozen baseline receipts and production acceptance remain unchanged by this review.
