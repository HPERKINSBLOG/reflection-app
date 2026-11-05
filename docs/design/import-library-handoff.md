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

The components reuse the canonical Newsreader and Figtree text styles, Paper/Evening semantic color variables, spacing, radii, and [Button](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=2-22) instances. The existing Button was `CURRENT` when checked. No existing component, variable or text style was changed or duplicated. Fixed Mint selection and Sage disabled surfaces retain Ink labels in both themes through local mode settings. Checkboxes have 44 × 44 targets and visible focus treatments.

The six new sets are **UNPUBLISHED**. They are reusable locally in the canonical file; cross-file consumption requires a subsequent library publication. No publication was performed.

## Behavior contract

- Confirmation applies to **one group**. The summary separates current-group records from skipped duplicates and blocked records.
- Duplicate and blocked specimens describe whether records will be created. They do not replace the service's review logic. A duplicate-only group can complete review without creating records; existing-reading links appear only after verification.
- An unresolved parent reference remains reviewable until server validation resolves or blocks it. The Blocked specimen represents a confirmed blocking result.
- Preview labels keep original reading, follow-up and personal writing distinct. Unknown provenance stays explicit.
- Pending state disables conflicting actions. An interrupted result checks saved status before retry; previously completed groups remain saved.

## Validation and limits

Both [Paper](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=131-76) and [Evening](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=131-229) instance boards were rendered and visually reviewed at 1256 × 2428. Selected content, disabled labels, focus states, wrapping and containment were checked. Structural inspection found all 19 variants using auto layout, all 214 text nodes retaining a canonical text style and color-variable binding, no missing fonts, and no child extending outside either board.

These are component specimens, not a complete mobile flow, interactive prototype, Code Connect mapping, or proof of runtime behavior. The exact botanical illustration remains in the source and app assets; no additional image copy was added to this library page. Runtime validation belongs to the implementation's browser and import-service tests.

The local execution ledger is `/tmp/reflection-import-library-ledger.json`; reviewed render files are `/tmp/reflection-import-library-paper.png` and `/tmp/reflection-import-library-evening-final.png`. The final Evening render explicitly shows the selected-row content, “Importing…” and “Group saved” labels. These temporary artifacts are not repository assets.
