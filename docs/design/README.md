# Journey milestones

The current implementation applies the owner's editable **Reflection Paper and Evening design system** across the existing app. The [implementation guide](reflection-system.md) documents the exact eight-color palette, local typography, reusable components, theme preference and Figma source. The earlier functional/accessibility corrections, mobile hierarchy, reading composition and illustration delivery remain the baseline.

The [November 5 merger implementation map](merger-implementation-map.md) separates the completed astrology, shared-journal and tarot Figma flows from the current app. [Your Pattern to the journal](../superpowers/plans/2026-11-05-your-pattern.md) now has a working local implementation using the [recorded calculation foundation](../architecture/ASTROLOGY_FOUNDATION.md). Birth setup, chapter selection, atomic saving, exact reopening and dated revisits share the existing components and Paper/Evening tokens. See [local acceptance and activation limits](../YOUR_PATTERN_RESULTS.md).

## Current visual increment: entry and return

The [November 1 concept direction](concept-direction.md) remains historical context. The later approved Figma library supersedes its Solstice palette guidance. Since 2026-11-06 the app follows the boards’ composition: the welcome page invites a first reading under “A little space to reflect.” with the rose and the position tiles, and sign-in lives at `/sign-in`. The app retains Newsreader/Figtree/Outfit and Fluent icons and applies the exact Paper/Evening tokens. Date/question history rows and status-first outcome screens retain their existing workflow. Use the placement inventory in [`src/client/design/art/README.md`](../../src/client/design/art/README.md).

Acceptance: the same 320/390/768/1280 px, two-theme matrix; empty/populated history and long questions; all recovery warnings/codes and progress outcomes; no decorative art mistaken for a user photograph, recognized card or security status. Extend the existing evidence harness and update `design-qa.md`, then run `npm run verify`. No illustration-only change closes the physical-device or assistive-technology gaps.

## Product increments and recorded implementation

1. [Dated revisit notes](dated-revisit-notes.md): extend read → save → reflect → return without a new AI call.
2. [Selected-context preview and permission](selected-context.md): explicit, inspectable context and revocation.
3. [Follow-up readings](follow-up-readings.md): exact saved-parent identity, using the context controls above.
4. [Legacy imports](legacy-imports.md): preview, validation, duplicates and recoverable partial failures.

These links retain the original design/acceptance specifications. Dated notes and the Milestone 3 selected-context, follow-up and import workflows now have implementation evidence in [Milestone 3 results](../MILESTONE_3_RESULTS.md) and [dated-note verification](../verification/2026-11-01/dated-revisit-notes.md). Live continuity remains separately gated. Native Pattern contracts, encrypted persistence, export/import, erasure, rekey and retention are implemented and exercised locally. Figma completion and local acceptance do not establish production numerical, editorial or hosted qualification. The journal still needs standalone notes, full-text/date controls and activity ordering; Timing and Time Travel still need their own calculation services.
