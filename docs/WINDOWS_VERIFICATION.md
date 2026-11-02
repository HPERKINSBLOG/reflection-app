# Windows verification

Use Node 26 (the exact version is in `.node-version`), npm, Python 3, Git for Windows, and the three Playwright browser engines. Run from the repository root in PowerShell:

```powershell
npm ci
npx playwright install chromium firefox webkit
npm run verify
npm run test:journey
```

The synthetic gates require a checkout without local `.env` or `.dev.vars` files. Ports 8787 and 8843 must be free. The harness does not reuse an existing personal app instance. OpenSSL can be on PATH; otherwise the HTTPS journey harness locates the copy bundled with Git for Windows. No provider calls or deployment are part of these commands.

## Platform fixes

- Verification invokes JavaScript CLIs through the current Node executable. Windows environment variable casing is preserved, including `Path`, `SystemRoot`, and the browser-cache location. Application credentials, `VITE_*` and `NODE_OPTIONS` are still excluded.
- `.gitattributes` keeps text files at LF, including frozen provider inputs and generated schema bytes, while preserving binary assets. Existing Windows checkouts with CRLF need an LF normalization that preserves local changes; do not reset a dirty checkout. Python checks read repository text explicitly as UTF-8.
- Protected evaluation archives, permits, review reports and local identity keys use actual NTFS ACLs. New private paths receive an owner-only DACL before data is written. Validation rejects access grants to other users (apart from Windows SYSTEM and Administrators), wrong ownership, and directory junctions/symlinks. Existing shared directories are rejected without changing their ACLs. POSIX uses its existing 0700/0600 checks. File contents are flushed on both platforms; directory fsync is additionally available on POSIX. This is not a Windows power-loss durability certification.
- Crash tests use file URLs for dynamic ESM imports and prove the child reached its intended crash point before checking the platform exit result and no-resend recovery behavior.
- Native Chromium zoom uses the extension's real `chrome.tabs.setZoom(..., 2)` and compensates for the measured window border. The harness still requires exact 320/390/768/1280 CSS-pixel widths, DPR 2, CSS zoom 1, visual scale 1, full-image dimensions and zero horizontal overflow.
- The cross-engine keyboard journey waits for Save reading to become enabled and focused before pressing Enter. A Windows WebKit trace caught the earlier action arriving while request cleanup still disabled that control; the saved-reading and keyboard assertions remain intact.

Windows domain tests use four workers and a 30-second per-test bound for native ACL subprocesses. The complete verification gate has a 20-minute Windows deadline; other platforms retain nine minutes. The receipt records the platform, and hosted-candidate validation rejects unknown budgets, a Windows budget applied to another platform, and durations above the applicable limit. Interrupted or timed-out Windows stages terminate only their owned process tree.

## Evidence

The latest combined result is in [`artifacts/windows-verification-summary.json`](../artifacts/windows-verification-summary.json). It includes exact counts, elapsed times, source identity and report hashes for the full verification gate and cross-engine journey matrix. Full gate output is in `artifacts/windows-verify.log`; cross-engine output is in `artifacts/windows-journey.log`. The canonical full-gate receipt remains `artifacts/verify.json`.

These are headless local Windows tests with synthetic accounts and virtual authenticators. They do not establish hosted deployment, live-provider behavior, physical-device or real-passkey acceptance, screen-reader usability, or power-loss recovery. The Figma-derived Paper/Evening design system remains documented in [the component guide](design/reflection-system.md).
