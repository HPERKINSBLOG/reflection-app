# Natal interval policy v1

This policy qualifies a sign over a UTC interval union, not a claimed birth instant. It operates on the pinned Astronomy Engine model. Model agreement with an independent ephemeris and editorial approval are separate release gates; a finite reference corpus is not a universal astronomical accuracy proof.

The exact engine artifact and complete IANA data bytes are hashed in `content/astrology/calculation-manifest.json`. `scripts/generate-calculation-manifest.ts --check` fails on drift. The ESM artifact hash differs from the preparation probe's CommonJS artifact hash.

## Continuous enclosure

Astronomy Engine 2.1.19's `CalcVsop` computes spherical coordinates from sums of `t^n A cos(B + Ct)`. The generator extracts the **actual packaged coefficients**, and bounds each coordinate's absolute value by `Σ |t|^n |A|`. Its derivative bound is `Σ |A| (n |t|^(n−1) + |t|^n |C|) / 365250`, in units per day. The certificate uses `|t| ≤ 0.2` Julian millennia, containing 1900–2100 and the light-travel backdating margin. Cartesian speed is at most `|r′| + rMax (|longitude′| + |latitude′|)`. No sampled speed estimate supplies these bounds.

For the Sun, heliocentric position and speed are zero. Subtracting the Earth adds the target and Earth speed bounds. `VsopRotate` is a fixed almost-orthogonal matrix; 1.001 bounds its operator norm. The implicit retarded-time derivative is bounded by `1/(1−v/c)`; the largest generated relative speed is below 0.09 AU/day, versus the engine's 173.1446 AU/day light speed. The 1.01 multiplier also encloses the terrestrial-time polynomial slope over this range.

`Ecliptic` rotates through precession, nutation and obliquity. Over absolute Julian centuries ≤2, the absolute derivative sums of the three `precession_rot` polynomials are below 0.001 rad/day. Applying the same triangle inequality to all five `iau2000b` harmonic arguments and `mean_obliq` gives less than 0.001 rad/day for their combined rotations. The deliberately loose **1 rad/day** frame bound encloses these terms by more than two orders of magnitude. Multiplying this bound by the sum of the target/Earth maximum radii bounds the additional Cartesian motion. This large bound costs extra subdivision but does not depend on the observed sign.

The engine's piecewise ΔT polynomials have small joins. A **60-second time allowance per leaf** encloses their discontinuities over any supported civil interval, including historical date-line changes, light-travel solver tolerance and the subsecond obliquity cache. The pinned zone offsets keep these civil unions shorter than three days, so no union spans two ΔT formula joins. Every evaluation first displaces that cache to make the result independent of earlier calls. This allowance is added to each half-interval duration before multiplying by the conservative speed. The 0.05° model guard is then applied separately.

At each midpoint the true-ecliptic vector has projected radius `ρ`. Let `d` be the bounded displacement over the leaf. If `d ≥ ρ`, the leaf is inconclusive and is split. Otherwise the disk of radius `d` around its projected vector bounds angular departure by `asin(d/ρ)`. A leaf is accepted only when this bound plus the model guard lies strictly inside the midpoint's sign. Every leaf of every disconnected interval must have the same sign. This covers interior excursions and turning points even when both endpoints match.

## Failure behavior and scope

At most 2,048 distinct instants are evaluated per calculation, shared across bodies. Crossing a sign boundary, touching the guard, exhausting refinement, invalid engine output or an unqualified bound suppresses that body's sign. The Moon's lunar series and Pluto's numerical integration are **not covered by the VSOP certificate**; their signs are suppressed for approximate/unknown times. Exact-time positions still use the engine and guard. No houses, angles, nodes, aspects or transit claims are produced.

The model range is explicitly bounded through 2100. The product additionally rejects birth dates before 1900 or after today in the selected zone. Historical zone uncertainty is preserved independently of numerical interval bounds.

After all qualification decisions, stored longitudes are normalized to 10⁻⁹ degrees and deviation bounds are rounded outward with an additional 10⁻⁹-degree allowance. This prevents observed Node/workerd trigonometric differences of about 10⁻¹⁴ degrees from changing saved semantic identities. Raw unrounded values are used for all comparisons and refinement; the output precision is part of the hashed policy.

Sources: the pinned package's `VsopFormula`, `VsopDeriv`, `VsopRotate`, `BackdatePosition`, `Ecliptic`, `precession_rot`, `iau2000b`, `mean_obliq` and `DeltaT_EspenakMeeus`; upstream [Astronomy Engine source](https://github.com/cosinekitty/astronomy/blob/master/source/js/astronomy.ts). The exact packaged artifact, rather than upstream HEAD, controls this release.
