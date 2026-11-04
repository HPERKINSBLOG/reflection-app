# Follow-up readings

In the local synthetic workflow, each follow-up has its own question and answer and preserves the exact parent edition. [Milestone 3 evidence](../MILESTONE_3_RESULTS.md)

On 2026-11-03 the owner confirmed that the reader saves and deletes the original reading and all of its follow-ups together. [Decision D1](../MILESTONE_3_PREPARATION.md#decisions-and-proposed-defaults)

## Screens and behavior

- **Ask a follow-up** is available from a saved reading. The composer names the exact saved parent's question, date and edition, shows its original three-card draw and labels the new question as a follow-up. No implicit “latest reading” lookup.
- The original draw/orientations and approved source snapshot are reused; no new draw or replacement photograph is implied. A person wanting a new draw uses the existing new-reading flow.
- Additional reflection/revisit context starts unselected and goes through the separate preview/permission flow. Display allowance use and the full provider/storage disclosures before submission.
- Progress, lost acknowledgement, cancellation, refusal, failure and completion use the current single-request lifecycle. The result is a new accepted child with an exact parent edition ID and a **Back to original reading** link, not an overwritten parent.
- An accepted follow-up is kept automatically with the saved original. Offer one reading-level Save or Delete action wherever the reader is in its edition history. Each follow-up identifies its parent in history and export. Writing a reflection is optional and explicit.
- Before the reader confirms deletion of the original reading, say that all of its follow-ups will also be deleted. This includes follow-ups to earlier follow-ups. Opening an old link after deletion shows that the reading is unavailable.

## Acceptance

- [ ] Parent identity is stable across navigation, retries, concurrent newer editions and reload. The server rechecks ownership, saved state and exact edition before dispatch; deleted/unsaved parents block submission with a recoverable draft.
- [ ] A follow-up cannot redraw, mutate accepted parent text, silently add context or exceed allowance through duplicate Start requests.
- [ ] Provenance records the exact parent, reused draw/source versions and acknowledged context snapshots. Child text is clearly labelled as a new AI interpretation, separate from authored notes and traditional sources.
- [ ] After signing back in with AI off, the reader can reopen an accepted follow-up byte-for-byte without having saved it separately. Moving between editions preserves dirty-draft warnings, completion focus and the return to history.
- [ ] Delete an original with two follow-ups, including one based on the other. Verify that none of their content can be reopened from history or direct links or retrieved in a new export. A separate reading with no shared context is still accessible.
- [ ] A follow-up already in progress cannot publish after deletion. A retry or recovery cannot restore the deleted content.
- [ ] Cover empty and long questions, unavailable parents, revoked context, and pending, cancelled, or failed requests in backend and browser tests.
- [ ] Full content, disclosures and parent references remain readable at 320/390/768/1280 px in both themes and enlarged text, with keyboard and assistive-technology acceptance recorded honestly.
- [ ] Verify the shared deletion policy in the working flow, compare screenshots, run `npm run verify`, and refresh QA before acceptance.
