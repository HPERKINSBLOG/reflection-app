# Reflection design system

Implemented from the [editable Figma library](https://www.figma.com/design/a0u0Ok74iKTMjp1L5osRnU?node-id=3-347). This owner-approved Paper and Evening system supersedes the earlier Solstice palette. Since 2026-11-06 the composition follows the [concept boards](concept-direction.md): art bleeds off page and card edges, cards lift, the return mark matches the boards, and the welcome page is an invitation. The Figma library has not caught up with these changes yet.

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
| Sage | `#A9B88F` | Botanical fills, provenance chips and pressed secondary controls |

Paper uses Ink on Paper (10.40:1), with Paper on Teal actions (5.34:1). Cards lift off Paper: `--card` is Paper half-way to white (`#FBF9F3`, 1.05:1 against Paper), `--card-edge` is Paper 14% toward Ink (`#D8D8C9`, 1.30:1), and `--shadow-card` is `0 10px 30px -12px` in Ink at 25%. Ink on a card is 10.95:1 and Teal links are 5.62:1. Chromium drops Paper’s hue in an oklch mix, so the card mixes in oklab and the edge is written as its oklch value; both render the same in Chromium, Firefox and WebKit. Evening uses Paper on Evening (12.93:1), with Ink on Mint actions (7.08:1). Evening cards and panels stay Ink (Paper on Ink is 10.40:1), with a Mint edge at 25% and a black shadow at 45%. Pastel surfaces always use Ink text. Text links are underlined. Primary hover/pressed states use Ink/Evening in Paper and Butter/Sage in Evening. Secondary buttons remain outlined and fill Mint/Sage on hover/press. Disabled buttons have no fill: a 1 px outline (`--reflection-disabled-border`, Ink at 40% or Mint at 45%) and a dimmed label (`--action-disabled-label`, Ink or Paper at 60%). Placeholders use `--reflection-placeholder` (Ink at 75%, or Mint in Evening). Focus indicators remain visible with keyboard navigation and system forced colors.

## Typography and spacing

Locally hosted Newsreader Medium (500) supplies editorial headings: 88/88 poster, a 48–96 px welcome headline (`clamp(3rem, 1.75rem + 4.8cqw, 6rem)`, line height 1, −0.02em), responsive 40–64 px page titles, 40/44 section titles and 28/34 card titles. Figtree supplies 16/24 body and controls, 20/30 lead copy and 12/18 captions. Button labels are Figtree 500; field labels stay at 600. Outfit Medium 28/34 identifies Reflection; Outfit also sets the 12/18 uppercase position eyebrow and the 600-weight position numbers and titles. Small-screen adjustments preserve readable controls and complete content. Existing JetBrains Mono remains for recovery codes and technical identifiers.

Spacing uses the shared 4/8/12/16/24/32/48/64 px scale. Buttons have a 48 px minimum height and pill shape. Inputs use 16 px text, cards use 24 px corners and padding, welcome tiles use 20 px corners and 16 px padding, and the header theme selector retains a 44 px target.

## Components and themes

[`components.tsx`](../../src/client/design/components.tsx) exports `Button`, `ConfirmationHint`, `TextLink`, `Input`, `TextArea`, `ReflectionField`, `TopicChip`, `ReflectionCard` and `Brand`. Native element props and refs pass through; buttons default to `type="button"`, and submit controls declare their type. Button variants are `primary`, `secondary`, `text-button` and `danger`. Fields associate labels and optional hint text; chips offer Mint, Butter, Sage and Coral fills.

The shared components are used in identity/recovery, account controls, new readings, reflection editing, revisit notes, deletion and request progress. Existing keyboard focus, consent, data handling and recovery behavior remain attached to the same controls. [`invitation.tsx`](../../src/client/invitation.tsx) renders the signed-out welcome page; its two actions are links styled as pill buttons that open `/sign-in`.

[`theme.tsx`](../../src/client/design/theme.tsx) exposes System, Paper and Evening. System follows `prefers-color-scheme` without writing browser storage. An explicit choice stores only `reflection-theme`; it persists on reload and synchronizes across tabs. The preference is applied before React renders. Blocked storage falls back safely, and changing themes does not remount the reading editor. No reading, reflection or account data is stored with this preference.

## Artwork and verification

The bloom is a local SVG export from the Figma library, now shown only in the empty journal. The two return marks were redrawn to match the header logos on boards 01 and 03. The welcome page shows the rose and the three position plates, and every page carries a leaf band along its foot. Art that bleeds off an edge sits behind content, never covers text or controls at 320 px or at 400% zoom, and is hidden in forced-colors mode. All decorative images have empty alt text. Existing reading and account artwork remains in its established placements. See the [artwork inventory](../../src/client/design/art/README.md).

See [`design-qa.md`](../../design-qa.md) for current verification results and limits. [`design-system.spec.ts`](../../tests/browser/design-system.spec.ts) covers exact tokens, theme behavior, typography, the responsive welcome composition, storage failures and draft preservation. [`welcome.spec.ts`](../../tests/browser/welcome.spec.ts) covers the welcome page, `/sign-in`, their navigation and contrast. Existing journey tests cover the signed-in workflows, long content, focus and contrast, and check that art never sits under text or controls.
