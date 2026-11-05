# Return and continue: Paper and Evening

The implementation adapts [Return and continue — desktop](https://www.figma.com/design/q9z9EumNoo7fLv0qwKyBQU?node-id=16-122) to Reflection's approved [Paper and Evening foundations](reflection-system.md). It applies to native Tarot readings. Pattern chapters and imported snapshots retain their existing presentation and capabilities.

## Interaction contract

- Keep a compact, wrapping edition history above the question. Every destination identifies the exact saved edition; the current edition, original reading and parent remain distinguishable. Long questions and larger families must stay reachable on narrow screens.
- Place the question, parent identity and follow-up action above the interpretation and personal-writing columns. Follow-ups keep the original draw and never imply that new cards were drawn.
- Label simulated interpretations truthfully. Existing permission, saved-state, continuity and family-size checks govern whether follow-up is offered.
- Preserve the complete accepted interpretation, card identities, uploaded spread photos, source meanings and provenance. Cards, photos and the original basis text remain in the expandable “Cards, sources and shared context” section. The reference's example wording and three-card count do not replace real saved content.
- Read a saved reflection before choosing Edit. Preserve save/cancel, revision conflicts, focus restoration and navigation protection for unsaved writing. Journal loading locks the mounted writing controls; changing editions removes the previous editor before loading the destination.
- Present revisit notes as dated entries with stance, original text and edit/delete actions. Preserve pagination, revision conflicts, deletion receipts, retries, permission checks and expiry behavior.
- Stack interpretation and writing on mobile, with wrapping labels and controls. Preserve the current global brand and navigation, accessible touch targets and semantic theme tokens.

## Assets and scope

Use the source frame's exact botanical artwork and matching icons as local assets. Artwork is decorative and preserves its proportions. Reuse shared controls rather than recreating the source frame's older Solstice primitives. This is a presentation change over existing services; it does not enable hosted continuity, change stored readings or activate astrology.

## Verification

The final Chromium run passed 104 tests covering return and follow-up flows, exact edition links, reflection and note editing, navigation guards, source and photo preservation, permission changes, import/Pattern compatibility, recovery, conflicts and deletion receipts. The returned-reading test holds a Journal response and verifies that the mounted writing controls cannot accept input; edition navigation removes the previous editor before its response arrives.

Responsive assertions cover column widths, aligned reflection/interpretation headings, loaded artwork, complete text and no body overflow at 1440px, 390px and 320px in both themes. A 500-character question and three real saved editions exercise narrow-screen wrapping within the service's daily generation allowance. Desktop and mobile screenshots were inspected against the reference.

Six existing layout journeys passed: 390px Paper and Evening in Chromium, Firefox and WebKit. Strict TypeScript, changed-file Biome checks and whitespace checks also passed. There were no skipped or flaky cases in the final browser runs.

An earlier broad run exposed four deletion-focus regressions from using the general parent busy flag to lock notes during metadata refreshes. The final implementation locks notes only during pending Journal navigation; all four unchanged focus tests and the delayed-navigation test pass. A subsequent run encountered a full temporary filesystem; final verification used a dedicated temporary directory on the workspace disk.

The [verification receipt](../../artifacts/return-and-continue/verification.json) records commands, file hashes, screenshots and retained evidence. This is targeted UI verification: the full release gate, domain/database/numerical suites, maximum family size, physical devices and screen readers were not newly qualified. Figma publication, merge and deployment were not performed.
