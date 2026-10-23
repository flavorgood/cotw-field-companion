# GrindZone saved-game reader: publication resumed

September 21, 2026. This candidate combines the preserved asset repair and reader source-state fixes with PR #6 at a65348bf. The original create_commit action succeeded on the new continuation; no alternative writing endpoint, identity, credentials or policy change was used to bypass the previous block.

Included: the two missing PC public assets, actual HTTP module-graph test, separate-process Observer/SQLite persistence tests, corrected binary workflow fixtures, source-state/check-time corrections, and the actual desktop/paired-phone browser journey. The source model and fixture match the previously executed 13-case reader subset. The duplicate four-test persistence subset is not added to the full repository: those same cases already exist in save-data-integration.test.mjs. Full integration now consists of the five-test file plus nine source-state cases.

The previous 13 passing checks used the exact reader/store/projection with synthetic binary saves, reference areas and an empty synthetic statistics dictionary. That temporary dictionary and workspace package.json are NOT publication inputs. Existing production catalogs, account source, screenshot repair, phone/zone features and the full Phase 1 scope remain unchanged.

Before release: execute the complete current repository with its real catalogs and the actual PC/paired-phone browser workflow on existing authorized compute. Do not describe prepared browser tests as passed, or a new source commit as deployed/installed. A failing release gate preserves the old live release. No new host, database, paid plan or account-provider changes belong to this work.

The separate location-repair artifact was not recovered as source in this workspace. Its named backups are known from earlier reports but are not present here. Exact automatic shot/death/pickup capture and all other unmet Phase 1 outcomes remain open. SI remediation is after Phase 1 acceptance, not an implementation detour now.
