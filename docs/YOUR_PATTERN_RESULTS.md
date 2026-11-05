# Your Pattern local acceptance

Date: 2026-11-05. Branch: `codex/your-pattern`. Implementation starts at `a30a278`; the first complete desktop/mobile flow is `eba4eca`. Review and visual fixes follow in `3866e37` and `f24297b`. The final gate receipt records the complete source digest; acceptance requires its `passed` status to match the checkout. This record covers local behavior and does not authorize hosted activation.

## Delivered behavior

The local preview supports birth setup → calculated chapter → optional own reflection → atomic save → exact shared-journal reopening → dated revisit. Paper and Evening use the existing design system on desktop and mobile. A profile change never recalculates or rewrites a saved chapter.

- Birthplace search uses pinned GeoNames data, with duplicate-name disambiguation and manual coordinates/IANA zone entry. Exact time supports seconds, explicit clock-fold selection and gap rejection. Approximate time retains the complete UTC interval union; unknown time retains the full local day. Dates before 1970 require historical-zone confirmation.
- Self, Connection, Rest and Growth use supported Sun, Venus, Saturn and Jupiter signs. Unqualified placements are suppressed; unsaved own writing remains accessible even when a refreshed chapter becomes unavailable. There are no houses, angles, nodes, aspects or transit claims.
- Profile retention is explicit. Native Pattern editions, original bases, writing and revisits use the existing encrypted owner-scoped lifecycle. Save retries preserve the committed identity; stale profiles/releases and duplicate writing require explicit reconciliation. A chapter can be saved without writing.
- Journal method filters run before keyset pagination. Imported snapshots remain historical and appear under Imported. Pattern own-writing excerpts use the existing explicit context-grant controls; native Pattern and imported editions cannot authorize tarot follow-ups. The tarot handoff transfers only the selected question.
- Removing the current profile preserves saved originals until their readings are deleted separately. Account deletion removes both. Exports use the new v2 envelope while v1 remains frozen. Imported birth profiles are memory-only restoration candidates until explicitly reviewed and retained.

## Verification

Focused tests pass for contracts, timezone conversion, bounded calculation, content identity, populated migration safety, export/import, deletion/restore/rekey/accounting, atomic save races and mixed-method pagination. The focused Chromium suite covers 12 journeys, including second-level input, writing retained under suppression and navigation blocked during a profile save. The full Pattern sign-out/sign-in/profile-change/revisit flow passed in Chromium, Firefox and WebKit against real local services with AI off.

The final acceptance commands run with `TMPDIR=/home/htper/.cache/pattern-tmp` on this host. Both runners reject skipped/flaky cases; the main gate binds its result to the complete source digest and a 540-second Linux deadline.

| Command / suite | Executed coverage | Evidence |
| --- | --- | --- |
| `npm run verify` | 14 stages: lint, strict types, schemas, publication guards, contracts, private inventory, SQL, OpenAPI, tests, builds and package links | [Source-matched gate receipt](../artifacts/verify.json) |
| Domain/tooling stage | 472 tests across 64 files | [Domain report](../artifacts/domain-tests.json) |
| Workerd/D1 stage | 652 tests across 70 files | [Database report](../artifacts/db-tests.json) |
| Chromium stage | 176 tests, including 12 focused Pattern/journal cases | [Browser report](../artifacts/browser-tests.json) |
| `npm run test:journey -- --workers=2` | 39 Chromium/Firefox/WebKit journeys, including native zoom and supported forced-color combinations | [Cross-browser report](../artifacts/visual-pass/browser-matrix.json) |

Receipt status is authoritative; a partial or failed run does not establish acceptance. Personal data is synthetic throughout these tests. The eight-core host uses four Chromium file workers for the main gate and two for the cross-browser matrix; the isolated database pool remains bounded at two workers. [Compiled bundle evidence](../artifacts/your-pattern/bundle-evidence.json) binds actual Worker/client hashes, confirms the bundled ESM and full timezone source hashes, and checks public-data/catalogue markers are on the Worker rather than in the browser. The Worker is 9,461,168 bytes uncompressed (5,011,170 bytes with the receipt's standard gzip); this is a measured build, not a hosted resource qualification.

The shared display fixture now includes birth entry, review, chapter writing, save confirmation, exact saved reopening and revisit at 320/390/768/1280 CSS pixels. It runs in both themes, native Chromium 200% page zoom and Chromium/Firefox forced colors. Linux WebKit cannot qualify the actual forced-color palette and remains excluded from that existing matrix; this is not a claim of physical-device or screen-reader acceptance.

## Pinned identities

- Astronomy Engine 2.1.19 ESM SHA-256: `068f1445ed0c636c94818fe6d20d7d125120e605e0bab9fc4675c3d531be5ad7`.
- moment-timezone 0.6.6 / moment 2.31.0, full IANA 2026f SHA-256: `3103c5c0eaa879615da630b74e2373ad9b571e0eae992e0b2a3db6e4475de2ce`.
- Adapter `natal.v2.1`; reliability `vsop-vector-enclosure.v1`, hash `7a8be427e640a50501790253ff9d50785e2d33716f49f090f464f801975a4251`. Up to 2,048 evaluated instants per calculation, 0.05° minimum guard, output normalized only after classification. Uncertain-time Moon/Pluto remain suppressed because their interval bounds are not qualified.
- Gazetteer decompressed artifact SHA-256: `bd97a7bc246eb7d22390a11e9d01aad1cae4b14dcb8539d02bd9ceebbda889f0`; source hashes/attribution in `content/astrology/places-manifest.json`. Gzip/base64 public-data chunks are lazily decompressed and verified on the Worker.
- Local 48-entry chapter catalogue canonical release SHA-256: `3a730caeb64a87cacc981f55df0558164bbe5ff77b00257d778d0045dae73e11`. [Exact editorial review packet](content-review/2026-11-05-pattern-catalogue.md).

## Review and operational limits

A fresh read-only reviewer inspected the completed implementation. The real-import journal regression was reproduced and fixed by setting imported family methods explicitly. Browser input now exposes seconds, and unavailable chapters retain visible own-writing drafts. Cross-browser evidence also led to focusing headings after React commits the destination screen. The final visual pass added label-fit assertions at all four widths and removed an obsolete lazy illustration from the visually hidden workspace heading. A held-response regression verifies that navigation cannot offer to discard a profile while its save is in flight. WebKit also exposed a delayed password-screen focus callback that could interrupt the first field's input. A deterministic held-frame regression reproduced it; password-screen focus now runs during the layout commit, and the account-return journey passed three consecutive WebKit runs before final acceptance.

Production activation remains closed. Local calculations and sampled independent fixtures do not establish universal accuracy, a hosted CPU/concurrency budget or editorial approval. Independent numerical/uncertainty qualification across the supported range, review of the exact catalogue and hosted resource/acceptance work remain required. No live writer qualification, deployment or production acceptance is claimed.

Acceptance uses a short disk-backed `TMPDIR` (`/home/htper/.cache/pattern-tmp` on this host). The system `/tmp` is a nearly full 7.9 GiB tmpfs; a long worktree-local temporary path also exceeds Chromium’s Unix socket path limit. These are runner constraints; test cases, timeouts and safety checks are unchanged.

The expanded full gate exhausted its 540-second deadline with two Chromium workers after passing all domain/database tests and 130 browser cases. On Linux hosts with at least eight CPUs, the main gate now uses four isolated browser file workers; four-CPU hosts retain two. The deadline, assertions, coverage and no-skip/no-flake requirements remain unchanged. Tracing a later deletion-race timeout showed that its focus event overlapped the independent parent refresh after note saving, so no simulated deletion occurred. That test now waits for the parent refresh to settle before installing its race; the deletion and clearing assertions are unchanged, and two concurrent focused runs passed. The 39-case cross-browser matrix passed on `ad88548`; only main-gate concurrency, this separate deletion-test readiness check and delivery documentation changed afterward.

The Cloudflare/Vitest warm-module optimization exceeded its transport frame limit with the expanded public dataset. The test pool falls back to individual module fetches with per-file isolation preserved; it does not omit source modules or tests. The gazetteer compression changes packaging, not its pinned logical data identity.

Timing, Time Travel, standalone journal notes, full-text/date controls and activity ordering remain later work in the [merger implementation map](design/merger-implementation-map.md).

## Implementation decisions

| Decision | Reason and tradeoff |
| --- | --- |
| Expected profile revision belongs to the write envelope, outside `BirthDraft`. | Concurrency metadata must not change normalized birth identity. Callers must explicitly carry the current revision; stale writes are rejected. |
| Astrology schemas define local primitive validators rather than importing the live index. | Avoids a module cycle when the reading union gains Pattern. Contract checks guard against validator drift. |
| Uncertain-time Moon and Pluto are suppressed. | Their algorithms are outside the analytic VSOP interval certificate. This deliberately reduces displayed information rather than presenting an unqualified sign. |
| Normalize output to 1e-9 degrees only after placement decisions; round deviation outward. | Removes observed Node/workerd differences around 1e-14 degrees from semantic hashes. Display/output precision is reduced without rounding inputs to classification. |
| Profile deletion retains an ID/revision tombstone with no body or key version. | Prevents revision reuse and old deletion replay from removing a replacement profile. Minimal identity metadata remains; saved bases have their own deletion scope. |
| Freeze v1 portability and introduce native v2 separately. | Protects old consumers and exported records. The importer must support both versions and cannot grant new native authority to historical records. |
| Treat imported birth profiles as memory-only restoration candidates. | Prevents silent profile replacement and a second staged-data lifecycle. The reader must review and explicitly retain the candidate. |
| Disable new Pattern writes after offline restoration. | Saved access follows verified public-content availability, while new calculations require a separately authorized state. A restored service cannot silently reactivate publication. |
| Compress and lazily verify the public gazetteer; fetch test modules individually. | Preserves the pinned logical dataset and isolated tests within the tooling transport limit. First-search memory/latency and the larger Worker still need hosted qualification. |

All actionable final-review findings were addressed; no source-code minor was deferred. Production qualification and the remaining merger features are explicit scope limits, not implied approvals.
