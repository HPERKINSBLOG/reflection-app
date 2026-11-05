# Astrology calculation foundation

Decision date: 2026-11-05. Status: **selected for implementation; bounded local probe passed; application integration and full qualification remain open**.

This records an engineering choice under the owner's approval to map the completed designs and define the calculation foundation. It does not attribute a new AGPL decision, a license purchase, or production approval to the owner.

## Decision

Use **Astronomy Engine 2.1.19** for the first Your Pattern slice, behind a small server-side calculation adapter. Use **moment-timezone 0.6.6**, with **moment 2.31.0** and the complete **IANA 2026f** dataset, for reproducible civil-time conversion. Pin all three runtime packages exactly when implementing the adapter. Keep calculation code and timezone data out of the browser bundle.

The first slice needs stable tropical placements for Self (Sun), Connection (Venus), Rest (Saturn), and Growth (Jupiter). It does not need an LLM or a native calculation service. The selected engine provides all ten bodies in Reflection's reserved contract. Its JavaScript distribution ran in local workerd without a native addon or Node compatibility flag.

This is a new engine identity. Preserve old imported readings and their original provenance. Do not relabel a Swiss or Pixel calculation, regenerate old text, or claim numerical identity between engines. Houses, angles, nodes, aspects in chapter prose, and transit windows are outside this first slice. The reserved whole-sign preference remains a future capability; the new input contract must say `houses: 'not_calculated'` until a qualified implementation exists.

## Alternatives considered

| Approach | Evidence and tradeoff | Disposition |
| --- | --- | --- |
| Reuse Patternlike's Swiss service | Existing native engine, uncertainty tests, ephemeris manifest and calculation boundary. Uses Placidus with Porphyry fallback, unlike Reflection's reserved whole-sign preference. Adds a service and requires a Reflection-specific license/source-offer decision. | Keep as a later alternative if required precision or chart features justify it. No source or binary imported into Reflection. |
| Astronomy Engine in the Worker | MIT runtime, ten required bodies, no separate service, pinned model identity. Requires new adapter, uncertainty qualification and deliberate omission of unsupported chart features. | Selected for Your Pattern. |
| Reuse Pixel's `kepler-approx` engine | Small analytical engine, useful typed-fact separation, but explicitly approximate and not an interchangeable replacement for Swiss calculations. | Reference only; do not adopt as the calculation authority. |

Patternlike's [recorded owner decision](https://github.com/henryperkins/patternlike-app/blob/b84c4aa09384a668f4dcc74256d43d5192139911/docs/legal/SWISS_EPHEMERIS_LICENSE_DECISION.md) selects AGPL for that product. It explicitly leaves other repository areas and the combined-work boundary unresolved. Reflection's earlier manifest correctly did not inherit that decision. Selecting a different MIT runtime settles the engine choice for this slice without changing either project's license.

## Dependency and data inventory

| Item | Version / license evidence | Use |
| --- | --- | --- |
| Astronomy Engine | 2.1.19; [MIT](https://github.com/cosinekitty/astronomy/blob/master/LICENSE); [package metadata](https://github.com/cosinekitty/astronomy/blob/master/source/js/package.json) | Planetary models embedded in the runtime artifact. Include copyright and license in distributions. |
| moment-timezone | 0.6.6; MIT in installed package | Access to pinned transition tables, not its default ambiguity-resolving parser. |
| moment | 2.31.0; MIT in installed package | Required runtime dependency; pin explicitly rather than accepting an unrecorded transitive upgrade. |
| IANA timezone data | 2026f; [upstream release](https://www.iana.org/time-zones/releases/2026f) | Full historical dataset, not the ten-year browser subset. Preserve data notices and a byte hash. |
| GeoNames gazetteer | Proposed pinned `cities15000` plus administrative labels; [CC BY 4.0 and field definitions](https://download.geonames.org/export/dump/readme.txt) | First-party birthplace selection. Acquisition, byte hashes, attribution and coverage tests are implementation work; no dataset is bundled yet. |
| Swiss reference | sweph 2.10.3-7 / Swiss Ephemeris 2.10.03, explicit Moshier mode | Isolated local research dependency only. Absent from Reflection's package manifest, lockfile and Worker bundle. Its license is not inherited by the selected runtime. |

The [Swiss publisher](https://www.astro.com/swisseph/swisseph.htm) describes its two licensing paths; the [binding maintainer](https://github.com/timotejroiko/sweph) separately documents its terms. Neither public source availability nor a process boundary is a substitute for reviewing those terms if Swiss is adopted later.

## Executed evidence

Run [the probe](../../scripts/astrology-foundation-probe.mjs) with synthetic dates only. The [machine-readable receipt](../verification/2026-11-05/astrology-foundation.json) contains every comparison, package version, artifact hash and limitation.

- 550 longitude comparisons: ten bodies at 55 instants, including a five-year grid from 1850 through 2100 and four additional dates. Comparison threshold declared in the probe: **0.05°**. Maximum observed difference: **0.017851301179462098°**.
- Reference: Swiss Ephemeris 2.10.03 in **Moshier mode**, explicitly checked in returned flags. This is not a comparison against the external Swiss data files used by Patternlike or an independent JPL Horizons acceptance run.
- Eleven civil-time checks passed: one-hour and half-hour folds, spring gap, quarter-hour offset, skipped date, historical second offset, the 2026f Havana change, and local days of 23, 24, 25 and zero hours.
- The selected runtime bundled and returned matching positions and pinned timezone results in local workerd. The probe bundle was 848,877 bytes, 83,330 gzip bytes. This includes the entire timezone dataset; it is not the final app bundle or a hosted performance qualification.
- Twelve local Node runs each calculated 49 instants × ten bodies. See the receipt for timings. These measurements do not establish a mathematically valid uncertainty envelope or a hosted CPU budget.

The host's tzdb was 2026e while the selected data was 2026f. The Havana regression demonstrates why an unversioned browser/Worker `Intl` result must not be the calculation authority.

Reproduce from the repository with its existing development dependencies installed:

```bash
mkdir -p /tmp/reflection-astrology-foundation
npm install --prefix /tmp/reflection-astrology-foundation --no-save --no-audit --no-fund astronomy-engine@2.1.19 moment-timezone@0.6.6 moment@2.31.0 sweph@2.10.3-7
node scripts/astrology-foundation-probe.mjs /tmp/reflection-astrology-foundation /tmp/reflection-astrology-foundation/result.json
```

The probe makes no external calculation calls. Installing dependencies uses the package registry. Availability of the native Swiss reference depends on the host; a missing reference is a failed/incomplete probe, not a skipped pass. Future reruns create a new receipt rather than replacing the historical result silently.

## Time, place and uncertainty rules

1. Use the proleptic Gregorian calendar, geodetic north-positive latitude and east-positive longitude. The initial product date range is 1900-01-01 through the current date in the explicitly selected birth zone. Earlier dates receive an unsupported-date explanation; the wider probe range is not a product support promise.
2. Require a selected place record with coordinates and IANA zone, or explicit manual coordinates and zone. Search the app's own pinned gazetteer. Do not transmit birth dates or times to a location provider. Place text alone is not a resolved location. Give a manual route when a small locality is absent. Preserve source ID, dataset hash and a user's explicit zone override in the private profile.
3. Exact time resolves to all matching UTC candidates under the pinned table. Zero candidates means a gap; require correction. Two candidates require the person to choose the occurrence, with offsets displayed. Validate the supplied offset and fold against the candidates. Never silently shift a gap or choose the earlier fold.
4. Approximate time is an explicit same-date interval, earliest < latest. Form the union of UTC intervals that map into that civil interval, including both occurrences of a repeated time. A wholly nonexistent interval needs correction. For an overnight uncertainty range, use Unknown in this slice and explain that choice; never silently swap endpoints.
5. Unknown time is the complete set of UTC instants whose local date matches the entered date. Its length is not assumed to be 24 hours. A skipped date is invalid. No synthetic noon is stored as a known birth instant.
6. Compute an internal uncertainty envelope and return only supported placement facts. A sign that changes, or touches the declared numerical guard band around a boundary, is unavailable for a chapter. A single midpoint and identical endpoint signs are insufficient evidence. The implementation must qualify adaptive interior sampling and its interpolation/error bound before it can label an interval stable; unresolved bounds suppress that fact.
7. Use a **0.05° minimum model guard band**, a product conservatism choice supported only by the bounded probe, not a universal error guarantee. Qualification can widen it or reduce the supported range. Exact inputs near a sign boundary also need an uncertainty result. Do not round before classification.
8. Houses, angles and nodes are absent for every profile in this slice. Approximate/unknown inputs must not expose exact degrees or exact aspects in user-facing prose. Preserve the full interval and suppression reasons in each saved basis. Historical place-to-zone uncertainty before 1970 remains visible and requires confirmation of the chosen zone; a modern gazetteer cannot prove historical civil-time practice.
9. Every calculation identity binds normalized input, UTC interval union, engine version and artifact hash, timezone version and data hash, adapter version, coordinate convention and reliability-policy version. The stored record carries that immutable identity. An update creates a new calculation; it cannot change a saved reading.

## Qualification still required before enabling the feature

- [ ] Independent reference fixtures across the supported range, boundary cases and bodies, with reference conventions recorded. Never generate expected values solely with the implementation under test.
- [ ] A justified interval-stability algorithm, refinement limits and conservative failure behavior; cases where endpoints agree but the interior crosses a boundary.
- [ ] Leap days, invalid dates, offsets to the second, alias zones, ambiguous approximate intervals, partial gaps and historical timezone qualifiers.
- [ ] Same normalized input produces the same semantic basis hash in Node and workerd; release fingerprints bind the actual bundled ESM/data artifacts.
- [ ] Production-sized bundle and worst-case interval calculations fit the chosen Worker limits under concurrency; enforce request bounds and stop refinement with an unavailable result.
- [ ] Pinned gazetteer attribution, malformed rows, duplicate place names, missing localities and manual corrections.
- [ ] Birth-profile and saved-basis export, deletion, rekey, accounting and restore replay; chapter-content review and activation.

The [design](../superpowers/specs/2026-11-05-your-pattern-design.md) and [implementation plan](../superpowers/plans/2026-11-05-your-pattern.md) turn these requirements into the first working flow. Timing and Time Travel will need separate transit/event qualification; this probe does not close it.
