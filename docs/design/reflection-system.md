# Reflection design system

Implemented from the [editable Figma library](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=3-347). This owner-approved Paper and Evening system supersedes the earlier Solstice palette. The spiral bloom poster supplies the open space, editorial type and botanical direction; the app uses the library's vector interpretation.

## Color

The source of truth in code is [`tokens.css`](../../src/client/design/tokens.css). UI colors reference these exact primitives; illustration images retain their original colors.

| Primitive | Hex | Role |
| --- | --- | --- |
| Paper | `#F7F3E8` | Paper canvas; Evening text |
| Ink | `#103F46` | Paper and pastel text; Evening raised surface |
| Teal | `#126F73` | Paper primary action and links |
| Evening | `#082F33` | Evening canvas |
| Mint | `#A8D5BA` | Evening actions, links and supporting text |
| Coral | `#F28B7B` | Expressive accents and error fills |
| Butter | `#F1D27B` | Warm supporting fills |
| Sage | `#A9B88F` | Botanical fills and disabled controls |

Paper uses Ink on Paper (10.40:1), with Paper on Teal actions (5.34:1). Evening uses Paper on Evening (12.93:1), with Ink on Mint actions (7.08:1). Pastel surfaces always use Ink text. Text links are underlined. Primary hover/pressed states use Ink/Evening in Paper and Butter/Sage in Evening. Secondary buttons remain outlined and fill Mint/Sage on hover/press. Focus indicators remain visible with keyboard navigation and system forced colors.

## Typography and spacing

Locally hosted Newsreader Regular supplies editorial headings: 88/88 poster, responsive 40–64 px page titles, 40/44 section titles and 28/34 card titles. Figtree supplies 16/24 body and controls, 20/30 lead copy and 12/18 captions. Outfit Medium 28/34 identifies Reflection. Small-screen adjustments preserve readable controls and complete content. Existing JetBrains Mono remains for recovery codes and technical identifiers.

Spacing uses the shared 4/8/12/16/24/32/48/64 px scale. Buttons have a 48 px minimum height and pill shape. Inputs use 16 px text, cards use 24 px corners and padding, and the header theme selector retains a 44 px target.

## Components and themes

[`components.tsx`](../../src/client/design/components.tsx) exports `Button`, `TextLink`, `Input`, `TextArea`, `ReflectionField`, `TopicChip`, `ReflectionCard` and `Brand`. Native element props and refs pass through; buttons default to `type="button"`, and submit controls declare their type. Button variants are `primary`, `secondary`, `text-button` and `danger`. Fields associate labels and optional hint text; chips offer Mint, Butter, Sage and Coral fills.

The shared components are used in identity/recovery, account controls, new readings, reflection editing, revisit notes, deletion and request progress. Existing keyboard focus, consent, data handling and recovery behavior remain attached to the same controls.

[`theme.tsx`](../../src/client/design/theme.tsx) exposes System, Paper and Evening. System follows `prefers-color-scheme` without writing browser storage. An explicit choice stores only `reflection-theme`; it persists on reload and synchronizes across tabs. The preference is applied before React renders. Blocked storage falls back safely, and changing themes does not remount the reading editor. No reading, reflection or account data is stored with this preference.

## Artwork and verification

The bloom and two return marks are local SVG exports from the Figma library. Path geometry and original aspect ratios are preserved; descriptive SVG titles were added. The images are decorative in the rendered page and have empty alt text. Existing reading and account artwork remains in its established placements.

See [`design-qa.md`](../../design-qa.md) for current verification results and limits. [`design-system.spec.ts`](../../tests/browser/design-system.spec.ts) covers exact tokens, theme behavior, typography, responsive landing composition, storage failures and draft preservation. Existing journey tests cover the signed-in workflows, long content, focus and contrast.
