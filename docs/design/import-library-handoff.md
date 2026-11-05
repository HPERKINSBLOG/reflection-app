# Import review library handoff

The import review components now live in the canonical [Reflection — Paper & Evening Design System](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=129-55), on **06 · Import review components** (`129:55`). This consolidates reusable elements from the [redesigned import review](https://www.figma.com/design/q9z9EumNoo7fLv0qwKyBQU?node-id=60-1831) and its [component source page](https://www.figma.com/design/q9z9EumNoo7fLv0qwKyBQU?node-id=2-2). The source files remain intact.

## Components

Six component sets contain 19 variants. The specimen boards use instances; main components sit separately on the same page.

| Family | Figma node | Variants |
| --- | --- | --- |
| Import / Status | [129:59](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=129-59) | Ready, Duplicate, Blocked |
| Import / Checkbox | [129:72](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=129-72) | Unchecked, Checked, each with focus and disabled states |
| Import / Group row | [130:59](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=130-59) | Selected, Ready, Duplicate, Blocked |
| Import / Selected group preview | [130:107](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=130-107) | Default; editable title, original text and reflection |
| Import / File header | [130:120](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=130-120) | Default; editable filename and source |
| Import / Group confirmation | [130:128](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=130-128) | Ready, Pending, Complete, Failed |

## Design-system reuse

The components reuse the canonical Newsreader and Figtree text styles, Paper/Evening semantic color variables, spacing, radii, and [Button](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=2-22) instances. Selected Mint surfaces use explicit text-on-accent bindings, including the status marker and checkbox treatment, so labels remain readable in both themes without forcing the whole row to Paper. Disabled Sage surfaces retain readable labels. Checkboxes have 44 × 44 targets and visible focus treatments.

The library release is **published and verified as of 2026-11-05**. The complete Import and Return release contains 10 families / 28 variants and is enabled in both consuming drafts. All four responsive Import families (Group row, Selected group preview, File header and Group confirmation) report `CURRENT`; the working draft's remote main components match the canonical layout and text across all 10 updated variants, including selected-row theme and contrast fixes. The behavior draft uses published Checkbox and Status components and has no instances of those four families requiring refresh. No further publication or update acceptance is required for this release. See the [completed release checklist](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=157-69).

## Behavior contract

- Confirmation applies to **one group**. The summary separates current-group records from skipped duplicates and blocked records.
- Duplicate and blocked specimens describe whether records will be created. They do not replace the service's review logic. A duplicate-only group can complete review without creating records; existing-reading links appear only after verification.
- An unresolved parent reference remains reviewable until server validation resolves or blocks it. The Blocked specimen represents a confirmed blocking result.
- Preview labels keep original reading, follow-up and personal writing distinct. Unknown provenance stays explicit.
- Pending state disables conflicting actions. An interrupted result checks saved status before retry; previously completed groups remain saved.

## Validation and limits

Both [Paper](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=131-76) and [Evening](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=131-229) instance boards were rendered and visually reviewed at 1256 × 2428. Selected content, disabled labels, focus states, wrapping and containment were checked. Structural inspection found all 19 variants using auto layout, all 214 text nodes retaining a canonical text style and color-variable binding, no missing fonts, and no child extending outside either board.

The subsequent migration replaced 30 checkboxes and 18 import-status indicators in the behavior draft with canonical components, preserving their states and existing actions. The working draft's [Responsive flows page](https://www.figma.com/design/q9z9EumNoo7fLv0qwKyBQU?node-id=134-189) adds eight complete Return/Import mobile screens at 320px and 390px in Paper and Evening, plus two Evening desktop screens. Together with the two existing Paper desktop screens, all 12 full screens passed text/artwork preservation, layout and font checks, with representative renders visually reviewed. Original prototype actions were preserved; the source Return/Import screens had no destination wiring to copy.

The component specimens and full-screen designs do not establish Code Connect mappings or runtime behavior. The exact botanical illustration remains in the source and app assets; runtime validation belongs to the implementation's browser and import-service tests.

The final local evidence is retained under `/home/htper/.local/state/reflection-app/figma-completion-20261105/`: `verification.json` records the design and migration checks, and `release-confirmation.json` supersedes its earlier pending publication status. Publication was checked through component-set status and the consumers' linked remote masters; the connector does not expose per-file UI acceptance history. The three Figma guides now consistently report the completed release.
