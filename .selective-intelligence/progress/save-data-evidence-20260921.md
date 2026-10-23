# Save-data continuation — September 21, 2026

Status: implemented and locally tested source candidate on PR #6; not a deployed or installed update. GrindZone Phase 1 remains incomplete. SI remediation has not begun.

## Preserved source

Continue the saved-game dashboard from 1408961d25987ca67eaac05b4bb505db60b2e2a8. Include the six non-overlapping files changed by the current base through c78ed5cd99caaec3d54e2fca8b005ad1e5f2b444: screenshot implementation and its three tests/verification files, the latest deployed screenshot checkpoint, and the owner's full Phase 1 acceptance definition. The comparison from 9a2f7929 to c78ed5cd identifies exactly these six paths. Reuse their exact blobs; do not rewrite the latest live-release checkpoint as though this draft were deployed.

## Corrected in this candidate

- Health coverage is derived from the existing normalized health source. Absent or invalid counts do not become detected records or zero. Retained stale counts are labeled stale. Counts do not establish individual animal identity, wounds or survival.
- Coverage no longer advertises verified individual medal decoding.
- Identical profile contents with an earlier saved timestamp retain a rollback boundary. Repeated scans remain idempotent, and forward timestamp changes update the baseline without inventing earned progress.
- Both the optional phone data projector and the dashboard renderer revoke old population coverage when spoilers are disabled or the reserve changes.
- A progression-history read failure is distinct from an initial baseline or a valid empty history. Bait-review totals are labeled as deployed items, not bait-site counts.
- An existing optional byte-limit status survives re-projection.

## Executed verification

Node 22.16.0, Linux, exact-source excerpt workspace. The original source files and unchanged test dependencies were checked against Git blob identities before editing. The 25 new regression checks fail 23 cases on the original code and pass all 25 on the corrected code. The combined command passes 69 tests: 44 unchanged existing model/render checks plus 25 new checks; zero failures, cancellations or skips.

`node --test tests/save-data.test.mjs tests/save-data-evidence.test.mjs`

Tested code blobs:

- lib/save-data.mjs: b107cdb33bf3e6d92e946e55a9bef901d5874ef2
- public/save-data.js: 7c3a19a8285a92b8b05ce0a9a442f5a62f2ec775
- tests/save-data-evidence.test.mjs: 301425022e88c19624078b497a41f02b1f43a71f

These are normalized synthetic model/projection tests and HTML-string assertions. The observer adapter test uses a synthetic source/store interface. This is not a complete Observer/SQLite restart test, paired-route integration, real save parsing, full repository build, rendered-browser layout or physical-PC/phone acceptance. The prior 51-test result is historical; its separate phone tests were not rerun in this slice. Do not add the old and new totals as independent integration proof.

## Remaining dependency

The reported combined location/save-data artifact was not present in this execution workspace and is not integrated by these changes. Exact automatic shot/death/pickup capture remains open. Preserve and recover the actual candidate rather than treating a chat description as source. Complete canonical Observer/Store restart and paired desktop/phone acceptance, reconcile the location candidate with this draft and preserved screenshot/account work, and deliver the reviewed combined package. Current build/archive retrieval did not produce a complete checkout; no hosting or installed update was attempted.

No game saves, permanent player journal, private screenshots, credentials, account provider, database, service or paid plan were read or changed. Only this existing GrindZone source draft is advanced. Requirements left unknown or unsupported are not accepted as complete merely because the UI now labels them honestly.
