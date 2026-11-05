# Milestone 3 review fixes implementation plan

**Goal:** Address the five findings from the approved comparison of the Milestone 3 Figma concepts with the app.

**Architecture:** Keep the React components, existing tokens and artwork, and owner-scoped services. Improve presentation and navigation without changing grant, request confirmation, follow-up retention, deletion or provider qualification rules. Private drafts remain in memory.

**Spec:** The user-approved findings: exact follow-up identity and early edition navigation; recognizable context sources with no default excerpts; a focused final review; readable import groups with full preview and resume; saved reflections shown for reading before editing.

- [ ] Add browser regressions for a reopened follow-up’s exact parent and reused draw, final review before dispatch, and saved reflection read/edit/cancel.
- [ ] Move edition navigation above interpretation. Load owner-scoped edition descriptions with cancellation and unavailable/error fallbacks. Preserve exact edition URLs and show parent question and “No new draw.”
- [ ] Default context browsing to the exact parent, keep excerpt selection empty, simplify whole/partial excerpt selection and compact preview. Preserve Unicode budgets, grant revision checks and invalidation after edits. Expose reviewed text to the local submission-review view.
- [ ] Add a final follow-up review containing the question, exact parent, selected excerpts or explicit absence, retention and recipient notice. Back preserves drafts; changes invalidate confirmation; Enter cannot bypass review.
- [ ] Keep recognizable import questions, dates and content through review and resume. Explain duplicate/conflict/missing-parent outcomes beside actions, move technical identifiers into details, and preserve one explicit confirmation per group. Where resumed review needs text, project only currently eligible owner-scoped decrypted preview units, with no new storage.
- [ ] Show saved reflections as text with author/date/stance and an explicit Edit action. Preserve dirty drafts, cancellation focus, conflict recovery, deletion-safe mounted editors and AI-off access. Place personal writing alongside interpretation at desktop widths with a single mobile reading order.
- [ ] Run focused browser and database regressions in isolated local environments, inspect Paper/Evening desktop/mobile renders, run schema/OpenAPI generation if contracts change, then run `npm run verify` and the shared journey suite sequentially on the final source.

**Review focus:** unavailable/deleted parents; stale/cross-account/expired previews; request retries and confirmation binding; unsaved reflection/revisit drafts; long questions/notes and 51-edition families. No live provider calls, hosted signups, deployment changes or changes to the scheduled hosted deletion test are needed.
