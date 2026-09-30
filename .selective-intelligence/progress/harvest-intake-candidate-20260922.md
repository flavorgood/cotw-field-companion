# Screenshot-assisted intake candidate — September 22, 2026

This is supporting capture intake, NOT the owner's required Microsoft/Xbox game connection.
Preserve the primary-audience correction at 9dd178c2a5c052bfa531b7a34fa7e262277f8756
and all earlier Phase 1 work. Do not count this as automatic console telemetry or
account-based new-phone recovery. Existing deployed runtime remains 03fc939 until
an exact candidate passes the existing release pipeline.

## Implemented

The existing browser journal gains a screenshot-import action. PNG/JPEG input is
bounded, signature/dimension checked, decoded and SHA-256 fingerprinted. English
text recognition is intended to run locally through Tesseract.js 7.0.0, same-origin
worker/WASM/model assets, no screenshot uploads or private PC APIs. Ambiguous
values remain unknown. The user reviews suggestions, chooses actual harvest time
and confirms before one report can be counted. Extracted suggestions and confirmed
fields remain separate. Shot/death/pickup coordinates are never inferred.

The same IndexedDB authority, command fingerprints and revision checks are reused.
Exact image bytes cannot be counted again, including after explicit backup restore.
Concurrent edits preserve the review for a deliberate refresh, and bounded/cancelled
reads cannot count a harvest. Evidence records a source fingerprint and metadata,
not an archived original image. The user keeps the original photograph separately.
Re-encoded or cropped copies are not guaranteed deduplicated. Unsaved review drafts
are not durable. English-only recognition and real screenshot accuracy remain open.

## Actually executed

52 local Node 22.16.0 tests passed, zero failed/skipped/cancelled: 46 parser/journal
checks and six actual HTTP-handler checks with in-memory request/asset fixtures.
These exercise real validation/command code, not real Xbox captures, IndexedDB
transactions in a browser, provider OAuth, OCR engine execution or physical phones.
Changed JavaScript and the new vendor/browser tools passed Node syntax checking.

Local Chromium 144 started, but navigation failed before application load with
ERR_BLOCKED_BY_ADMINISTRATOR. No workaround or policy change was attempted. No
browser pass, rendered layout acceptance or native OCR execution is claimed.

## Required execution before release

On the existing shared host builder, run tools/prepare-harvest-ocr.mjs before all
native/browser gates, then the complete unchanged previous native and nine browser
workflows plus tools/verify-harvest-intake.mjs <host-root> <local|live> <evidence-dir>.
The new workflow uses real browser OCR on generated English images, IndexedDB,
explicit confirmation, reload/dedup, cancellation, stale-tab handling and private
backup transfer. It compares loaded reader bytes to the exact candidate and keeps
Xbox-capture, physical-phone and account-sync proof false. This script is prepared,
not executed. Vendor npm fetch, bundle layout, license paths and WebAssembly loading
also remain unexecuted. Do not replace these with synthetic OCR output as proof.

## Compatibility and next dependency

Old v1 journals remain readable. New screenshot reports extend v1 with an optional
strict evidence field; an older reader will reject such a document rather than
silently erase the evidence. Rollback must retain a compatible reader and backups;
do not strip or downgrade user records silently.

Next product dependency remains real registered Microsoft/Xbox authorization,
scoped authorized COTW data/capture intake and account-owned durable recovery with
two real identities. The connected-plugin search found no Microsoft app-registration
administration action. This does not prove no such external service exists; no app
registration, publisher approval, access token or successful player connection was
created. Do not borrow another application's identity or fabricate game telemetry.

No owner saves, live journals, accounts, credentials, existing Windows installation,
Wildlife Reserve assets, Unreal build state or shared-host application configuration
were changed by preparing this candidate. No updater publication is implied.
