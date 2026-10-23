# Undiscovered zones with spoilers — exact continuation

Owner's latest requirement: spoilers ON must reveal undiscovered need zones, not merely hidden animal counts. Include feeding, drinking and resting wherever the actual game data assigns those activities. Spoilers OFF must not expose undiscovered locations through map, route, exports, phone payloads or retained projections. No Desktop Commander. Preserve the recent zone lifecycle, attribution and compact route work.

## Resume identity

Base read from PR5: c8b0f74353c9b01fea212dbc0941f5f2867ad9a0. This already contains more zone-ledger integration than the older chat report at2959bbfa; do not overwrite it. Runtime location mapping was absent: Observer constructs displayed zones from found_need_zones_adf plus player-recorded zones; population records retain NeedZonePathGuids but not the referenced full reserve geometry.

Published resolver:347f7d411e618b2365d8db2bf1667292027c8800. Tests:4f14087041b001f1d2405d71bf60858bf3c13303. Files:lib/zone-discovery.mjs (blob db9de928f3bf513731653435a2757bd8643383de),tests/zone-discovery.test.mjs (blob dd6ca5a55446ab48a06135c1e36a1ca70321c3ac). Both remote blobs match the exact tested local bytes.

## Evidence and limits

Executed21 pure Node22.16 Linux tests,21passed,0failed,0skipped. Synthetic reference and population/discovery fixtures only. Checks cover all three activities, undiscovered/discovered deduplication, reserve isolation, spoiler-off early exclusion including counts, unreadable sources, disabled schedule slots, missing geometry, invalid schedules, duplicate/ambiguous geometry, occupied-group counts, known warren exclusions, signed32-bit IDs and no input mutation. TAP SHA256:b4069952941338e9a265231203f9e2a6402f43482ba5090725226355a0be8a45.

This is a source-level resolver, NOT wired into the Observer, phone schema, map or portable package. No build, deployment, installed update or physical-player hidden-zone check is claimed. No source/journal/player data was read. No existing host, credentials or security setting changed.

Reference structure was inspected in the archived DECA viewer at nazdridoy/decaWeb commit f8d606b861c9970e62d75e3b5f676d9fce6241ab, deca/hp/map.html: reserve loading around485–632 and population-path joining around975–1210. It loads data/rN/reserve.json, converts the256x256 tile indices with centre/scale, and joins signed path IDs plus per-population start_times and need_types. Current DECA page lists the current reserves, but direct retrieval of current r19/reserve.json failed in the available web client; the archived format is not proof of current file contents or compatibility. Do not ship the old mirror's map data as current.

The resolver uses an actual area tile as the representative map point and labels locationAccuracy=reference_area. It never claims an exact animal or kill position, guesses coordinates from nearby lakes, invents a missing drink schedule, or treats every public reference area as currently occupied. It treats failed mapping as unavailable/partial, not as zero need zones. Animal counts are per assigned group; reference areas may be shared.

## Next exact action

Verify the current approved public per-reserve location/schedule catalogue using a supported retrieval path; bind reference bytes/hash and compatibility evidence to the reader. Integrate this resolver into the canonical Observer and existing phone projection, preserving discovered and player-recorded zones and stable saved IDs. Keep discovered ledger history separate from undiscovered reference-backed markers so reference changes cannot create false pressure/deletion events. Exclude unsupported warren-specific populations until the raw GroupToWarrenId association is preserved and decoded; the current normalized population does not retain that field. Label hidden areas as Undiscovered (spoiler) and show reference precision. Enforce revocation when spoilers turn off, including hidden route endpoints. Add real map/API/phone acceptance before updating the existing paid host or download. Do not rerun unchanged QR, cache or broad architecture work as a prerequisite.

Acceptance remains open: a zone not in the discovered-zone file appears with correct activity/location while spoilers are on, disappears from all relevant views/payloads while off, and becoming discovered does not duplicate it. Existing zone history and harvest attribution must stay intact. The user's current app has not received this feature.
