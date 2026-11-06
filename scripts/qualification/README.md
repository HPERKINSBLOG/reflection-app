# Your Pattern qualification tools

These tools run synthetic release checks; they never enable hosted Pattern publication.

## Numerical and editorial

Use Node 26 and the repository's pinned dependencies. Keep research-only `sweph@2.10.3-7` outside this repository, as described in `docs/architecture/ASTROLOGY_FOUNDATION.md`.

```sh
python3 scripts/qualification/fetch-horizons.py
npx tsx scripts/qualify-pattern.ts /path/to/research-dependencies artifacts/your-pattern/qualification/numerical.json
```

The fetcher refreshes public JPL responses, with exact query and response hashes. For a deterministic replay of the retained corpus, omit the fetch step. The runner checks explicit Moshier flags, adapter results, supported interval outputs and the fixed 0.05° threshold. Its current/future split is fixed at 2026-11-05; advancing it requires a new qualification receipt. Five-minute samples check the analytic enclosure's output but are not themselves an interval proof.

Review every entry in `docs/content-review/2026-11-05-pattern-catalogue.md`; the agent assessment is separate from human approval. Use the exact-hash signing contract in `scripts/pattern-content-activate.ts` after human review. Do not use a synthetic release as hosted authorization.

## Protected hosted benchmark

```sh
npx tsx scripts/qualification/build.ts /private/qualification-output
```

The output directory contains a mode-0600 random authorization value, the minified module, compressed transport copy and a receipt of every bundled input hash. Deploy the exact `worker.js` to a **new** Worker named `reflection-pattern-qualification-...` using metadata equivalent to `artifacts/your-pattern/qualification/hosted-deployment.json`: module syntax, compatibility date 2026-10-23, `nodejs_compat`, 30,000 ms CPU, invocation logs enabled, and a `TOKEN_SHA256` binding containing the receipt's hash. Never bind the token itself as a public variable. Enable only that Worker's workers.dev subdomain and disable preview URLs.

The connected Cloudflare API supports multipart module upload. For large payloads exceeding its 4 MiB request envelope, stage compressed public-code chunks in a **new temporary KV namespace**, read those chunks inside the connector, decompress, verify the bundle SHA-256, then upload. The 2026-11-05 run used this path because the local Wrangler CLI was unauthenticated. Temporary transfer storage contains public code only and must be deleted after the upload/checks.

After deployment propagation settles:

```sh
npx tsx scripts/qualification/probe.ts https://reflection-pattern-qualification-NAME.lfd.workers.dev /private/qualification-output/authorization artifacts/your-pattern/qualification/hosted-final-requests.json
```

The probe verifies denial without the token, exact hosted/Node result parity, uncertainty ceilings, place-result bounds and concurrency at 4/8/16. A failed request fails the run and preserves partial evidence. Preserve propagation failures separately before rerunning; never erase them from the record. Fetch invocation telemetry scoped to the exact script name, version and time window. Retain only timestamp/request ID, outcome, CPU/wall milliseconds, version, HTTP status and path; omit headers, IP addresses and authorization data. In-Worker timers cannot establish CPU duration.

## Populated migration rehearsal

Create a **new** unbound D1 database. Apply the repository's migration SQL files in order through 0020 using the D1 API's multi-statement batch operation. No application writer should access this database.

```sh
npx tsx scripts/qualification/prepare-d1.ts /private/qualification-output/migration-fixture.json
```

Run the exact exported function in `d1-rehearsal.js` with that fixture and a `query(body)` adapter returning the D1 query API's `result` array. Both `{sql,params}` and `{batch:[{sql,params},...]}` are used. The fixture uses the established local seed helpers and the actual 0021 migration bytes. The function checks rollback after an injected failure, original fields/accounting, imported-family identity, Pattern owner/basis/content constraints, foreign keys and disabled publication. This is a byte/schema rehearsal with marked placeholder ciphertext, not full account recovery.

Delete the temporary Worker, D1 and any transfer namespace after collecting receipts; verify each is absent and remove the local authorization value. Never use the existing preview database or R2 bucket. Full hosted recovery needs a distinct account and the existing `hosted-release.ts` / `hosted-qualify.ts` authorization and coordinator gates; this same-account harness is not a replacement for them.
