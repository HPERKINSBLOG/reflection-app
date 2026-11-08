# Tarot Steps Before Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split a new tarot reading's start into Question, Spread, Photo and Review steps, and show the three drawn cards before the interpretation, without changing the API or the reading workspace.

**Architecture:** The new step screens are presentational components in new files (`src/client/tarot-steps.tsx`, `src/client/tarot-cards.tsx`, `src/client/drawn-cards.ts`). `ReadingWorkspace` in `src/client/readings.tsx` keeps all state, the single `form.new-reading`, its submit handler and the request lifecycle. It gains `step`, `spreadChoice`, an in-memory waiting mark and `cardsFor`. Follow-ups keep today's form.

**Tech Stack:** React + TypeScript client, Cloudflare Worker served by `scripts/local-identity.ts --test`, Vitest (`vitest.domain.config.ts`, node environment), Playwright (Chromium), Biome.

**Spec:** `docs/superpowers/specs/2026-11-07-tarot-steps-design.md` (approved 2026-11-08). Executors read both documents. All copy below is quoted from the spec.

## Global Constraints

- No server, API, contract or database change. The `POST /api/v1/requests` body is unchanged, except that `spreadPhoto` is sent only when the person continued from the Photo step.
- Locked copy: `READING_PRODUCT_COPY` and `SPREAD_PHOTO_COPY` (`src/contracts/product-copy.ts`) are reused verbatim and never edited.
- Every composer step stays at `/new` and uses `replaceState`. Readings keep `/requests/{requestId}`. The Cards step adds no URL.
- Start reading is the only control that creates a request, and it exists only on Review.
- Follow-ups are unchanged and never show Cards.
- The shared header stays. Use only existing tokens and components: `Button`, `ReflectionField`, `Input`, `Notice`, `Art`, `CardFace`, `TopicChip`.
- `npx biome check .` reports no errors and no more warnings than the base branch: 12 at 22b4bee. Today's uncommitted journal work, which removes two of them, is not on this branch.
- New browser tests use unused client addresses: 198.51.100.10–23 and 203.0.113.10–13, passed through `account(page, ip)`.
- Port 8787 must be free before Playwright runs. After `npm run test:browser`, restore the files it rewrites: `git checkout -- artifacts/browser-tests.json artifacts/your-pattern/`.

## Review Focus

1. Excerpts are confirmed, then the question is edited from Review. Continuing must stay blocked until the excerpts are confirmed again. Pinned in Task 4.
2. A photo is still preparing when the person chooses "Use an app draw instead". Review shows an app draw, and Start sends no `spreadPhoto`. Pinned in Task 3.
3. Start is double-clicked, or Enter is pressed in the question field. Exactly one request is created, and Enter never submits. Pinned in Task 2.
4. Back or Forward to an earlier reading's `/requests/` address after a new reading never shows that earlier reading's cards. Pinned in Task 5.
5. A 500-character question at 320 px wraps in the Review summary and on Cards without horizontal scrolling. Pinned in Task 6 (`journey-layout.spec.ts`).

---

### Before Task 1: workspace

- [ ] Use superpowers:using-git-worktrees to create a worktree on new branch `design/tarot-steps` from `design/mend-polish` (22b4bee). The main checkout's uncommitted journal and Account work stays where it is.
- [ ] Reuse the main checkout's installed packages through a directory junction (`node_modules` → the main checkout's `node_modules`). Do not run `npm ci` there: `.npmrc` is engine-strict for Node 26.12.1, while this machine runs Node 24.15. Before removing the worktree, remove the junction with `cmd /c rmdir`, never with a recursive delete.
- [ ] Copy this plan and the spec into the worktree, then commit them with the message `Docs: tarot steps design and plan`.

### Task 1: Drawn cards helper

**Files:**
- Create: `src/client/drawn-cards.ts`
- Modify: `src/client/return-interpretation.tsx:33-38`, so the card-name lookup goes through `drawnCards`
- Test: `tests/domain/drawn-cards.test.ts`

**Interfaces:**
- Produces:
  - `POSITION_LABELS: Record<'situation' | 'tension' | 'possibility', 'Situation' | 'Tension' | 'Possibility'>`
  - `interface DrawnCard { position: 'situation' | 'tension' | 'possibility'; label: string; cardId: string; orientation: 'upright' | 'reversed'; name: string | undefined }`
  - `drawnCards(reading: { kind: string; basis: { deckEdition: string; cards: Array<{ position; cardId; orientation }> }; draw?: Array<{ position; name: string }> }): DrawnCard[]`. It always returns Situation, Tension, Possibility in that order. For `tarot.accepted.v2`, names come from `draw`. Otherwise they come from `cardName(deckEdition, cardId)`.

- [ ] **Step 1: Write the failing tests.**
  - `v2 names come from the draw, in position order`: `basis.cards` are given in the order possibility, situation, tension, with `draw` names `['A', 'B', 'C']` keyed by position. Expect positions `['situation', 'tension', 'possibility']`, the draw names, and the labels `['Situation', 'Tension', 'Possibility']`.
  - `v1 and v3 names come from the edition catalogue`: use the first edition key in `src/client/card-names.json` with cards `major-09`, `major-14` and `swords-02`. Expect names equal to that catalogue's entries. With edition `'unknown'`, every `name` is `undefined`.
- [ ] **Step 2: Watch them fail.** Run `npx vitest run --config vitest.domain.config.ts tests/domain/drawn-cards.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `drawnCards`** and switch `ReturnInterpretation` to it. Its output must not change.
- [ ] **Step 4: Watch them pass.** Run the same command (PASS), then `npm run typecheck` (PASS).
- [ ] **Step 5: Commit** with the message `Tarot: share drawn card names`.

### Task 2: Question, Spread and Review for app draws

**Files:**
- Create: `src/client/tarot-steps.tsx`
- Modify: `src/client/readings.tsx`:
  - state, lines 272–297
  - header nav, 962–1028
  - `onTarot`, 1113–1126
  - `onReviewDraft`, 1209–1240
  - `onAccepted`, 1241–1253
  - `navigationRef` new branch, about 689–700
  - form, 1261–1557
- Modify: `src/client/style.css`, the composer block at 1676–1890
- Modify: `tests/fixtures/browser-reading.ts`
- Test: `tests/browser/tarot-steps.spec.ts` (new)

**Interfaces:**
- Produces, in `tarot-steps.tsx`:
  - `type ComposerStep = 'question' | 'spread' | 'photo' | 'review'` and `type SpreadChoice = 'draw' | 'photo'`
  - `QUESTION_SUGGESTIONS = ['What deserves more space in my life?', 'How can I make room for my own needs?'] as const`
  - `ReadingSteps({ current }: { current: 'question' | 'spread' | 'cards' })`: an `ol` with `aria-label="Reading steps"`, items "01 Question", "02 Spread", "03 Cards" and "04 Reading", and `aria-current="step"` on the current item.
  - `QuestionStep({ headingRef, fieldRef, question, error, continueError, busy, context, onQuestion, onContinue, onJournal })`
  - `SpreadStep({ headingRef, reversals, busy, onReversals, onDraw, onPhysical, onBack })`
  - `ReviewStep({ headingRef, question, spread, context, notices, english, busy, startDisabled, startHint, remaining, onEnglish, onEditQuestion, onChangeSpread })`, where:
    - `spread` is `{ kind: 'draw'; reversals: boolean } | { kind: 'photo'; name: string; dataUrl: string }`
    - `context` is a `ReactNode | null`
    - `remaining` is `{ day: number; month: number }`
    - Its side panel keeps `<aside aria-labelledby="reading-preflight-title">` with the h3 "Before you start". The panel holds the notices, English, "Readings left: N today · M this month." and `<Button type="submit">Start reading</Button>`.
- Produces, in `readings.tsx`: state `step`, `spreadChoice`, `questionError`, `continueError`; the ref `stepHeading`; `goToStep(next: ComposerStep): void`, which sets the step and focuses the heading after commit; and `openJournal()`, extracted from the header's Journal handler.
- Produces, in `browser-reading.ts`:
  - `openTarot(page)`
  - `toReview(page, question, options?: { reversals?: boolean; photo?: string | { name: string; mimeType: string; buffer: Buffer } })`, which ends on Review
  - `startFromReview(page)`, which checks English and clicks Start reading
  - `reading(page, question)`, rewritten to use them

- [ ] **Step 1: Write the failing tests** in `tarot-steps.spec.ts`, using 198.51.100.10–15:
  - `a new reading moves from question to spread to review, and only review can start`:
    - After Tarot, the heading "What is on your mind?" is focused and "01 Question" is current. No "Start reading" button exists.
    - Fill the question, then "Choose your spread": "One question. Three perspectives." is focused and "02 Spread" is current.
    - "Let Reflection draw": Review shows "Ready when you are.", the question text, and "App draw · Reversed cards: Off". The complementary "Before you start" contains `READING_PRODUCT_COPY.startProcessing`.
    - Start is disabled until English is checked.
    - A double click sends exactly one `POST /api/v1/requests`, whose body has `reversals: false` and no `spreadPhoto`. Pressing Enter in the question field sends nothing.
  - `an empty question cannot continue`: "Enter your question to continue." is visible, the field is focused with `aria-invalid="true"`, and the question heading is still shown.
  - `going back keeps every entry`:
    - Reversed cards on, then "Let Reflection draw": Review shows "Reversed cards: On".
    - "Edit your question" keeps the text, and the Spread step still has reversals checked.
    - "Back to your question" keeps the text, and "Change the spread" returns to Spread.
  - `suggested questions appear only while the question is empty`:
    - The group "A place to begin" holds two buttons.
    - Clicking the first fills the field and focuses it, and the group disappears.
    - Clearing the field brings the group back.
  - `open your journal leaves the composer and tarot returns with the question`
  - `the steps can be completed by keyboard alone, and every step passes axe`. Reuse the axe helper from `journey-accessibility.spec.ts`.
- [ ] **Step 2: Watch them fail.** Run `npx playwright test tests/browser/tarot-steps.spec.ts`. Expected: FAIL, the heading "What is on your mind?" is not found.
- [ ] **Step 3: Implement the components and wiring.**
  - The submit handler's first guard is `if (mode === 'new' && step !== 'review') return;`.
  - Reset `step` to `'question'`, `spreadChoice` to `'draw'` and both errors to `null` wherever today's code resets the question or context: the Tarot nav, the `navigationRef` new branch, `onTarot`, `onReviewDraft` and a successful `onAccepted`.
  - Typing in the question clears `questionError`.
  - All copy comes from the spec.
- [ ] **Step 4: Update the helper.** `reading()` becomes enableAi → openTarot → toReview → startFromReview → expect `accepted-reading`. Task 5 adds the Cards click.
- [ ] **Step 5: Watch them pass.** Run the spec (PASS), `npm run typecheck`, and `npx biome check .`. Older specs that drive the old form keep failing until Task 6.
- [ ] **Step 6: Commit** with the message `Tarot: question, spread and review steps`.

### Task 3: Photo step

**Files:**
- Modify: `src/client/tarot-steps.tsx`, adding `PhotoStep`
- Modify: `src/client/readings.tsx`:
  - Move the chooser markup (1357–1475) into `PhotoStep`.
  - Extract `choosePhoto(file: File): void` from the input's `onChange`.
  - Send the photo only when `spreadChoice === 'photo'`.
- Modify: `src/client/style.css`
- Test: `tests/browser/tarot-steps.spec.ts`

**Interfaces:**
- Produces: `PhotoStep({ headingRef, inputRef, chooseRef, photo: { dataUrl: string | null; name: string | null; preparing: boolean; announcement: string }, notice, busy, onFile, onRemove, onContinue, onAppDraw, onBack })`.
- The input's label becomes "Photo of your spread", without "(optional)". The ids `reading-spread-photo`, `reading-spread-photo-help` and `reading-photo-processing` stay.

- [ ] **Step 1: Write the failing tests**, using 198.51.100.16–18:
  - `a physical spread needs a ready photo before review`:
    - "Use my physical spread" shows "Bring the cards you drew.", and "Review your reading" is disabled.
    - After a file is set, it is enabled. Review shows "Your spread photo", the file name and the image.
    - The Start body's `spreadPhoto` equals the data URL.
  - `an app draw instead never sends the chosen photo`: after a photo is chosen, "Use an app draw instead" leads to Review showing "App draw" with no image. The body has no `spreadPhoto`.
  - `a photo still preparing then an app draw sends nothing` (Review Focus 2): reuse `spread-photo.spec.ts`'s slow-read hook (`releasePhotoReads`).
  - The Photo step passes axe, both empty and with a photo attached.
- [ ] **Step 2: Watch them fail.** Run the spec. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Watch them pass.** Run the spec (PASS), then typecheck.
- [ ] **Step 5: Commit** with the message `Tarot: photo step for a physical spread`.

### Task 4: Excerpts on Question, listed on Review

**Files:**
- Modify: `src/client/submission-review.tsx`. Extract `SelectedContextSummary({ context }: { context: ContextSubmission })` from `FollowUpReview`, without changing its output.
- Modify: `src/client/readings.tsx`:
  - The `ContextSelection` element becomes `QuestionStep.context`.
  - Continuing while `!contextReady` sets `continueError` to "Review and confirm your selected excerpts to continue.".
  - The Review context is `user.continuityReady ? <SelectedContextSummary context={context} /> : null`.
- Test: `tests/browser/tarot-steps.spec.ts`, reusing the saved-reading setup from `selected-context.spec.ts`

- [ ] **Step 1: Write the failing tests**, using 198.51.100.19–21:
  - `unconfirmed excerpts block the spread step`
  - `review lists exactly the confirmed excerpts`. With none selected, Review shows "No excerpts selected. No earlier writing will be sent.".
  - `editing the question after confirming excerpts needs a new confirmation` (Review Focus 1)
- [ ] **Step 2: Watch them fail.** Run the spec. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Watch them pass.** Run the spec and `npx playwright test tests/browser/follow-up.spec.ts` (PASS, follow-up output unchanged).
- [ ] **Step 5: Commit** with the message `Tarot: excerpts on the question step`.

### Task 5: Cards step and the drawing indicator

**Files:**
- Create: `src/client/tarot-cards.tsx`
- Modify: `src/client/readings.tsx`:
  - the waiting mark
  - `cardsFor`
  - `onTarget`
  - the Resume button
  - `onAccepted`
  - `clearReading`
  - the focus effect at 240–251
  - rendering
- Modify: `src/client/style.css`
- Modify: `tests/fixtures/browser-reading.ts`, adding `readInterpretation(page)` and calling it from `reading()`
- Test: `tests/browser/tarot-steps.spec.ts`

**Interfaces:**
- Consumes: `DrawnCard` and `drawnCards` (Task 1), and `ReadingSteps` (Task 2).
- Produces: `CardsStep({ headingRef, question, cards: DrawnCard[], onRead })`. Each card is a `figure` with a visible caption "Situation: {name}, {orientation}" next to the aria-hidden `CardFace`.
- `awaitingCards = useRef<string | null>(resume?.request?.pending ? resume.request.target.id : null)`:
  - A new-reading Start sets it to `draftIntent`.
  - `onTarget` moves it to the new target id when it equals `resumeTarget.current?.id`.
  - The Resume button sets it to `requestPending ? target.id : null`.
- `onAccepted`:
  - `show = awaitingCards.current !== null && awaitingCards.current === target?.requestId`
  - then clear the mark, and `setCardsFor(show ? target.editionId : null)` **before** `open()`
  - clear `cardsFor` if `open()` fails
- `showCards = mode === 'reading' && reading && !reading.parentEditionId && cardsFor === selectedEditionId`. When it is true, render `<ReadingSteps current="cards" />` and `CardsStep` instead of the `reading-detail` section, and focus the Cards heading.
- "Read the interpretation" clears `cardsFor` and focuses the reading's h2.
- `clearReading()` clears `cardsFor`.
- `<ReadingSteps current="cards" />` sits above `RequestProgress` when `request?.start && !request.start.input.parentEditionId`.

- [ ] **Step 1: Write the failing tests**, using 198.51.100.22–23 and 203.0.113.10–13:
  - `a new reading shows its three cards before the interpretation`:
    - "Take a moment with the spread." is focused.
    - Three captions appear in Situation, Tension, Possibility order. Their names match the reading's sources section.
    - "03 Cards" is current, and the URL matches `/requests/`.
    - "Read the interpretation" shows `accepted-reading` with the question h2 focused.
  - `reloading or reopening a reading goes straight to the interpretation`: a reload, and a Journal open, both show no Cards heading.
  - `a follow-up never shows the cards step`
  - `returning to a reading still in progress shows the cards`: delay publication with `request-lifecycle.spec.ts`'s request interception, then go to the Journal, choose "Resume reading request", and release.
  - `history navigation to an earlier reading never shows its cards` (Review Focus 4)
  - `the drawing screen shows the steps for a new reading only`
  - The Cards step passes axe.
- [ ] **Step 2: Watch them fail.** Run the spec. Expected: FAIL.
- [ ] **Step 3: Implement.** Then add `readInterpretation` to `reading()`.
- [ ] **Step 4: Watch them pass.** Run the spec (PASS), then typecheck and Biome.
- [ ] **Step 5: Commit** with the message `Tarot: cards before the interpretation`.

### Task 6: Migrate the existing browser specs

**Files:**
- `tests/fixtures/browser-display.ts` and `tests/fixtures/browser-journey.ts`. Check line 516: if it is a follow-up, leave it.
- Specs:
  - `identity-account-controls`
  - `interface-clarity`
  - `journey-accessibility`
  - `journey-cross-browser`
  - `journey-layout`
  - `live-mode`
  - `reading-deletion`
  - `reading-return` (check line 94)
  - `readings`
  - `request-lifecycle`
  - `revisit-notes`
  - `selected-context`
  - `spread-photo`
  - `your-pattern`
  - `design-screens`

Rules:

- **R1.** "Fill the question, check English, click Start reading" becomes `toReview` + `startFromReview`. Add `readInterpretation` wherever the test then expects the accepted reading.
- **R2.** "Use my own spread" plus `setInputFiles` becomes `toReview(page, q, { photo })`, or the Photo step's "Photo of your spread" input.
- **R3.** Start-disabled assertions about the question or excerpts become Question-step blocking assertions. Assertions about English stay on Review.
- **R4.** The heading "A new reading" becomes "What is on your mind?".
- **R5.** `spread-photo.spec.ts`'s submit-while-preparing test now asserts that "Review your reading" is disabled while preparing, and that a dispatched submit on the Photo step sends nothing.
- **R6.** Specs that check `complementary "Before you start"` (`live-mode.spec.ts` 144 and 202) navigate to Review first.
- **R7.** Apply the spec's Cards rule to reloads and resumes:
  - `request-lifecycle.spec.ts`: "lost Start acknowledgement then reload…" and "…explicit resume can"
  - `selected-context.spec.ts`: the reload after acceptance
  - `identity-account-controls.spec.ts`: the Account round trips
- **R8.** Follow-up assertions stay as they are.
- **R9.** Add a 320 px check to `journey-layout.spec.ts`: a 500-character question wraps on Review and Cards without horizontal scroll (Review Focus 5).

- [ ] **Step 1:** Apply the rules file by file, running `npx playwright test tests/browser/<file>` after each one until it passes.
- [ ] **Step 2:** Run `npm run test:browser`. Expected: everything passes except the skip that needs `REFLECTION_SCREENS`.
- [ ] **Step 3:** Restore the rewritten artifacts.
- [ ] **Step 4: Commit** with the message `Tests: walk the tarot steps`.

### Task 7: Docs, full verification and PR

- [ ] **Step 1: Document it.**
  - `DESIGN.md`: a "Tarot steps" component entry.
  - `design-qa.md`: a "November 8 — Tarot steps" section with captures of every step at 1440 and 390 px.
- [ ] **Step 2: Run the full checks.** Expected: all pass, with Biome at no more than the base branch's 12 warnings.
  - `npm run typecheck`
  - `npx biome check .`
  - `npm run test:domain`
  - `npm run test:db`
  - `npm run test:browser`
  - `npm run check:schemas`
  - `npm run check:contracts`
  - `npm run check:openapi`
- [ ] **Step 3:** Restore the artifacts and commit with the message `Docs: record the tarot steps and their checks`.
- [ ] **Step 4: Open the PR.** Push `design/tarot-steps` and open a draft PR against `design/mend-polish` titled "Tarot: steps before Start and a moment with the cards". Retarget it to `main` after PR #15 merges.
