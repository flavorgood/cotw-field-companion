# GrindZone runtime identity and herd coverage continuation

Parent: a25f5db5c937677b7a27afcd1b823cc4f7828f79 on fix/hunting-workflow-20260918. Preserve PR12 Insights totals, generated reference changes, the separate PR11 screenshot intake and the complete existing Phase 1 scope.

## Implemented
- Content-based runtime identity in the existing local bootstrap, captured at server module startup. Version labels alone cannot establish matching code. An opaque scope binds the selected save and journal directories without publishing their paths.
- The actual launcher reuses only matching code and scope. Legacy/unverifiable/different builds are rejected with an explicit close-the-app instruction instead of reopening stale UI. Timeouts, malformed responses and occupied ports do not start another reader. Matching custom journal directories may reuse their verified process.
- The new child receives the selected fingerprint; the server rejects startup drift before opening a journal. Existing permission restrictions, data location and phone enrollment remain unchanged. No shutdown endpoint, process killing, save writes, schema migration or automatic installation was added.
- Herd cards and all herd-summary modes use the same coverage-aware Diamond/Great One labels as Insights. Unknown is not zero; positive incomplete counts say known. Career awards and additional candidates remain separate.
- Portable allowlist includes the runtime module.

## Evidence before publication
34 Node 22.16.0 tests passed, no failures/skips/cancellations, using the actual launcher against disposable HTTP responses and the actual count renderer. All nine published file blob hashes match the tested local bytes. Changed JavaScript syntax-checks. These are not complete-app, Windows or physical-phone acceptance.

Two additional full-checkout tests in tests/runtime-http.test.mjs require the existing complete host: actual server/bootstrap/launcher/SQLite read-only reuse and startup mismatch before journal creation. Run the unchanged complete native and all existing local/live browser release checks on the existing host. Do not remove gates.

## Not completed by this patch
This is NOT the install-once signed updater. It detects conflicts; it does not download/install or stop a legacy process. Previous source-only updater artifacts were reported but not retrievable from current Project files, so no claim of recovering/integrating them is made. Preserve that work. Production release, actual Windows installation and player-save acceptance remain pending until separately evidenced. No owner device, saves, journal, credentials or account configuration were accessed or modified.
