# Journey milestones

The current implementation applies the owner's editable **Reflection Paper and Evening design system** across the existing app. The [implementation guide](reflection-system.md) documents the exact eight-color palette, local typography, reusable components, theme preference and Figma source. The earlier functional/accessibility corrections, mobile hierarchy, reading composition and illustration delivery remain the baseline.

## Current visual increment: entry and return

The [November 1 concept direction](concept-direction.md) remains historical context. The later approved Figma library supersedes its Solstice palette guidance. The app retains Newsreader/Figtree/Outfit and Fluent icons, applies the exact Paper/Evening tokens and uses the spiral bloom with “A little space to reflect.” on the landing page. Date/question history rows and status-first outcome screens retain their existing workflow. Use the placement inventory in [`src/client/design/art/README.md`](../../src/client/design/art/README.md).

Acceptance: the same 320/390/768/1280 px, two-theme matrix; empty/populated history and long questions; all recovery warnings/codes and progress outcomes; no decorative art mistaken for a user photograph, recognized card or security status. Extend the existing evidence harness and update `design-qa.md`, then run `npm run verify`. No illustration-only change closes the physical-device or assistive-technology gaps.

## Product increments — specification before implementation

1. [Dated revisit notes](dated-revisit-notes.md): extend read → save → reflect → return without a new AI call.
2. [Selected-context preview and permission](selected-context.md): explicit, inspectable context and revocation.
3. [Follow-up readings](follow-up-readings.md): exact saved-parent identity, using the context controls above.
4. [Legacy imports](legacy-imports.md): preview, validation, duplicates and recoverable partial failures.

These are separate proposed design/acceptance specifications, **not implemented features**. Each needs product/privacy approval and its own implementation milestone. New persistence requires contract, storage, export, erasure and retention work; none belongs in the frontend visual batch. Each increment must pass the existing verification gate and add targeted tests and comparison screenshots before its QA status changes to accepted.
