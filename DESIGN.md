---
name: Reflection
description: "A botanical field journal in two themes, Paper and Evening."
colors:
  paper: "#f7f3e8"
  ink: "#103f46"
  teal: "#126f73"
  evening: "#082f33"
  mint: "#a8d5ba"
  coral: "#f28b7b"
  butter: "#f1d27b"
  sage: "#a9b88f"
  card: "#fbf9f3"
  card-edge: "#d8d8c9"
typography:
  display:
    fontFamily: "Newsreader, Georgia, ui-serif, serif"
    fontSize: 5.5rem
    fontWeight: 500
    lineHeight: 1
  welcome-title:
    fontFamily: "Newsreader, Georgia, ui-serif, serif"
    fontSize: 6rem
    fontWeight: 500
    lineHeight: 1
    letterSpacing: -0.02em
  title-page:
    fontFamily: "Newsreader, Georgia, ui-serif, serif"
    fontSize: 4rem
    fontWeight: 500
    lineHeight: 1.03125
    letterSpacing: -0.02em
  title-section:
    fontFamily: "Newsreader, Georgia, ui-serif, serif"
    fontSize: 2.5rem
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: -0.015em
  card-title:
    fontFamily: "Newsreader, Georgia, ui-serif, serif"
    fontSize: 1.75rem
    fontWeight: 500
    lineHeight: 2.125rem
  history-question:
    fontFamily: "Newsreader, Georgia, ui-serif, serif"
    fontSize: 22px
    fontWeight: 500
    lineHeight: 24px
  brand:
    fontFamily: "Outfit, Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: 28px
    fontWeight: 500
    lineHeight: 34px
    letterSpacing: -0.025em
  body-lg:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: 1.25rem
    fontWeight: 400
    lineHeight: 1.875rem
  body:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5rem
  body-sm:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.25rem
  label:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.5rem
  button:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: 1rem
    fontWeight: 500
    lineHeight: 1.5rem
  eyebrow:
    fontFamily: "Outfit, Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1.125rem
    letterSpacing: 0.14em
  position-title:
    fontFamily: "Outfit, Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.5rem
  caption:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: 0.75rem
    fontWeight: 500
    lineHeight: 1.125rem
  code:
    fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace'
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.25rem
rounded:
  sm: 8px
  md: 10px
  lg: 0.75rem
  xl: 16px
  2xl: 20px
  3xl: 24px
  full: 9999px
spacing:
  space-1: 0.25rem
  space-2: 0.5rem
  space-3: 0.75rem
  space-4: 1rem
  space-5: 1.25rem
  space-6: 1.5rem
  space-7: 1.75rem
  space-8: 2rem
  space-12: 3rem
  space-16: 4rem
components:
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    padding: "11px 24px"
  button-primary-evening:
    backgroundColor: "{colors.mint}"
    textColor: "{colors.ink}"
  button-primary-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  button-primary-active:
    backgroundColor: "{colors.evening}"
    textColor: "{colors.paper}"
  button-primary-evening-hover:
    backgroundColor: "{colors.butter}"
    textColor: "{colors.ink}"
  button-primary-evening-active:
    backgroundColor: "{colors.sage}"
    textColor: "{colors.ink}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    padding: "11px 24px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.teal}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    padding: "11px 24px"
  button-danger:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    padding: "11px 24px"
  text-input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
  reflection-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
  reading-navigation:
    rounded: "{rounded.full}"
    padding: "3px"
  topic-chip:
    backgroundColor: "{colors.mint}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: "8px 12px"
  topic-chip-sage:
    backgroundColor: "{colors.sage}"
    textColor: "{colors.ink}"
  reflection-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.3xl}"
    padding: "{spacing.space-6}"
  reflection-card-evening:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  position-tile:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.position-title}"
    rounded: "{rounded.2xl}"
    padding: "{spacing.space-4}"
  position-badge:
    backgroundColor: "{colors.butter}"
    textColor: "{colors.ink}"
    typography: "{typography.position-title}"
    rounded: "{rounded.full}"
    size: 36px
  history-row:
    typography: "{typography.history-question}"
    padding: "12px 4px"
---

# Reflection Design System

## Overview

**Creative North Star** · “The Botanical Field Journal”

Reflection is quiet, warm, and editorial, and its art is allowed to spill past the page. The welcome page is an invitation. A 96 px headline, two actions, and the three positions of a reading sit on Paper while a botanical rose bleeds in from the top right. Inside the journal, a botanical print can mark a section while the reader’s question takes the largest type. Cards lift a little off the page, and a band of leaves runs along the foot of every page.

The same journal can be read on Paper or in Evening. The return mark, type hierarchy, and placement of controls stay familiar as the page changes color. A saved reading is recognizable by its date and the question the reader wrote.

**Key characteristics**

- The boards’ return mark: a Teal disc with a Paper and Mint center, or a Paper and Mint disc with an Evening center.
- Art that bleeds off page and card edges, behind the words and never under them.
- Serif questions and headings at weight 500 alongside plain, legible controls.
- Cards that lift off Paper, fine rules, and dates aligned with their entries.

## Colors

The first eight printed names above are the palette. Card and Card edge are mixes of Paper for lifted cards: half-way to white (#fbf9f3), and 14% toward Ink (#d8d8c9). The component tokens use Paper as their baseline. The app’s semantic color variables supply the pairings below when the reader selects Evening. System follows the device preference. [Palette and theme mappings](src/client/design/tokens.css)

| Role | Paper | Evening |
| --- | --- | --- |
| Neutral page and text | Ink on Paper. Cards lift to the Card fill (1.05:1 against Paper) with a Card edge (1.30:1). Ink on a card is 10.95:1 and Teal links are 5.62:1. | Paper on Evening. Cards and panels use Paper on Ink with a Mint edge at 25%. |
| Writing fields | Ink on Paper with an Ink border. | Paper on Evening with a Mint border, even inside an Ink panel. |
| Primary action | Paper on Teal. Hover uses Ink and press uses Evening. | Ink on Mint. Hover uses Butter and press uses Sage. |
| Links, field focus, and supporting text | Teal links and field rings. Supporting text uses Ink. | Mint links, field rings, and supporting text. |
| Secondary surfaces | Butter for storage notices, Mint for reflection prompts, success and the selected filter chip, Sage for provenance chips and pressed secondary actions. All use Ink text. | The same fills and Ink text. |
| Placeholders and disabled actions | Placeholders use Ink at 75% so they never read as an entry. Disabled buttons have no fill: an Ink outline at 40% and a label at 60%. | Mint placeholders. Disabled buttons use a Mint outline at 45% and a Paper label at 60%. |
| Tertiary accent | Coral for destructive actions, error notices, and accents in artwork. | The same fill with Ink text. Standalone destructive text can use Coral. |

**The Pastel Rule.** Keep Ink lettering on Mint, Coral, Butter, and Sage in both themes.

Chromium resolves an oklch mix of Paper without Paper’s hue, which tints it pink or blue. So the card fill mixes in oklab, and the edge is written as the oklch value of the Paper and Ink mix. Both render the same in Chromium, Firefox, and WebKit.

## Typography

Newsreader gives a question the presence of a journal entry. Figtree carries the interpretation, form labels, and instructions. Outfit sets the Reflection wordmark, the position eyebrow, and the position numbers and titles. JetBrains Mono distinguishes recovery material and technical identifiers. The fonts ship with the app. [Type styles and font assets](src/client/design/tokens.css)

- **Titles.** Newsreader titles use weight 500. The poster display style is 88/88 px. The welcome headline scales from 48 px on a 390 px phone to 96 px on wide screens, with a line height of 1 and −0.02em tracking. General page titles scale from 40 to 64 px, and the sign-in card title from 36 to 48 px. Section and card titles use the 40/44 and 28/34 px styles.
- **Reading text.** Body copy is 16/24 px, with 20/30 px for a lead and 14/20 px for supporting copy, including retention notes and the reason an action is unavailable. Field hints and chips use the 12/18 px caption. Button labels use weight 500 at 16 px, and field labels stay at 600. On phones, section titles drop to 28/34 px while page titles stay at 40 px.
- **Positions.** The “Reflection positions” eyebrow is 12/18 px Outfit in capitals with 0.14em tracking. A position tile sets its number and title in 16 px Outfit at 600, over a 14/20 px line of Figtree.
- **Return visits.** A history question uses 22/24 px Newsreader, beneath a small Figtree date with tabular numerals. A long question wraps. The chevron stays beside the question.

## Layout

The header aligns its mark and theme control within a centered shell (1120 px maximum on entry). Signed out, the welcome and recovery pages add a “Sign in” link beside the theme control. It is a 44 px target and opens `/sign-in` in place; `/sign-in` itself does not show it. The reading column has a 760 px maximum, Account uses 940 px, and the new-reading form expands to 1080 px. Within that form the question and photo take roughly two thirds of the width. A narrower column holds the disclosures and Start action.

Pages with a side panel (the journal, Your pattern, birth details and a saved chapter) share one grid. The main column takes two thirds of the width and settles at 848 px beside a 432 px panel on wide screens, with no rule between them. The panel is a card in the page's own theme: lifted on Paper, or an Ink panel with a Mint edge at 25% on Evening.

Signed out, `/` is an invitation and `/sign-in` holds the sign-in controls. The welcome page reads in one column: the headline, a lead, two inline pill links, the “Reflection positions” eyebrow and tiles, a closing line, and the runtime notice. “Draw three cards” opens `/sign-in?start=new`, which focuses the new-account choices, and “I have an account” opens `/sign-in`. From 768 px the page slides up behind the header, so the rose runs to the top edge, and the header drops its rule on this page. From 1024 px the headline column stops short of the rose, so the two sit side by side. Below 1024 px the column starts beneath the rose. The lead and the closing line fit on one line from 768 px. Where they wrap, `text-wrap: pretty` keeps the last word company, and engines without it balance the lines. The tiles sit three in a row from 640 px and stack below that. A tile narrower than 240 px inside moves its plate above its words. Three across, a tile does so until it is 284 px wide inside, so every subtitle fits on one line from 390 px. A deletion receipt still comes first on the welcome page.

`/sign-in` puts the former welcome controls, unchanged, in a lifted card beside the inquiry study, under “Sign in or create an account”. Every other signed-out address, such as a saved reading or Account, shows sign-in in place, so the reader returns to the page they asked for. A signed-in reader who opens `/sign-in` lands on `/`. Navigation between these pages stays in the app, so Back and Forward work.

At 760 px and below, the new-reading disclosures move beneath the fields and a compact botanical corner replaces the wide ribbon. At 390 px and below, the header tightens its spacing and the wordmark drops to 23 px. Keep history and dated notes in a single reading order. [Responsive layouts](src/client/style.css)

## Elevation & Depth

Cards lift in Paper. A card or panel takes the Card fill, a one-pixel Card edge, and a low shadow, `--shadow-card` (0 10px 30px −12px, Ink at 25%). That covers the shared cards, the sign-in and recovery cards, the side panels, Account’s AI panel and passkeys, the empty journal, the import panels, and the welcome tiles. Buttons and fields never take a shadow.

Evening uses Ink panels. The step from the Evening page to an Ink panel (1.24:1) carries the depth, with a Mint edge at 25% and a darker shadow (black at 45%).

Fine printed rules still separate sections, and full-strength rules divide entries, reading positions, and disclosures. Rows that read as entries, such as revisit notes, stay flat. The older `--shadow-sm`, `--shadow-md`, and `--shadow-lg` tokens still resolve to `none` and are unused.

## Shapes

Buttons, chips, the reading navigation, and the welcome actions have pill ends. Writing fields have a 12 px radius, while the shared reflection card has 24 px corners and 24 px of padding. Welcome tiles have 20 px corners and 16 px of padding around a 36 px Butter number badge. Tighter Account groups use 10 px corners. History rows meet at straight horizontal rules.

The return mark is 30 px across and follows the header logos on boards 01 and 03. On Paper it is a Teal disc with a center circle 37% of its diameter, Paper above and Mint below, inside a thin Paper ring. On Evening the disc itself splits at the middle, Paper above and Mint below, around an Evening center. [Return marks](src/client/design/art)

## Components

The controls are easy to touch and quiet on the page. Use the shared React components for their native labels, focus behavior, and theme changes. [Component definitions](src/client/design/components.tsx)

- **Buttons and links.** Primary buttons have a solid fill. Secondary actions have a one-pixel outline. A link that only opens another page can wear the same pill: the welcome page’s two actions are links styled as primary and secondary buttons. Text buttons and ordinary text links are underlined. Secondary and text buttons fill with Mint on hover and Sage on press. The destructive button starts on Coral and moves through Butter and Sage, always with Ink lettering, and every destructive confirmation uses it. A disabled button drops its fill for a dimmed outline, so it never looks pressed. When a checkbox gates a destructive button, “Check the box above to continue.” sits under the button until the box is checked. Buttons have a 48 px minimum height. Keyboard focus draws a 2 px foreground outline with a 4 px offset.
- **Writing fields.** Keep a visible label above the field and its hint directly below. Textareas resize vertically. Focus picks up the theme ring on both the border and a 2 px outline with a 2 px offset.
- **Navigation and chips.** Astrology, Tarot and Journal share one outlined pill, up to 440 px wide, in that order. Each destination uses the same tab treatment; the current one has a filled segment and `aria-current="page"`. A topic chip is a static label with Mint, Butter, Sage, or Coral fill. The Sage chip identifies the provenance of a reading, including the label on an interpretation. Journal filters are outlined toggle chips after a visible “Show” label. The selected chip is Mint with a check and Ink lettering and carries `aria-pressed`.
- **History and dated notes.** Group date, question, and chevron in one ruled history row. A revisit note has its own date and preserves the reader’s line breaks. Keep the author’s note, generated interpretation, and traditional source identifiable by their headings. [Reading workspace](src/client/readings.tsx) and [revisit notes](src/client/revisit-notes.tsx)
- **Card faces and motion.** Use the theme-specific return mark and the compact artwork supplied for phones at 64 px. Each card face shows its own crop of its suit’s study, so two cards in a draw never share a picture. The disclosure chevron turns over 150 ms. A busy spinner takes one second per turn and accompanies written status. Reduced motion removes both effects.

## Artwork

Decorative art carries `alt=""` and `aria-hidden="true"`. Art in a slot beside a heading keeps its reserved space, as the study plates and the phone corner do. Art that bleeds off an edge is absolutely positioned, ignores the pointer, and sits behind content. It never sits under text or controls at 320 px or at 400% zoom, and it is hidden in forced-colors mode. The one exception is a control that paints its own fully opaque fill, as the header controls do over the rose. [Artwork inventory](src/client/design/art/README.md)

- **The rose** appears on the welcome page only. From 768 px it is 46rem wide, or 60% of the page if that is narrower, and it runs behind the header to the top edge. There the theme control and the “Sign in” link paint the page color, Paper or Evening, so they stay readable over it. On phones it is 34rem wide and would sit under the wordmark, so it starts under the header rule. It bleeds 6rem past the right edge. It is 90% opaque, fades out over its lower 40%, and loads with high priority.
- **The position plates** fill the right 40% of each welcome tile at 80% opacity, clipped by the tile. The tile’s words end 4 px before the plate.
- **The leaf band** runs along the foot of every page in space reserved for it. It repeats the optimized ribbon across the page, 80 to 144 px tall, at 55% opacity on Paper and 40% on Evening.
- **The spiral bloom** now appears only in the empty journal.

## Do's and Don'ts

### Do

- Do keep the date and full available question preview together when a history row wraps.
- Do retain the visible focus outline and the system highlight for the current navigation segment in forced colors.
- Do label the example spread “Illustration only” and give an uploaded spread its own caption.
- Do let decorative art bleed off page and card edges, behind content.

### Don't

- Don't place a decorative thumbnail beside an individual saved question.
- Don't use artwork to communicate progress, deletion, or recovery status.
- Don't clip a reader’s note or replace its paragraph breaks with a single line.
