# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Reflection serves two readers equally. Someone new to tarot can bring a personal question and let the app draw three cards. Someone with an established tarot practice can bring a photo of a spread they have already drawn. Both want a private place to consider the question in their own words and return to it later.

## Product Purpose

The priority is the return visit. A reader should be able to find an earlier question by its date and wording, reopen the exact reading, and add a dated note about what still fits or what has changed. When priorities compete, this return journey takes precedence over starting another reading.

## Positioning

The three positions are Situation, Tension, and Possibility, read from left to right. The reader can inspect which cards appeared, their orientations, and the traditional source text behind the generated interpretation. The saved edition gives the reader a fixed point of comparison as their own understanding changes.

## Operating Context

- A reader signs in with a passkey or with their username or email and a password. Their recovery kit lets them regain access. Returning readers can open the shared **Journal** directly and filter Tarot, Astrology or Imported records.
- **Save reading** works even when the reader has nothing to write. **Save reflection** keeps the reader’s words and also saves the reading if it was temporary.
- A reader can edit their initial reflection or add a separate dated revisit note to the same edition. Reopening a reading and saving a note both work without a new AI call.

## Capabilities and Constraints

- Readings currently support English. AI permission starts off. In live mode, OpenAI receives the question, cards, and source meanings to write the reading. Attaching a spread photo also sends that image to Meta for recognition.
- Starting a reading authorizes 24 hours of temporary storage from creation. Saving keeps the reading and its basis until deletion. Private content is encrypted at rest and readable by the service for authorized operations.
- With AI permission off, readers can still open saved readings, write reflections and notes, export their records, and delete them. Personal writing stays out of new readings by default.
- Follow-ups are editions of one saved reading in the qualified local/synthetic workflow; live continuity remains gated. Each accepted follow-up is kept automatically with the original. The reader saves or deletes the whole reading. Deleting the original deletes every follow-up, including follow-ups to earlier follow-ups.
- Selected excerpts and older-journal imports have explicit review and confirmation flows. Imports remain historical records and cannot authorize native tarot follow-ups. Public launch geography and minimum age remain undecided.
- Your Pattern is implemented in the local preview: review birth details, explore a supported chapter, save it with optional writing, and return to that exact chapter in the journal. Exact, approximate and unknown birth times retain their real uncertainty; unsupported placements are left out. Calculation and authored chapter text do not use an AI writer.
- Removing the current birth profile leaves saved chapters and their original birth details intact until those readings are deleted separately. Native exports include a profile restoration candidate; importing never replaces the current profile implicitly.
- Your Pattern production activation remains closed pending independent numerical qualification, hosted resource checks and editorial approval of the exact catalogue. Timing and Time Travel are future flows.

## Brand Commitments

The product is **Reflection**. Its welcome line is “A little space to reflect.” Reading copy offers a concrete observation or an optional next step grounded in the question and cards. Predictions, diagnoses, and claims about another person’s thoughts fall outside its scope.

## Product Principles

- Make an old question recognizable even to someone who has forgotten the cards.
- Make authorship clear wherever the draw, a traditional meaning, an AI interpretation, and the reader’s own words appear together.
- Leave room for “Unsure” and “Disagree.” Readers decide what fits and whether to respond.
- Explain what leaves the device and what will be kept at the moment the reader chooses to start, attach a photo, or save.

## Accessibility & Inclusion

WCAG 2.2 AA is the acceptance target. A reader must be able to identify each card, position, and orientation from text, inspect the sources with a keyboard, and hear progress and save confirmations. These journeys must remain usable at narrow widths, at 200% zoom, and with forced colors. Physical-device and assistive-technology acceptance is still open. [Browser qualification](docs/BROWSER_QUALIFICATION.md)

## Evidence on Hand

- Examples and review criteria for readings grounded in the question and sources. [Reading editorial standard](docs/operations/reading-editorial-standard.md)
- Recorded local results for saving, signing back in, reopening an edition, and adding dated notes. [Saved-reading results](docs/SAVED_READING_RESULTS.md) and [dated-note verification](docs/verification/2026-11-01/dated-revisit-notes.md)
- The current scope of selected context, follow-ups, and imports. [Milestone 3 preparation](docs/MILESTONE_3_PREPARATION.md) and [implemented foundations](docs/MILESTONE_3_FOUNDATIONS.md)

- [Your Pattern local acceptance](docs/YOUR_PATTERN_RESULTS.md) records the calculated chapter, shared journal and retained-original journey, including remaining activation limits.
