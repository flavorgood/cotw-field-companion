# GrindZone

**GrindZone** is an independent companion for **theHunter: Call of the Wild**. Free public reference tools, a local read-only career/harvest observer, and a private-in-browser share studio.

## Try the public field library

**[Open the web app](https://infotradescout.github.io/cotw-field-companion/)** — no account or player save required. Publication status is recorded in the latest GitHub activity; a source push alone is not proof the site is live.

Explore all 19 reserve rosters, 127 animal entries, score/weight/difficulty references, 1,771 species/sex fur-template entries, 129 weapon-variant rows, and 117 ammunition rows. Compare equipment or design a square, portrait, wide card, trophy collage, or 1280 × 720 hunting thumbnail with up to six photos. The public career and studio use clearly labeled fictional sample data. Reference counts describe the included snapshot, not a guarantee of future patch completeness.

## Real reserve maps

Open **Real reserve maps** on the website or local companion. All 19 included reserves now use the actual game topographic imagery streamed from DECA, with 1,615 named reference locations across outposts, lookouts, landmarks and hunting structures. Search a place, filter location types, pan/zoom, enter X/Z coordinates, toggle the grid, or expand the map. The local hunting view overlays saved zones and deployed equipment on the same coordinate geometry.

The imagery is not bundled or rehosted. Opening online terrain sends ordinary image requests to `mathartbang.com`; that source can see the requested map tiles and the client IP. No save contents, account identifiers, photos or journal records are uploaded. Terrain can be switched off, and failures show a retry/last-available-map state rather than pretending the blank grid is a loaded map. Public reference points do not show player unlocks or live animal positions.

Reserve image origins and tile extents come from DECA metadata, including negative and shifted-coordinate reserves. Coordinate and anchor tests cover this transform; this is not a claim that every point has been independently checked against every game patch. Attribution and source-map links are displayed in the map. Publisher approval and commercial redistribution rights are not claimed.

In **Hunt**, purple shading shows hunting pressure from the selected reserve's last game save. It updates automatically when saved pressure changes. Open **Map layers** to switch it on or off; zones and equipment remain above the shading. This private layer is available in the local companion and paired phone view, not the public reference maps.

An empty saved map shows **No saved pressure**. Missing data shows **Pressure unavailable**, and a read failure labels retained shading as an earlier save. The companion does not estimate pressure from harvest counts or invent a timer for it to disappear. The saved grid uses reserve bounds and the orientation documented by [DECA's map renderer](https://mathartbang.com/deca/hp/map.html); its shading is not a prediction of the next kill or zone deletion.

## Run the local companion

Requires **Node.js 22.13+** on a compatible Windows PC. Download this repository, extract it, and double-click `START.cmd`, or run `node launcher.mjs --open` from its directory. The app listens on `http://127.0.0.1:47831`. Keep the process running while hunting. This is a source-based preview, not a signed installer.

The launcher discovers a single compatible save profile. It does not silently merge multiple player profiles. A nonstandard location can be selected with `COTW_SAVE_DIR`; companion storage remains separate. The local companion requires no third-party Node packages or paid service. Optional browser phone access requires a separately configured relay; see `cloud/README.md`.

## Automatic tracking — manual notes optional

The local runtime reads compatible saved harvest receipts, discovered zones, equipment placements, named career statistics, and a narrow player-info projection. A new save updates the journal without requiring a manual form. Career counters and the retained recent-harvest ledger have different coverage and are displayed separately.

Career includes game-defined shots fired (hit + missed), accuracy and weapon-type accuracy, lifetime medal buckets, longest shot, and per-reserve exploration/progress. Duplicate statistics rows are deduplicated, conflicting rows are withheld, and inconsistent shot/accuracy totals are flagged rather than repaired by guessing.

**Kills are not harvests.** The saved current-unharvested counter is separate from lifetime claimed harvests. A validated lifetime-kill total and per-reserve shot/kill/harvest attribution are not available in the inspected schema. Population disappearance never becomes a confirmed kill. Automatic gunshot events and individual animal survival remain unvalidated.

## Share studio & privacy

Photos remain in browser memory. Photos stay in your browser and are not sent to the public site. Optional phone access uses a separate private relay after you enable it on your PC. PNG exports render a new card or hunting thumbnail; the original photograph's file metadata is not copied. Review visible content before sharing. Custom stats are labeled player-reported; local career cards are labeled save-derived with their saved date. Public demo cards are labeled fictional sample data. Neither is an official verified leaderboard record.

## Free preview, optional support, publisher ambition

Current tools are free. Optional donations are planned, but there is no configured payment destination and no payment requirement. Publisher review or an eventual DLC partnership is an aspiration, not an agreement. This project is not endorsed by Avalanche Studios Group or Expansive Worlds.

## Evidence & limits

A screenshot or passing unit-test count is not full product acceptance. The preview has source regression tests, a privacy-audited public build, and browser checks of the reference/share paths. Automatic counters have been exercised against a compatible Windows Steam save. Full console support, arbitrary multiplayer attribution, a signed installer, every historical patch and publisher approval are not claimed.

## Reference provenance

Animal score/weight/fur facts are derived from the [APC reference](https://github.com/RyMaxim/apc/tree/master/apc/config); its MIT notice is retained in `licenses/APC-MIT.txt`. Rare and very-rare tiers are clearly labeled companion reference categories, not exact live spawn odds. The optional local map imagery uses DECA only after consent.

Weapon/ammunition facts and statistic identifier mappings were independently normalized from the inspected game UI-stat definitions. Only short identifiers, names and numerical parameters are retained—not raw game archives, dialogue, graphics, audio or executables. Attribution is not a claim of publisher clearance; asset and distribution rights remain a review requirement before any official partnership or commercial package.

## Development

For local UI work against an already running Companion, `node tools/browser-client.mjs` serves the current UI at `http://127.0.0.1:47844` and uses the existing API on port 47831. This optional browser client forwards route and journal actions to that process; it does not install an update, start a second journal writer, or enable phone access. It keeps command identities intact and never automatically retries a write. It may read the selected reserve's save to display saved pressure when the older API lacks that projection. Run it with Node filesystem permissions restricted to reading this source folder and the selected save folder; it needs no filesystem write permission.

Install relay test dependencies with `npm ci --prefix cloud --ignore-scripts`, generate the pinned public herd facts with `node tools/build-herd-reference.mjs`, then run `npm test` for the complete isolated synthetic suite. The generator checks the source blob before writing its local output; portable and Windows download CLI staging also runs it. The local desktop runtime has no npm runtime dependencies. `npm run build:web` projects an explicit allowlist into `docs/` for GitHub Pages. It never reads the installed user's app, game saves, screenshots or database. The public website uses the same reference and share modules as the local app; its entrypoint never calls local save APIs.

Report bugs in [Issues](https://github.com/infotradescout/cotw-field-companion/issues). Do not attach full saves, account identifiers, or personal photos. The separately gated feedback-service boundary is documented in [`FEEDBACK-SERVICE.md`](FEEDBACK-SERVICE.md); until its hosted origin and owner inbox are accepted, Issues is the honest public path. See `ROADMAP.md` for the retained product scope and `PUBLISHER_BRIEF.md` for evaluation goals.

Original code remains copyright 2026 infotradescout. The owner offers the current preview for personal use without charge; no transfer of ownership or commercial redistribution permission is implied. Third-party materials retain their own licenses. A final distribution license and contribution terms must be settled before broad commercial distribution. This is not described as unrestricted open-source software.
