# Tarot steps before Start: design for review

Status: approved for implementation on 2026-11-08. The owner replied "Approve it" to this document after the builder check, approving the flow and every call listed at the end.

## What the owner decided

The owner chose **Steps before Start**: "Split the start into question, spread and review steps, then show the three cards before the reading. Keep today's reading workspace, which already matches Figma's Return and continue frame. Own branch and PR."

In the same pass the owner kept the shared site header on Account and kept the visible navigation row on phones (no menu button). When offered a round of questions about the open points below, the owner replied "Resume", which I took as "decide them yourself". Every point marked **My call** is mine, not the owner's, and is listed again at the end for checking.

## Why

A new reading starts from one dense form today (`src/client/readings.tsx`, the `form.new-reading` block). It asks for the question, English confirmation, reversed cards, an optional photo of your own spread and journal excerpts all at once, beside a "Before you start" panel with the storage and provider notices and the Start button. The Figma tarot journey gives each decision its own screen. That way a person meets one choice at a time, sees everything that will be shared before starting, and takes a moment with the drawn cards before reading someone else's interpretation of them.

Reference: Figma file `a0u0Ok74iKTMjp1L5osRnU`, frames 73:3512 (01 question), 73:3514 (03 spread), 73:3515 (04 photo), 73:3518 (07 review), 73:3519 (08 drawing), 73:3521 (10 cards), and the flow guide 78:4872. Layout and spacing come from those frames. Copy comes from this document.

## Goals

1. A new reading moves **Question → Spread → (Photo) → Review → drawing → Cards → the existing reading workspace**.
2. Start reading exists only on Review, and Review shows everything that will be sent: the question, the spread choice, any photo, any selected excerpts and the full disclosures.
3. Every rule the current form enforces still holds: the 500-character question, required English confirmation, the excerpt confirmation binding, photo preparation and limits, AI permission, service status, one request per start intent.
4. Moving between steps never loses the typed question, the chosen photo or the excerpt selection.
5. After a new reading is accepted, its three cards are shown on their own before the interpretation.

## Non-goals

- **Follow-ups keep today's flow.** They already have compose and review screens (`FollowUpReview` in `src/client/submission-review.tsx`), reuse the original cards and draw nothing new, so they skip the Cards step.
- **No AI permission step inside the flow** (Figma 06, 73:3517). **My call.** Figma's version lets a person keep permission off and still continue, which implies a reading without AI permission or a consent grant mid-flow. That is a product and privacy change, not a layout change. Today's behaviour stays: Tarot is unavailable while AI readings are off, and the existing notice links to Account.
- **No card detail screen** (Figma 11, 73:3522). Cards are not interactive in this pass.
- **No focused "Close" header.** **My call.** The shared header stays on every step, consistent with the owner's Account decision.
- **No card numerals** (Figma shows "IX", "XIV"). The app has no numeral data. `CardFace` shows the suit label instead.
- **No change to locked disclosure wording.** `src/contracts/product-copy.ts` says any change needs a new content hash and editorial approval. Where Figma's provider wording differs, the app's existing constants win.
- **No restyle of the drawing screen** to Figma 08. **My call.** The request screen keeps its status copy and behaviour, which the request-lifecycle tests rely on. It only gains the step indicator.
- No server, API, contract or database change. The start payload is unchanged.
- No new draft persistence. Drafts stay in memory as today.

## Anti-goals: failures even if the screens work

- Any path that starts a reading without passing Review with English confirmed.
- Sending a photo or excerpt that Review did not list.
- A second request caused by step navigation, Back, retries or double clicks.
- Losing the question, photo or excerpt selection when moving between steps.
- Showing the Cards step when reopening a saved reading from the journal, a link or a reload.

## The flow

### Step indicator

An ordered list labelled "Reading steps": **01 Question / 02 Spread / 03 Cards / 04 Reading**, with `aria-current="step"` on the current item. Question marks 01. Spread, Photo and Review mark 02, because Review closes out the setup. The drawing screen and Cards mark 03. **My call:** the indicator appears on new-reading screens only. The reading workspace stays as it is today, without it. On phones the four labels wrap onto two lines rather than scrolling sideways.

### 1. Question (Figma 73:3512)

- Eyebrow "A new tarot reading". Heading "What is on your mind?". Lead "Bring a question you would like a little space to consider."
- The question field keeps its label "Your question", its 500-character limit and its id. The hint becomes Figma's "Up to 500 characters · Start with what you are considering."
- **A place to begin** (**My call**): two suggested questions from Figma, "What deserves more space in my life?" and "How can I make room for my own needs?". They show only while the field is empty, so they never overwrite typing. Choosing one fills the field and moves focus to it.
- Journal excerpts (`ContextSelection`, shown when continuity is ready) stay on this step below the question. **My call:** the excerpt confirmation is bound to the question text, so the excerpts belong next to it.
- Arriving from astrology keeps today's notice and pre-filled question.
- Primary button **Choose your spread**. It does not advance with an empty question (field error "Enter your question to continue.", focus returns to the field) or with excerpts selected but not confirmed (the same `contextReady` rule that disables Start today).
- Secondary button **Open your journal** behaves like the Journal item in the header.
- Side panel, from Figma: "A little space to reflect." and "You can be new to tarot or bring an established practice. Begin with your own question; decide what feels useful to you."

### 2. Spread (Figma 73:3514)

- Eyebrow "A new tarot reading". Heading "One question. Three perspectives.". Lead "Situation, Tension, and Possibility—from left to right."
- The **Include reversed cards** checkbox, off by default, sent exactly as today.
- Two large option buttons. Each one moves forward:
  - **Let Reflection draw**: "Draw three cards for this question." Caption "Situation · Tension · Possibility". Goes to Review with no photo.
  - **Use my physical spread**: "Bring a photo of three cards you have already drawn." Goes to Photo. Figma's second caption, "Review the cards and orientations before continuing.", is dropped. **My call:** the app recognises cards only after Start, so nothing can be reviewed beforehand.
- Secondary button **Back to your question**.
- Side panel: "Three positions, in order." and "Situation looks at what is present. Tension explores what feels difficult. Possibility makes room for a next perspective."

### 2a. Photo (Figma 73:3515)

- Eyebrow "A new tarot reading". Heading "Bring the cards you drew.". Lead "Place three cards in order, with their whole faces visible."
- Today's photo chooser moves here unchanged: the file input, accepted types, the preparing state, the preview, Remove photo, live announcements, the size note and `photoNotice`. The empty state keeps the three-card illustration marked "Illustration only".
- Primary button **Review your reading**, enabled once a photo is ready.
- **Use an app draw instead** goes to Review as an app draw. The photo stays in memory but is not sent unless the person comes back here and continues with it. Review never lists a photo that will not be sent. **Back to spread choices** returns to Spread.
- Side panel: "Keep the order visible." and "Left: Situation. Middle: Tension. Right: Possibility. Keep reversed cards as you drew them."

### 3. Review (Figma 73:3518)

- Eyebrow "Review your reading". Heading "Ready when you are.". Lead "Check the question, the spread, and what will be shared."
- Summary rows, each with an edit link:
  - **Your question**: the text. **Edit your question** goes back to Question.
  - **Spread**: "App draw · Reversed cards: Off" or "On", or "Your spread photo" with the file name and a thumbnail. **Change the spread** goes back to Spread.
  - **Selected context**: the excerpts in the same form `FollowUpReview` uses, or "No excerpts selected. No earlier writing will be sent." When continuity is not ready this row is left out.
- The disclosures, verbatim from existing sources: `READING_PRODUCT_COPY.startProcessing`, the `submissionNotice(...)` text, and `photoNotice` when a photo will be sent. The service-status and connection-retry notices stay as today.
- **Use English for this reading (required)** moves here unchanged, along with the existing hint when it is not checked.
- "Readings left: N today · M this month." keeps today's wording.
- Primary button **Start reading** keeps today's submit handler and disabled rules. It is the only control that creates a request.
- Figma's "Review AI permission" link is left out. **My call:** this screen cannot be reached with permission off, and Account is in the header.

### 4. Drawing (today's request screen)

`RequestProgress` is unchanged. The workspace shows the step indicator (03 Cards) above it when the request was started in this tab for a new reading, that is when `request.start` exists without a `parentEditionId`.

### 5. Cards (Figma 73:3521)

- **When it appears.** **My call**, corrected after the builder check. The request screen's acceptance callback can't decide this on its own. Readings live at `/requests/{requestId}`: `open()` replaces or pushes that address, including from the journal. Any arrival at that address mounts `RequestProgress`, which calls `onAccepted` as soon as it sees `published`. Arrivals include a reload, a shared link, signing in to a link, Back and Forward, the trip back from Account, and the Journal's "Resume reading request" button, which stays visible after acceptance.
  - Cards appears only when the person was **waiting for this reading in this tab**: they clicked Start reading, or they came back to its request screen in this tab (Resume reading request, or back from Account) while it was still in progress.
  - The accepted reading must also be an original draw, with no parent edition.
  - It never appears after a page load (reload, link, sign-in), when the reading had already published before the person came back, or for a follow-up.
  - The waiting mark lives in workspace memory only. It is cleared once Cards has been shown or the reading opens without it, and it is never persisted.
- **Address: no change.** The Cards step and the reading after it stay at the address the reading gets today on acceptance (`/requests/{requestId}`). A reload on the Cards step opens the reading directly, because it is a page load.
- Eyebrow "Your three cards". Heading "Take a moment with the spread.". Lead "Each position offers a different way into your question."
- The question, then three `CardFace` cards in position order, each labelled with its position (Situation, Tension, Possibility) and showing its name and orientation. Names come from the same source `ReturnInterpretation` uses: `draw[].name` for v2 and `cardName()` for v1. The builder should share that helper rather than copy it. Physical-spread readings show their recognised cards the same way.
- The note "Illustration only. The card names identify the draw." Figma's "Open any card to inspect its position and orientation" is dropped because card detail is out of scope.
- Primary button **Read the interpretation**. It reveals today's reading workspace and moves focus to its heading, exactly as acceptance does now.
- Side panel: "Notice before interpreting." and "What catches your eye? You can take your time with the cards before reading another perspective."

### 6. Reading workspace

Unchanged.

## State, routing and focus

- **My call:** all composer steps stay at `/new` with `replaceState`, as the app does today. The current step is component state (`question | spread | photo | review`). In-page buttons move between steps. Browser Back keeps today's behaviour: it leaves `/new`, with the existing discard confirmation. Real history entries per step could be a later follow-up.
- The question, reversals, photo, excerpt selection and English confirmation persist across steps. They reset only where today's code resets them: a deliberate new reading from the header, acceptance, and the astrology hand-off.
- Editing the question after confirming excerpts invalidates that confirmation, as today. The person sees it on Question and must confirm again before continuing.
- When the server sends the draft back (`onReviewDraft`), the flow returns to Question with today's message, because excerpts must be chosen again.
- Every step change moves focus to the new step's heading (`tabIndex={-1}`), as the composer heading does today.
- The header's Tarot button returns to Question with the question kept and excerpts cleared, as today.

## Accessibility

- The step indicator is an `ol` with `aria-current="step"`. Visually it is Figma's "01 QUESTION / 02 SPREAD / …" row.
- The spread options are buttons with their descriptions linked by `aria-describedby`.
- Field errors use the existing error pattern and are announced.
- Every step can be completed by keyboard alone, and the axe checks in the accessibility journey must pass on every step.

## Layout

The desktop layout follows the Figma frames: content on the left, side panel on the right. That reuses today's `.new-reading-layout` and `.reading-preflight` structure and the shared 1328 px page width. On phones the panels stack. Tokens, type, buttons and art come from the existing system. The question step keeps today's spread-ribbon art.

## Testing

- Update the `reading()` helper in `tests/fixtures/browser-reading.ts`: Tarot → fill question → Choose your spread → Let Reflection draw → check English → Start reading → Read the interpretation → accepted reading visible.
- Update the other composer references: 13 browser spec files plus `tests/fixtures/browser-display.ts`, about 49 references in all.
- Check every test the builder check found near the Cards rule against that rule:
  - `tests/fixtures/browser-display.ts`, used by the native-zoom and forced-colors journeys. Its readings start in the tab, so they will see Cards.
  - In `request-lifecycle.spec.ts`: "lost Start acknowledgement then reload…" (a page load, so no Cards) and "…explicit resume can" (Cards only if it resumes while in progress).
  - The reload straight after acceptance in `selected-context.spec.ts` (no Cards).
  - The Account round trips in `identity-account-controls.spec.ts`.
  
  Tests that read the request id from the URL after a reading keep working, because the address doesn't change. A test that needs Cards starts its reading in the same tab, so no test depends on how fast a request publishes.
- New browser coverage:
  - the step order, and going Back keeps every entry
  - an empty question and unconfirmed excerpts both block advancing
  - a physical spread requires a ready photo
  - "Use an app draw instead" sends no photo
  - Review lists exactly what will be sent
  - Start exists only on Review
  - Cards appears after a new reading, but not after reopening from the journal and not after a follow-up
  - keyboard-only completion
  - axe on every step
- No domain or database tests change. Record results in `design-qa.md` and add a "Tarot steps" entry to `DESIGN.md`.

## Delivery

- **My call:** branch `design/tarot-steps` from `design/mend-polish` in its own git worktree, so the uncommitted journal and Account work stays untouched. Open a draft PR against `design/mend-polish` while PR #15 is open, then retarget it to `main`.
- Left to the builder: component boundaries (pulling the composer out of the 1,968-line `readings.tsx` into its own file is recommended), class names, and exact spacing within the existing tokens.

## My calls, for the owner to check

1. The in-flow AI permission step is left out. Tarot stays unavailable while AI readings are off.
2. The card detail screen, card numerals and a drawing-screen restyle are left out.
3. The shared header stays. No focused Close header.
4. Journal excerpts stay on the Question step.
5. Figma's two suggested questions are added, shown only while the field is empty.
6. The photo is its own step, and "Use an app draw instead" keeps the photo unsent.
7. Steps share `/new`. Browser Back leaves the composer as today.
8. Locked disclosure copy and today's "Readings left" wording are kept over Figma's wording.
9. Cards appears only when the person was waiting for the reading in this tab: they clicked Start, or came back to its request screen in this tab while it was still in progress. It never appears after a page load, for a reading that had already published, or for a follow-up.
10. The reading keeps today's address (`/requests/{requestId}`). The Cards step adds no URL.
11. The branch is stacked on `design/mend-polish`, in its own worktree.
