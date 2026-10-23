# COTW finish-line continuation: private phone cache

## Exact source boundary

Base source: `9f4ea75537ed094904fae0aab273e3187dde6804` on `fix/hunting-workflow-20260918` (PR #5).

This continuation implemented a candidate in an isolated working directory. It did not apply that candidate to the repository runtime, installed app, player journal, or public deployment. The downloadable candidate is attached to the September 19 COTW/GrindZone conversation as `GrindZone-phone-cache-candidate.zip`. Preserve that artifact and the working directory; do not describe this note as a shipped feature.

Archive SHA-256: `3047f6879894b5d6e4610af5343da5c150da90942c65271c3131b9dbdf6f788a`.
Patch SHA-256: `8624988eb6596eefdb596561bc146af705c2609f1387f5ff9ce38f4b8b2cefc2`.

Original source Git blobs, checked before editing:
- public/app.js: `a1cdf79c39ccc97ae7c1d3012f81f1d28b0cec78`
- public/phone-ui.js: `12042589fd4b2c4f3635c64c88e41e428a8b799c`
- cloud/server.mjs: `80d6377daca15aec7c4c0f203a25c1d9a0c9cf3c`

## Candidate behavior

An explicit per-browser opt-in stores bounded, sanitized phone-view snapshots in IndexedDB. The relay binds bootstrap and state responses to the same non-authenticating, authenticated-pairing-derived cache identity. Cache records are separated by pairing and reserve. Existing PC source files and the companion journal remain authoritative.

Disconnected cached views display the capture timestamp and disable mutations while keeping navigation available. Network/502/503/504 failures may use an eligible cached view; authentication errors, malformed successful JSON, conflicts, and rate limits do not become successful cached reads. Rejected authentication clears the current cache consent and displayed state. A new pairing cannot inherit another pairing's cache consent or cached view. A clear-and-stop control deletes that pairing's cached views and persists disabled caching; in-flight cache writes cannot refill it afterward. Raw local API views and already-stale snapshots are rejected by the cache.

No service worker, cloud save database, email account system, public profiles, friend/follow network, console source adapter, or second game is included in this slice. The web application and authenticated relay still need to be reachable to load the UI; this is not full offline application hosting. Browser storage is not a backup of notes or historical receipts that only exist in the PC journal. Source disconnection does not remotely erase browser storage.

## Observed proof

- Node 22.16.0: 24 targeted checks passed, zero failures and skips.
- Cache policy was exercised with a storage fake; app request/readiness functions and the relay identity expressions were tested in isolation.
- `git apply --check` passed against the exact original files. The six files resulting from applying the patch matched the tested candidate byte for byte. The same 24 checks passed after application.
- Real Chromium navigation returned `ERR_BLOCKED_BY_ADMINISTRATOR`; no browser policy was changed. The real IndexedDB/browser suite is supplied but has no passing receipt.
- Direct handoff reads through Remote Desktop Commander returned `No devices available`. This is a connector reachability result, not evidence that the user's PC is powered off.
- No player files were read or changed. No installed app, production service, or public preview was changed. No new cloud service was provisioned.

## Governing finish line

COTW is the only active game implementation until a real player completes source read -> private browser/phone view -> grind management -> source update -> selected sharing, with another viewer receiving only authorized published fields. Way of the Hunter is the intended second integration, not a parallel implementation now.

Game saves remain user/platform controlled and read-only. The PC journal owns player-created annotations and retained history that may no longer exist in a game save. Browser/cloud caches are disposable projections, not replacement ownership. Social publication requires its own explicit permission boundary.

## Next exact action

Recover the actual workstation handoff and reconcile any newer source or uncommitted work. Recover the attached candidate artifact from this conversation/working environment, verify its SHA-256 and original source blobs, and run `git apply --check` before applying. Do not reconstruct the candidate from this prose or overwrite newer work.

Run the supplied focused tests, then real IndexedDB and phone-browser acceptance: enable cache, sync, disconnect the test reader, reload, verify exact count and saved timestamp, reject writes, reconnect, observe fresh values, switch pairing, and clear-and-stop without changing the PC journal. Then run the existing full native/cloud/portable gates and verify the installed app. Older PR proof at de9eb63 does not certify the later phone dock, branding changes, or this cache candidate.
