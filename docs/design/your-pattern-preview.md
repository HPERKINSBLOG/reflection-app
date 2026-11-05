# Your Pattern in the development preview

The existing [Reflection development preview](https://reflection-preview.lfd.workers.dev/) can expose Your Pattern alongside the redesigned Import and Return flows. This is the `live-preview` development entry point; the production runtime and its release qualifications remain separate.

## Trying the flow

Sign in, open Astrology, review birth details, select a chapter, write an optional reflection and save it. Journal reopens the exact saved chapter; changing the current profile preserves earlier saved calculations and writing. The four chapters use the already approved 48-entry catalogue. Calculations and chapter assembly do not call an AI provider. Tarot retains the preview's existing live-provider disclosure and explicit permission controls.

Import remains available through account tools. Returning to an existing native Tarot reading uses the new interpretation/reflection/revisit layout. Imported snapshots retain their historical presentation and capabilities.

## Explicit development admission

Only `createHostedPreviewWorker` verifies `content/pattern-approved.json` with the separately configured public review key and exact release hash, then passes an internal development capability to the ordinary application. A mode string or environment flag alone cannot enable Pattern in the default Worker or production runtime.

The preview configuration pins `PATTERN_PREVIEW_ENABLED`, `PATTERN_PREVIEW_RELEASE_HASH` and `PATTERN_PREVIEW_REVIEW_KEY`. The public key is not a signing secret. Signature, exact catalogue and calculation identities, active registry state and enabled publication state must all match. `/health` exposes `patternReady` only through this preview capability. The client requires that explicit signal in `live-preview`; production ignores it.

The operator installs the approved registry/state rows explicitly. Requests never recreate missing approved rows, repair withdrawn content or enable a stopped state. The final save transaction checks the unchanged raw release as well as its hash/revision. Already committed save retries can reconcile after a stop or withdrawal; new publication stays closed. Profile removal and saved-reading retention keep their existing semantics.

## Deployment and verification

Migration `0021_astrology_pattern.sql` rebuilds populated parent tables. Pause ordinary writes and generation, record a D1 Time Travel bookmark and hashed table inventories, apply the migration atomically, compare all original column projections and account storage, then activate the matching Worker before reopening admission. Preserve the prior generation/dispatch settings and existing secret bindings.

The focused development verification covers approved profile → preview → save → exact reopening with AI off, invalid trust/configuration, stopped/withdrawn content, committed retries, production/default-Worker refusal, and client readiness. Existing Pattern, Import and Return browser cases cover the adjacent UI. The deployment receipt records actual executed commands, source/artifact identities and live smoke results; the earlier full release-gate receipt remains bound to its earlier source.

The private hosted smoke creates one disposable account, exercises approved Pattern persistence and a historical import, then deletes that account through the normal receipt flow. It never enables AI permission or starts generation. Importing a historical Tarot snapshot does not prove native Tarot Return behavior; its deployed assets and focused local browser coverage are recorded separately.
