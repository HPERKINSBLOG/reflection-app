# Milestone 3 completion checklist

**Start with C2.** Dated revisit notes are implemented. The C1 context contracts and P1 import parsers passed local verification. The owner settled follow-up retention on November 3, 2026. The work below covers the remaining local implementation and acceptance tests. [Foundation results](MILESTONE_3_FOUNDATIONS.md) · [Decision register](MILESTONE_3_PREPARATION.md#decisions-and-proposed-defaults)

**Work order.** Build C2, then C3, C4, and C5. The import track (P2, then P3) can proceed once C2 establishes how export, deletion, and restore handle private copies. Integrate changes to those shared services in sequence. P4 verifies both tracks together. Check off an item when its implementation and passing evidence are available. [Delivery dependencies](MILESTONE_3_PREPARATION.md#delivery-sequence)

## C2 · Make excerpt permissions safe to use

- [x] **Review the remaining contract defaults.** The [decision register](MILESTONE_3_PREPARATION.md#decisions-and-proposed-defaults) maps D2–D7 to the context, writer, and import contracts and records the confirmed family save and deletion rule.
- [x] **Build grant, list, revoke, and preview operations.** Start with `tests/db/context-grants.test.ts` and `tests/db/context-privacy.test.ts`. A preview must use the signed-in reader’s exact reading, reflection, or revisit-note revision and make zero provider calls. Bind confirmation to the request, permission revision, and selected ranges. Test stale, forged, duplicate, and cross-account requests.
- [x] **Prove export and erasure before opening those routes.** Encrypt and count every retained excerpt, including copies in requests and receipts. Test paginated export, key rotation, deletion at capacity, a missing source row, and replay of a stale backup. Revoking permission blocks future use. Erasing the source removes retained private copies.

**Checkpoint.** Run the two focused database suites with `npm run test:db -- tests/db/context-grants.test.ts tests/db/context-privacy.test.ts`, then `npm run restore:rehearse` and `npm run cleanup:rehearse`. Covers M3-C01, M3-C02, and M3-P01. [C2 implementation details](superpowers/plans/2026-11-01-milestone-3-continuity.md#c2--complete-grantpreview-and-private-copy-lifecycle-support)

## C3 · Let readers choose exactly what to share

- [x] **Build the excerpt picker and submission preview.** Start with an empty selection. Show the source, revision, exact text, recipient, and retention notice. Let readers remove excerpts and revoke permission. Require confirmation for each submission and a fresh preview after a change. Enforce a maximum of three distinct sources, 1,200 Unicode code points per excerpt and 3,000 total.
- [x] **Implement the versioned continuity writer.** Inspect the outgoing test payload to prove that only the current question, eligible draw and meanings, and explicitly chosen excerpts reach the writer. Test hostile excerpt text, missing sources, and an over-budget request. Verify that earlier v1/v2 readings still reopen exactly.

**Checkpoint.** Run the continuity-writer domain tests and the selected-context browser journey. Verify that editing a selected note invalidates the old confirmation. Covers M3-C01 and M3-F03. [C3 implementation details](superpowers/plans/2026-11-01-milestone-3-continuity.md#c3--add-the-continuity-projection-and-deliberate-context-ui)

## C4 · Deliver follow-ups on a saved reading

- [x] **Start from the exact saved edition.** Reuse its draw and original source snapshot. Show “No new draw,” the parent question, and a link back to that edition. Test eligible v1/v2 parents and reject deleted, unsaved, cross-account, and unverified imported parents. Verify that the original text stays intact, simultaneous follow-ups receive distinct edition numbers, retries reuse the request, and the 51st follow-up is rejected.
- [x] **Test changes during generation.** Revocation before dispatch must prevent the provider call. Revocation after dispatch or withdrawal of the parent’s source must block publication, even if the new request’s source is still eligible. Exercise cancellation, loss of the start acknowledgement, and resuming a pending request before it has an edition ID.
- [x] **Prove the shared save and delete rule.** Create an original, a follow-up, and a follow-up to that follow-up. Sign back in with AI off and reopen all three without a second Save. Delete the original once. Check history, direct links, a fresh export, and a restored backup for all three. Verify that an in-flight follow-up cannot reappear and an unrelated reading still opens.

**Checkpoint.** Exercise the real follow-up request, history, and deletion paths in database and browser tests. Covers M3-C02, M3-F01, M3-F02, and M3-F04. [Follow-up acceptance cases](design/follow-up-readings.md#acceptance)

## C5 · Qualify the continuity writer

- [x] **Evaluate the v3 policy against independent cases.** Freeze the test cases and policy version before evaluation. Cover disagreement, changed circumstances, declining to share, hostile excerpts, and unavailable parents. Link the results to the exact policy and inputs. Keep live dispatch disabled until its separately authorized provider evaluation passes.
- [x] **Exercise the existing reading journey alongside follow-ups.** Verify that save, sign-in, recovery, reflection editing, and dated notes still work with AI off. Add selected-context and follow-up states to the shared browser suite for P4.

**Checkpoint.** Record which checks used a synthetic writer and which used a live provider. Covers M3-F03 and M3-U01. [C5 qualification plan](superpowers/plans/2026-11-01-milestone-3-continuity.md#c5--qualify-continuity-and-preserve-existing-journeys)

## P2 · Persist imports and recover interrupted work

- [x] **Close D8 with a local Cloudflare D1 database test before freezing persistence.** Use the 102-unit import fixture across multiple previews. Interrupt publication and prove that readers see either the complete selected group or none of it. Separately, erase an independently imported child record and verify that its raw copies disappear while its imported parent remains readable.
- [x] **Implement encrypted preview, commit, and status.** Publish one confirmed group per submission. Test a lost acknowledgement, cancellation between groups, and 24-hour preview expiry. Retrying must report what already committed and preserve earlier successful groups.
- [x] **Make identities stable across exports.** Reimport overlapping exports after an unrelated account edit. Unchanged records must deduplicate, changed content must prompt for a new source revision, and recreating an erased record must require a confirmed new namespace. Cover older `snapshot-*` exports and reconcile records already owned by the reader.
- [x] **Complete the import data lifecycle before enabling writes.** Exercise storage limits, export, key rotation, and erasure across preview, staging, committed content, and aliases. Restore an older backup and verify that erased text stays gone and imported permissions remain historical.

**Checkpoint.** Pass the migration, import-service, restore, and cleanup suites against local D1. Covers M3-P01, M3-I02, and M3-I03. [P2 implementation details](superpowers/plans/2026-11-01-milestone-3-portability.md#p2--add-encrypted-preview-atomic-commit-and-complete-lifecycle-support)

## P3 · Let readers review imports and reopen them

- [x] **Build file review, confirmation, and resume.** Show the proposed records, dependencies, duplicates, conflicts, and unsupported formats before committing. Exercise canonical imports and exports, Tarot journals, and supported Patternlike 0.7.0/0.8.0 files. Show native Pixel files as unsupported. Resume using the original import ID after an interruption.
- [x] **Render imported readings faithfully.** Keep authorship, source information, original timestamps, and unavailable material distinguishable. Display imported markup as text. With AI off, verify import, history, exact reopen, export, and deletion. Test that private drafts stay out of browser storage.

**Checkpoint.** Run the import browser journey and reuse the passing P1 fixture evidence for M3-I01. Covers M3-I03, M3-I04, and M3-U01. [P3 implementation details](superpowers/plans/2026-11-01-milestone-3-portability.md#p3--build-import-review-reconciliation-and-exact-imported-record-return)

## P4 · Verify the integrated milestone

- [x] **Prove a lossless round trip.** Import, find the record in history, reopen it, export, and reimport. Use a 501-character question and an emoji at the history-preview boundary. Compare the full question, identities, authored revisions, missing provenance, and deletion records at the end. An unchanged reimport must create zero duplicates.
- [x] **Run accessibility and interruption checks across both tracks.** Exercise Paper and Evening at 320, 390, 768, and 1280 px in Chromium, Firefox, and WebKit. Include keyboard and focus behavior, native Chromium 200% zoom, supported forced colors, offline recovery, conflicts, and session expiry.
- [x] **Assemble the evidence.** Create `docs/MILESTONE_3_RESULTS.md` and link an executed test or report to each of the 13 acceptance rows, including P1’s adapter coverage. Update the restore runbook with migration, erasure, and key-rotation results and identify any hosted follow-through. Keep production acceptance and live-provider status separately visible. [Acceptance rows](MILESTONE_3_PREPARATION.md#acceptance-checklist)
- [x] **Pass the final checks on the same source.** Run `npm run verify`, then `npm run test:journey` sequentially. Record commands, test counts, source digest, and report hashes under `artifacts/`. Every expected check must execute with zero skipped or flaky cases. If checking off this file or editing the results changes the source digest, rerun the final checks before declaring completion.

**Milestone complete when** both tracks have passing evidence on the final source and every acceptance row is accounted for, including M3-I04, M3-U01, and M3-Q01. [P4 verification plan](superpowers/plans/2026-11-01-milestone-3-portability.md#p4--qualify-round-trips-restoration-and-integrated-milestone-behavior)
