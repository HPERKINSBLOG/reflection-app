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
typography:
  display:
    fontFamily: "Newsreader, Georgia, ui-serif, serif"
    fontSize: 5.5rem
    fontWeight: 400
    lineHeight: 1
  title-page:
    fontFamily: "Newsreader, Georgia, ui-serif, serif"
    fontSize: 4rem
    fontWeight: 400
    lineHeight: 1.03125
    letterSpacing: -0.02em
  title-section:
    fontFamily: "Newsreader, Georgia, ui-serif, serif"
    fontSize: 2.5rem
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: -0.015em
  card-title:
    fontFamily: "Newsreader, Georgia, ui-serif, serif"
    fontSize: 1.75rem
    fontWeight: 400
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
    typography: "{typography.label}"
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
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "11px 24px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.teal}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "11px 24px"
  button-danger:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
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
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.3xl}"
    padding: "{spacing.space-6}"
  reflection-card-evening:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  history-row:
    typography: "{typography.history-question}"
    padding: "12px 4px"
---

# Reflection Design System

## Overview

**Creative North Star** · “The Botanical Field Journal”

Reflection is quiet, warm, and editorial. A spiral bloom fills the open side of the welcome page. Inside the journal, a botanical print can mark a section while the reader’s question takes the largest type. Generous margins give both the illustration and the writing room.

The same journal can be read on Paper or in Evening. The return mark, type hierarchy, and placement of controls stay familiar as the page changes color. A saved reading is recognizable by its date and the question the reader wrote.

**Key characteristics**

- A circular return mark and a spiral bloom drawn from the same print palette.
- Serif questions and headings alongside plain, legible controls.
- Fine rules, generous writing space, and dates aligned with their entries.

## Colors

The eight printed names above are the palette. The component tokens use Paper as their baseline. The app’s semantic color variables supply the pairings below when the reader selects Evening. System follows the device preference. [Palette and theme mappings](src/client/design/tokens.css)

| Role | Paper | Evening |
| --- | --- | --- |
| Neutral page and text | Ink on Paper. Cards share the page fill. | Paper on Evening. Cards use Paper on Ink. |
| Writing fields | Ink on Paper with an Ink border. | Paper on Evening with a Mint border, even inside an Ink panel. |
| Primary action | Paper on Teal. Hover uses Ink and press uses Evening. | Ink on Mint. Hover uses Butter and press uses Sage. |
| Links, field focus, and supporting text | Teal links and field rings. Supporting text uses Ink. | Mint links, field rings, and supporting text. |
| Secondary surfaces | Butter for storage notices, Mint for reflection prompts and success, Sage for provenance chips and disabled actions. All use Ink text. | The same fills and Ink text. |
| Tertiary accent | Coral for destructive actions, error notices, and accents in artwork. | The same fill with Ink text. Standalone destructive text can use Coral. |

**The Pastel Rule.** Keep Ink lettering on Mint, Coral, Butter, and Sage in both themes.

## Typography

Newsreader gives a question the presence of a journal entry. Figtree carries the interpretation, form labels, and instructions. Outfit sets the Reflection wordmark and the small position numbers. JetBrains Mono distinguishes recovery material and technical identifiers. The fonts ship with the app. [Type styles and font assets](src/client/design/tokens.css)

- **Titles.** The poster display style is 88/88 px. General page titles scale from 40 to 64 px. The welcome title has its own scale and renders at 36 px on a 390 px phone. Section and card titles use the 40/44 and 28/34 px styles.
- **Reading text.** Body copy is 16/24 px, with 20/30 px for a lead and 14/20 px for supporting copy. Field hints and chips use the 12/18 px caption. Button and field labels use 600 weight.
- **Return visits.** A history question uses 22/24 px Newsreader, beneath a small Figtree date with tabular numerals. A long question wraps. The chevron stays beside the question.

## Layout

The header aligns its mark and theme control within a centered shell (1120 px maximum on entry). The reading column has a 760 px maximum, Account uses 940 px, and the new-reading form expands to 1080 px. Within that form the question and photo take roughly two thirds of the width. A narrower column holds the disclosures and Start action.

At 900 px and below, the welcome page stacks its controls above the bloom. At 760 px and below, the new-reading disclosures move beneath the fields and a compact botanical corner replaces the wide ribbon. At 390 px and below, the header tightens its spacing and the wordmark drops to 23 px. Keep history and dated notes in a single reading order. [Responsive layouts](src/client/style.css)

## Elevation & Depth

Fine printed rules separate sections. The regular card edge mixes the theme border at 25% with transparent. Full-strength rules divide entries, reading positions, and disclosures. Evening adds depth by moving from the darker Evening page to an Ink panel. The three shadow tokens all resolve to `none`.

## Shapes

Buttons, chips, and the reading navigation have pill ends. Writing fields have a 12 px radius, while the shared reflection card has 24 px corners and 24 px of padding. Tighter Account groups use 10 px corners. History rows meet at straight horizontal rules. The circular return mark is 30 px across in both themes.

## Components

The controls are easy to touch and quiet on the page. Use the shared React components for their native labels, focus behavior, and theme changes. [Component definitions](src/client/design/components.tsx)

- **Buttons and links.** Primary buttons have a solid fill. Secondary actions have a one-pixel outline. Text buttons and ordinary text links are underlined. Secondary and text buttons fill with Mint on hover and Sage on press. The destructive button starts on Coral and moves through Butter and Sage, always with Ink lettering. Buttons have a 48 px minimum height. Keyboard focus draws a 2 px foreground outline with a 4 px offset.
- **Writing fields.** Keep a visible label above the field and its hint directly below. Textareas resize vertically. Focus picks up the theme ring on both the border and a 2 px outline with a 2 px offset.
- **Navigation and chips.** Saved readings and New reading share one outlined pill, up to 440 px wide. The current destination has a filled segment and `aria-current="page"`. A topic chip is a static label with Mint, Butter, Sage, or Coral fill. The Sage chip identifies the provenance of a reading.
- **History and dated notes.** Group date, question, and chevron in one ruled history row. A revisit note has its own date and preserves the reader’s line breaks. Keep the author’s note, generated interpretation, and traditional source identifiable by their headings. [Reading workspace](src/client/readings.tsx) and [revisit notes](src/client/revisit-notes.tsx)
- **Artwork and motion.** Keep the bloom’s proportions, use the theme-specific return mark, and use the compact artwork supplied for phones. The disclosure chevron turns over 150 ms. A busy spinner takes one second per turn and accompanies written status. Reduced motion removes both effects. [Artwork inventory](src/client/design/art/README.md)

## Do's and Don'ts

### Do

- Do keep the date and full available question preview together when a history row wraps.
- Do retain the visible focus outline and the system highlight for the current navigation segment in forced colors.
- Do label the example spread “Illustration only” and give an uploaded spread its own caption.

### Don't

- Don't place a decorative thumbnail beside an individual saved question.
- Don't use artwork to communicate progress, deletion, or recovery status.
- Don't clip a reader’s note or replace its paragraph breaks with a single line.
