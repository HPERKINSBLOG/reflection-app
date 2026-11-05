# Your Pattern qualification

Date: 2026-11-05. This supplements [local acceptance](YOUR_PATTERN_RESULTS.md) and [PR #11](https://github.com/HPERKINSBLOG/reflection-app/pull/11). Calculation/reference checks, agent editorial review, a protected hosted resource benchmark and a populated hosted migration rehearsal are complete. **The PR remains draft and production activation remains closed.**

## Numerical evidence

The reproducible runner exercises the actual adapter, not a reimplementation of it. Swiss Ephemeris remains an isolated research dependency; no Swiss code or data was added to the application's package, lockfile or bundle. The independent references and comparison conventions are recorded in the [numerical receipt](../artifacts/your-pattern/qualification/numerical.json). Raw JPL responses and their request/hash manifests are retained alongside it.

| Check | Coverage | Result |
| --- | --- | --- |
| Swiss Ephemeris 2.10.03, explicit Moshier | 15,220 body/epoch comparisons, monthly 1900 through October 2026 | Maximum difference 0.005660°; all below the predeclared 0.05° threshold |
| JPL Horizons | 110 comparisons across eleven epochs, 1900–2026 | Maximum difference 0.004799°; all below 0.05° |
| Future model stress | 8,900 additional Moshier comparisons through 2100; 20 JPL comparisons at 2050/2100 | Maxima 0.019238° / 0.021834°; future dates are not currently admitted birth dates |
| Uncertain-time corpus | 91 cases, 681 supported placements, 192,409 independent samples at intervals of at most five minutes | No supported-sign disagreement or sampled model-enclosure violation |
| Boundary/turn selection | 53 events selected by the independent reference, including retrograde turns and zero-wrap boundaries | Exact cusp placements suppressed; complete-day interval outputs checked |
| Civil-time cases | 23/25-hour days, disconnected one-hour and half-hour folds, historical second offset, quarter-hour zone | Complete UTC unions checked; Moon/Pluto remained suppressed for uncertain times |
| Calculation ceiling | Three current-range cases reached 2,048 unique instants | Ceiling preserved and exhausted placements suppressed |

JPL quantity 31 reports apparent geocentric IAU76/80 ecliptic-of-date longitude, including gravitational deflection. Its UT convention is UT1 before 1962 and UTC afterward; future UTC uses the last known leap-second. The adapter uses its pinned frame and delta-T model, so the comparison includes these convention differences. See the [JPL quantity definition](https://ssd.jpl.nasa.gov/horizons/manual.html#obsquan) and [API time-list documentation](https://ssd-api.jpl.nasa.gov/doc/horizons.html#tlist-parameter).

These finite comparisons are empirical evidence, not a universal physical-error proof. The [analytic enclosure](architecture/ASTROLOGY_UNCERTAINTY.md) separately bounds the pinned engine model. The 0.05° guard and uncertainty policy have not been relaxed, and no new houses, aspects or transit claims were introduced.

## Catalogue review

All 48 titles, paragraphs and prompts received an [entry-by-entry agent assessment](content-review/2026-11-05-pattern-editorial-assessment.md). No blocking editorial changes were found and no text changed. The exact release hash remains `3a730caeb64a87cacc981f55df0558164bbe5ff77b00257d778d0045dae73e11`.

The [full packet](content-review/2026-11-05-pattern-catalogue.md) still requires human approval. The signed release contract binds that hash, a named reviewer and a review timestamp. A general approval to proceed with the project is not recorded as an exact-catalogue content signature.

## Hosted resource evidence

A temporary token-protected Worker imported the production router and exercised the actual calculation and lazy gazetteer modules through fixed synthetic cases. It exposed no application routes, account data, provider credentials or arbitrary calculation input. The final minified harness was 8,216,448 bytes, gzip 4,859,441, SHA-256 `319db3877ee339ac1fc7c6784480cf337224983f69d38fdf9e390d8da63700d6`. [Build inputs](../artifacts/your-pattern/qualification/hosted-final-build.json) and [deployment metadata](../artifacts/your-pattern/qualification/hosted-deployment.json) bind the code and configuration. This is a qualification harness, not the final application deployment artifact.

- Final version `a5e7f5e8-657c-4c76-8eb8-f954082a4bda`: **75 ms startup**, 30,000 ms CPU ceiling.
- **38 authorized requests passed**, plus one unauthorized request correctly returned 404. Concurrency groups of 4, 8 and 16 passed. All **53 hosted calculation results matched Node exactly**; the three selected worst-case fixtures reached 2,048 instants.
- All 39 invocation-log outcomes were `ok`. Maximum measured CPU was **1,616 ms** and Worker wall time **1,749 ms**. Budget-exhaustion calculations used at most **145 ms CPU**. Highest client elapsed time was **2,143 ms**.
- Cold place loading remains material: the final place-only samples used up to **1,140 ms CPU**; subsequent place-only samples went as low as 12 ms. No peak-heap measurement is available. Absence of resource errors in this corpus is not a general memory or traffic-capacity guarantee.
- An earlier deployment's propagation period returned 404 for 14 authorized requests; these are preserved in [propagation evidence](../artifacts/your-pattern/qualification/hosted-propagation.json), not counted as successful application invocations. A settled preliminary run and the final run passed. Preliminary maximum CPU was 2,010 ms; final figures above include the added budget-exhaustion cases.

The current platform documents a 64 MiB uncompressed script limit, 128 MiB isolate memory limit and a one-second startup limit. CPU and wall time were taken from Cloudflare invocation logs, not in-Worker `performance.now()`. This evidence supports the configured paid CPU ceiling; it does not qualify the 10 ms Free-tier allowance. [Worker limits](https://developers.cloudflare.com/workers/platform/limits/), [timer behavior](https://developers.cloudflare.com/workers/runtime-apis/performance/).

The complete [final request receipt](../artifacts/your-pattern/qualification/hosted-final-requests.json) and [sanitized invocation metrics](../artifacts/your-pattern/qualification/hosted-final-metrics.json) contain no authorization values, IP addresses or request headers.

## Hosted migration and recovery boundary

A new D1 database was migrated through 0020 and populated with a three-edition tarot family, imported and withdrawn families, original writing, revisits, grants, generation records and import provenance. An injected failure after dropping `reading_editions` rolled back all original rows, accounting and new schema. The successful 0021 migration preserved every original field across ten tables and both account storage totals. Seven invalid Pattern associations/method changes were rejected, a valid Pattern edition was inserted, and foreign-key checks remained empty. Pattern publication stayed disabled. [Migration receipt](../artifacts/your-pattern/qualification/hosted-migration.json).

This uses marked synthetic placeholder ciphertext to prove byte preservation. It does not substitute for encryption, account-recovery or deletion-replay qualification. Those lifecycles passed the local Workerd/D1 tests; full hosted recovery scenarios remain pending.

Only one Cloudflare account was available. `validateHostedTarget` in `scripts/hosted-release.ts` requires the hosted target and its isolation peers to have distinct account IDs. A new database in the same account does not satisfy that gate. The protected resource/migration rehearsal above is deliberately reported separately; no target validator or restore coordinator was bypassed.

The temporary Worker, D1 database and transfer KV namespace were deleted and their absence verified through separate GET requests. The local benchmark token was removed. [Cleanup receipt](../artifacts/your-pattern/qualification/hosted-cleanup.json). Existing `reflection-preview` resources and credentials were not changed.

## Remaining release work

1. A human reviews and approves the exact catalogue packet, with the trusted signing-key configuration required by `pattern-content-activate.ts`.
2. Provision/connect a distinct hosted-synthetic account and configure the existing runtime, recovery coordinator and backup inventory. Run the protected batch rollback, request races, scheduler crash, stale restore, recovery loss and key-lifecycle scenarios with evidence bound to the actual application artifact.
3. Implement qualified hosted Pattern release admission. `src/worker/astrology/patterns.ts` currently permits synthetic-local content only; an approved catalogue alone does not activate hosted calculations. Preserve content/calculation hashes, stop switches and disabled publication after restore.
4. Review the controlled application preview on physical devices and with a screen reader, then make the merge/activation decision. Playwright emulation does not establish these checks.

No production deployment, live-provider acceptance, physical-device acceptance or human catalogue approval is claimed by this report. Timing and Time Travel remain later product work.
