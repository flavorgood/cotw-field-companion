# GrindZone saved-game workspace — current release

**September 21, 2026:** the saved-game dashboard and reader corrections are released at `37cfef8f2a3ff44de7dca5b726d19be03eea9437`, integrated through PR #6 into `fix/hunting-workflow-20260918` as `63b0f3c2c4fd95978094b1ae84434726148e36be`. The integration has no content difference from the tested runtime. App main remains unmerged.

The existing host `1ad02955fbf70744f5e2a38cfe8b0ac2feabddf9` serves that relay and matching Windows package. Final public-verification deployment `dep-daop4bdg1s2s7382iho0` finished live at `2026-09-21T20:29:15.152147Z`. All 648 native tests and all six local/live browser workflows passed with the actual app, SQLite, production catalogs and disposable synthetic saves. The public saved-game workflow verifies profile/history consistency, automatic updates, failed-source retention, narrow-screen controls, equipment-map navigation, spoiler revocation and restart/reconnect. No owner-device or personal-save acceptance is claimed.

The package has 68 files, 36,278,700 bytes, SHA-256 `e030295b39204c143b5748fccfd5112073b966ef369eff236ccc19286b02a960`, with runtime included and no player data/enrollment secret. Existing PC installations were not automatically updated. Preserve the companion data directory and existing pairing when opening the new complete package.

**Current continuation:** `.selective-intelligence/progress/latest.json`. Phase 1 is not complete. Exact automatic shot/death/pickup capture, remaining useful save mappings, accounts/recovery, profiles/community and broader game support remain open. The separately reported location artifact was not recovered as source in this workspace. Honest unavailable labels do not close required capabilities.

## Historical source-candidate checkpoint — status and next actions below are superseded

The following original record is retained as evidence of the earlier bounded implementation, not the current deployment or resume point.

Status at that checkpoint: implemented source candidate; not installed, merged into production, or deployed.
Baseline: `38418b356d95c1148c5352abde7e5e77a95c3fdb`.
Branch: `feat/save-data-workspace-20260921`.
Scope: use already decoded game data to deliver useful read-only player information without changing game saves or unrelated projects.

## Implemented

The existing Home dashboard renders a new **Your saved game** section. The canonical Observer attaches `career.saveData`, so the existing career-inclusive refresh signature observes changes without replacing the main application router.

- Player profile: level, XP, game cash, unspent skill/perk points, saved uncollected-animal counter and harvest streak. Each source has its own saved/checked time and available/stale state.
- Progression history: baseline followed by up to 20 net changes between readable profile saves in the existing local key-value store. Same-source rescans do not duplicate events. Backward save times and possible restores are explicit. These are not purchases, earned-income transactions, or per-grind earnings.
- Deployed equipment: positioned save items across reserves, mapped item labels, coordinates, reserve totals, saved bait values and empty/destroyed/unknown states. Full usable totals accompany an explicitly bounded 80-item detail view. Invalid/duplicate exclusions are visible. Map actions open the named reserve, not an asserted kill location.
- Herd composition: saved groups and animal counts, separate male/female weight and score distributions, scripted-record counts, and linked drinking/feeding/resting area counts. Animal records are not summed once per need-zone schedule. Spoilers are independently checked by the reader, phone projection and renderer.
- Coverage: inventory/loadouts, detailed missions/builds/unlocks, lodge collections, companion progression and unresolved health identity are labeled as needing mapping, not absent from game saves.
- Phone: allowlisted optional save summaries and exports; a 64 KB feature budget within the existing message limit; explicit omissions; no new remote write commands. Private identifiers, paths and arbitrary nested source fields are excluded.
- Distribution source: new JS/CSS added to the existing phone asset list and portable staging list. No new hosted service was provisioned.

## Executed verification

`node --test tests/save-data.test.mjs tests/save-data-phone.test.mjs`

51 tests passed, 0 failed, 0 skipped in a source-excerpt workspace using Node.js 22.16.0. This executes the new model and renderer plus the actual modified `projectPhoneState`, `projectPhoneExport` and command validator with their original pressure/zone dependencies. Cases include a 150,000-animal synthetic population, stale/missing sources, duplicates, initial baseline, bounded history, rollbacks, secret-field stripping, spoiler revocation, legacy state and message-size handling.

Syntax checks passed for the edited observer, phone bridge and phone relay source. Original integration files were reconstructed from GitHub and checked against their Git blob identities before targeted edits.

These results are **not** a full-repository test/build result, full Observer/SQLite integration acceptance, real game-save evidence, live-relay acceptance, Windows-install acceptance or physical-phone acceptance.

## Blocked verification

- GitHub Actions run `35616452282`, job `106388285357`, failed before any execution steps were reported. No cause is asserted. The temporary source-archive/test workflow was removed from this candidate; no unchanged gate was repeatedly retried.
- Browser navigation to the local synthetic fixture returned `ERR_BLOCKED_BY_ADMINISTRATOR` before page load. Zero browser assertions executed. Layout and navigation remain visually unverified; no screenshot or browser acceptance is claimed.
- A complete checkout and relay dependencies were not available in the execution workspace. No full application build or new Windows package was produced.

## Preserved boundaries

The separate location-repair candidate remains preserved but is **not integrated or delivered by this change**. Exact automatic kill/pickup capture is still unresolved. The existing phone production release, user game saves/journal, account-auth work and other product services were not changed.

## Next implementation/acceptance

1. On a complete checkout, run the repository tests, public build consistency check and portable staging. Check actual Observer/Store persistence across process restart with disposable synthetic saves.
2. Exercise the existing full dashboard and paired phone route on desktop and narrow/mobile viewports: new sections, disclosure stability, reserve map navigation, stale transitions, spoiler disable and optional byte limits.
3. Integrate the separately preserved location repair without losing this workspace or account changes. Publish one reviewed, tested PC/phone source and package rather than representing source commits as an installed update.
4. Inspect additional authorized save schemas for inventory/loadouts, detailed progression, trophy collections and animal/event identity. Do not invent fields or expose account identifiers. Correct broader UI absence claims only with an updated public-build artifact check.
