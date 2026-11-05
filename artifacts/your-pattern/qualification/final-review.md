# Fresh whole-branch review disposition

Review date: 2026-11-05. Reviewer: independent read-only Codex subagent (`qualification_final_review`), fresh context. Range: `ce9f21a7b6de07073906ff2e3b688bf655cde24e` through `3280bef98e6b67a1a5d9437f95606e835b3f9abd`.

The reviewer inspected calculation/interval bounds, civil time/input contracts, profile/admission/save transactions, migration, qualification harness/report, persistence/recovery, export/import and UI paths. No additional blocking application defect was found.

## Finding and resolution

**P2: Future JPL comparisons omitted from the qualification exit gate.** `scripts/qualify-pattern.ts` checked current/future Moshier, current JPL and interval results, but omitted `report.horizons.futureStress.passed`. A discrepancy in the 2050/2100 JPL corpus could therefore write a failed receipt while returning success.

Resolution: added the omitted predicate. Integration fault injection in an isolated directory added 1° to the 2050 Moon reference and updated that fixture's response hash. The unmodified runner returned exit 0 with `futureStress.passed=false`; the corrected runner returned exit 1. The repository's genuine JPL fixtures were never changed, and their positive run passed again. The retained hosted evidence remains valid because no application/calculation/hosted-harness source changed.

## Independently checked evidence

- All 541 final hosted bundle input hashes matched the reviewed checkout.
- Hosted summary evidence hashes, numerical runner hash and ten raw Horizons response hashes matched.
- The migration fixture contained the exact current 0021 migration SQL.
- Final hosted receipts contained 39 requests, the expected unauthorized 404 and 53 calculation parity checks.
- All 48 catalogue source hashes and the documented canonical release hash matched.

## Behaviors not independently certified and executor ruling

| Deferred certification | Reviewer rationale | Executor ruling |
| --- | --- | --- |
| Universal astronomical accuracy and the complete analytic enclosure derivation | Conservative implementation inspected; finite comparisons cannot prove universal correctness. | Retain explicit empirical/model-proof distinction; do not claim scientific certification. |
| Hosted CPU/heap capacity and full recovery acceptance | Receipts reviewed; no independent redeployment. Peak heap and distinct-account recovery remain unqualified. | Retain measured CPU/startup/request scope; full recovery remains a release gate. |
| Human editorial approval, physical devices and screen readers | Outside code review. | Remain pending and visible in the release checklist. |
| Full-suite runtime behavior during review | Parent owns final verification; reviewer was instructed not to start services. | Parent runs the final gate against frozen source. |

Verdict: suitable for continued **draft PR handoff** after the predicate fix and final checks. **Not production activation approval.** The single actionable code finding is resolved; all deferred certifications remain explicit.
