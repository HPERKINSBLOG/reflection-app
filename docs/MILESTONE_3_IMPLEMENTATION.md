# Milestone 3 implementation checkpoint

Scope: adopted C2/C3 context lifecycle and deliberate selection UI, plus P2 encrypted import persistence. This is local synthetic evidence; no hosted migration or live provider activation is included.

Foundations are published on main at c56ebcd. The implementation branch preserves the adopted C2/C3 work in a07e5fe and incorporates main in bdde1eb.

## Evidence

- C2/C3 takeover: 126 database tests, 151 domain tests and 8 selected-context browser tests passed after the final adopted source changes. TypeScript, build and source/schema checks passed.
- P2 initial focused local run: 117 tests across import service, privacy, migration, round trip, account rekey, stale restore, cleanup and accounting passed. Cases cover atomic publication of 102 readings across uploads, transactional rollback, seven-day outcomes, 24-hour raw expiry, typed identity forgery, AI-off import, explicit recovery, native and historical snapshot reconciliation, pending erasure fences and exact raw provenance.
- Further local checks cover native reconciliation of 100 authored revisions with a bounded D1 query count. Registry coverage is complete for 43 tables and 422 columns; SQL constraints and OpenAPI checks pass.
- Final independent review found five Important issues; regression tests now cover and pass withdrawal/restore redaction, foreign staged-copy erasure, incremental authored/session histories, exact portable raw conflicts and staging-overhead reclamation. The expanded focused suite passes 142 tests.
- The full browser run exposed a D1 expression-depth overflow in local photo recognition. Grouping existing publication-guard conjunctions fixes it without removing checks; 54 photo/context-privacy database tests, both reproducing browser cases and 26 SQL checks pass.
- Final branch review and the full gate are recorded in canonical verification artifacts. Changing run receipts remain under `artifacts/`; only a passing receipt with the same source digest establishes a full local gate.

## Persistence decisions

Migration 0021 follows adopted context migrations 0019 and 0020. Complete selected groups use one bounded D1 publication transaction; incomplete uploads never create saved records. Failed publication retains encrypted outcomes without partial target rows. The server never queues subsequent groups. Native reconciliation coalesces read checks into D1 batches.

New native exports use `native-v1` and immutable edition revision 1; authored revisions retain their actual numbers. Existing imported and declared historical snapshot identities remain aliases. Imported permissions, grants and receipts remain historical metadata with no live authority. Exact independently selected legacy authored provenance uses an optional portable reflection field.

Copy provenance survives missing primary rows. Logical deletion fences pending copy reads before independent ledger completion; physical erasure removes raw previews, outcomes, aliases and materialized content. Account-key rotation covers all new encrypted fields; restore cancels unfinished imports without generation dispatch.

## Remaining work

C4/C5 own continuity dispatch/publication and final journeys. P3/P4 own import review, selection, cancellation/resume UI and user-facing migration qualification. The multi-group commit endpoint remains disabled. Hosted latency/limits, deployment and live-provider qualification require separate evidence; local D1 tests do not establish those results.
