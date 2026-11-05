# Import review: Paper and Evening

The implementation adapts the [redesigned import review](https://www.figma.com/design/q9z9EumNoo7fLv0qwKyBQU?node-id=60-1831) to Reflection's approved [Paper and Evening foundations](reflection-system.md). The older Solstice tokens remain a historical reference. The layout uses a reading-group list, one selected-group preview, and a confirmation summary tied to that group.

## Interaction contract

- File parsing and explicit record selection precede the encrypted server preview. Reviewing records does not import them.
- Confirm one complete related group per action. Switching the visible preview does not submit or change records in other groups.
- Distinguish new records, duplicates, blocked records and completed groups. A completed group must not remain counted as pending new records.
- Duplicate-only confirmation completes the review without creating another reading. Links to existing readings use verified local IDs returned by reconciliation; portable source IDs are not navigation authority.
- An unresolved parent reference may identify an existing owned record. Keep its check visible and let the server establish eligibility; a rejected missing-parent dependency receives a repair explanation.
- Keep exact source text, unknown dates/provenance, safe text rendering, preview pagination, conflict and erased-record recovery, interrupted-commit reconciliation and staged-review resume.
- One focused import workspace uses the existing account navigation. Closing it restores the account tools and focus. On mobile, groups precede the preview and confirmation; text and controls wrap without horizontal scrolling.

## Assets and library

Use the exact botanical illustration supplied by the source frame, stored locally. Reuse Reflection's current brand, shared buttons and Paper/Evening semantic tokens. Botanical artwork is decorative and preserves its intrinsic proportions.

The canonical Figma library receives the reusable import-specific patterns; see the [library handoff](import-library-handoff.md) for node links and publication status. Source design files are retained for reference.

## Verification

The final targeted Chromium run passed 11 tests: independent group confirmation, mixed new/duplicate records, missing-parent rejection, exact text, changed-content and erased-record recovery, interrupted commits, staged-review resume, and explicit birth-profile restoration. Responsive assertions verify desktop column widths, stacked mobile panels, loaded botanical artwork and SVG masks, accessible confirmation names and linked remedies, and failure messages scoped to the selected group. Paper and Evening screenshots were inspected at 1440px and 390px, with long content at 320px.

Six existing account/reading/import layout journeys also passed: 320px Paper and 1280px Evening in Chromium, Firefox and WebKit. These cover the changed account shell and the import-review fixture; they are a targeted subset of the existing journey matrix.

All 477 domain/tooling tests passed; no domain or Worker implementation changed. Strict TypeScript and changed-file Biome checks passed. The [verification receipt](../../artifacts/import-review/verification.json) records commands, file hashes, retained evidence and limits. The full release gate was not rerun for this UI change. Library publication and application deployment were not performed.
