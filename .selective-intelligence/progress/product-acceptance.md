# GrindZone — Phase 1 acceptance and subsequent SI remediation

## Primary audience correction — September 22, 2026

**Xbox players are the main target. They currently have no working GrindZone connection to their game. This is a defining unmet product requirement, not an optional platform enhancement.**

The owner rejected the substitution of a PC-oriented reader plus a console-labelled manual browser journal for Xbox integration. Preserve the working PC and guest features, but do not let further PC packaging, pairing tutorials, guest forms or unrelated polish displace the Xbox connection dependency. A player must not need a PC, developer tools, developer-issued credentials or manual entry for every harvest to obtain the intended Xbox experience.

### Required Xbox proof

1. A player opens GrindZone on a phone and completes a real Microsoft/Xbox authorization flow for GrindZone. The backend verifies the Xbox identity; entering a gamertag or selecting Xbox is not proof of ownership. No borrowed first-party application identity or token copied from developer tools.
2. The same player receives actual, authorized COTW data from the connected source. Record exactly which title, fields, observation times and permissions were verified. Identity linking, achievements, title statistics, capture ingestion and private game-save access are separate capabilities. None automatically establishes the others, and aggregate changes must not be fabricated into individual harvests or exact coordinates.
3. Demonstrate a real Xbox-origin gameplay record reaching the correct grind/account without a PC and without retyping the harvest. A capture-derived record must be labelled as such, preserve its evidence, and contain only supported visible fields; it does not prove native harvest telemetry, unseen herd populations or exact kill/pickup coordinates. Repeated ingestion must not duplicate the record. A profile-only or achievement-only result is not acceptance of automatic grind tracking.
4. The connected player's durable progress reopens on another phone under the same verified identity. Another account cannot retrieve it. Unlink, revoked authorization, expired sessions and source unavailability have explicit behavior without erasing the journal or exposing credentials.
5. Retain all other agreed Phase 1 outcomes. An unavailable required Xbox field remains an open integration requirement until supported or explicitly changed by the owner. Do not redefine the target product as a manual notebook to close it.

### Next dependency and factual limits

Prioritize a real registered Microsoft application, the documented Microsoft-to-Xbox authentication exchange and a scoped COTW read against the player's granted permissions. Inspect returned title statistics before promising specific fields. Microsoft documents web sign-in and read-only Xbox data access; its statistics service distinguishes open from restricted statistics. That is a viable integration investigation, not evidence that GrindZone already has authorization or that every COTW metric is available.

The publisher's Xbox save-export limitation does not mean every Xbox API is inaccessible, and Microsoft sign-in does not by itself grant access to COTW's private save contents. For missing detailed harvest, herd and zone data, investigate an authorized title/publisher interface. Xbox's built-in OneDrive capture backup plus a consented Microsoft Graph reader is a separate candidate for capture-based ingestion, not full game-state synchronization. No provider approval, extracted record or live connection has been established merely by documenting those paths.

Official references checked September 22, 2026:
- Microsoft website/Xbox authentication: https://learn.microsoft.com/en-us/gaming/gdk/docs/services/fundamentals/s2s-auth-calls/service-authentication/live-website-authentication
- Xbox statistics authorization: https://learn.microsoft.com/en-us/gaming/gdk/docs/reference/live/rest/uri/userstats/uri-usersxuidscidsscidstatsgetvaluemetadata
- COTW platform save-export guidance: https://support.thehunter.com/hc/en-us/articles/4415681575058-How-to-send-your-savegame-files-to-support
- Xbox capture backup: https://news.xbox.com/en-us/2023/09/27/bonus-xbox-update-for-september/
- Microsoft Graph delegated file reads: https://learn.microsoft.com/en-us/graph/api/driveitem-get

This correction changes priority and acceptance criteria only. It does not implement a connector, register a Microsoft app, provision managed authentication, obtain publisher access, deploy code or connect a player's Xbox. Keep the latest actual implementation/release checkpoint intact and read this correction alongside it.

## Owner decision — September 21, 2026

The owner defines completion of EVERYTHING listed in the September 21 GrindZone work recap as the END OF PHASE 1. That finished scope is what the original first deliverable should have been. A working preview, incremental feature release, pairing success, source candidate or test count is not that deliverable.

This decision defines scope and quality; it does not assert that Phase 1 is complete. The recap is a scope reference, not independent evidence for its implementation claims. Verify those claims against the relevant source, execution, deployment and actual-use evidence before relying on them. Local-only work and unverified reports must remain labeled accordingly.

Sequence: finish and accept GrindZone Phase 1 first. Afterward, remediate Selective Intelligence (SI) so this level of complete, coherent first-deliverable quality becomes the repeatable standard across projects. Do not start an unrelated SI rewrite now, make it a prerequisite for GrindZone delivery, or use it to reduce Phase 1. Ordinary truthful reporting, scope preservation and quality checks apply immediately; they are not deferred until the SI repair.

## Phase 1 scope boundary

The entire recap is in scope, not merely its final priority list. Retain and finish the following workstreams as one usable product:

1. Product identity and the player-owned multi-game direction: GrindZone, no tagline; COTW first, Way of the Hunter and the broader game support described in the agreed scope. Do not silently move recap scope into a later phase or conflate GrindZone with the separate original Wildlife Ranch game.
2. Local read-only save observation, automatic durable history, career/reference tools and clear source coverage. Manual entry alone does not satisfy requested automatic tracking.
3. Real reserve maps, saved pressure, equipment and hunting setup planning.
4. Phone-first grind/session management, target/other tracking, species totals, routes and useful activity presentation.
5. Retained zone history/loss/rediscovery, zone/grind/species attribution and spoiler-controlled undiscovered feeding/drinking/resting areas.
6. Usable PC packaging and version/update state, self-service phone connection, physical QR-camera and link paths, reconnect and recovery without developer tools or developer-issued secrets.
7. Requested PC-unavailable/cached access and account-bound cross-device recovery. Existing same-browser copies are not automatically evidence of full offline use, cloud backup or new-device recovery.
8. Actual screenshot imports, trophy/career cards, collages, export/sharing and their complete desktop/phone journeys.
9. The expanded saved-game dashboard and the remaining useful save-data mappings described in the recap, integrated with the canonical reader and available in the delivered app rather than only a draft or local candidate.
10. Shot, death and harvest/pickup distinctions, supported location capture, map/history display and real-game validation. Player-selected attribution is not automatic kill GPS. Missing animals do not prove deaths. Unknown schemas or unavailable exact coordinates must remain explicit, not invented; an unresolved required capability is not closed merely by displaying Unknown.
11. Persistent accounts and source ownership, real sign-in/recovery, profiles/trophy rooms, selected private/friends/public publication and withdrawal, following/friends/activity/blocking, viewer isolation, and broader game support.

This grouping preserves the recap; it is not permission to exclude less prominent requirements. Any scope ambiguity, externally dependent aspiration or proposed deferral must be made explicit. Do not invent third-party approvals, compatibility, exact telemetry or completion to close a requirement. Only the owner can approve a material scope change.

## Phase 1 completion gate

- The agreed capabilities work together in the version the player actually receives. A commit, PR, passing unit suite, packaged archive, host deployment and installed-PC update are separate facts and must be reported separately.
- Verify real user journeys on the required PC/phone surfaces, including normal operation, stale/missing data, errors, reconnect/restart, privacy, spoiler revocation and recovery. Synthetic fixtures support these checks but must never be represented as owner-device or real-save acceptance.
- Preserve read-only source access, permanent journal history, deduplication and provenance. Protect private saves, media, coordinates, identifiers and credentials; no implicit publication or cross-product account reuse.
- Review interaction and visual design using the actual rendered application and realistic data: information hierarchy, useful above-the-fold activity, map/detail context, narrow-screen fit, navigation, controls and loading/empty/error states. A styled shell, hidden feature or technically passing screen is insufficient.
- Keep one requirement-to-evidence acceptance record, with open defects and coverage gaps visible. Owner rejection remains unresolved until the requested outcome is corrected and accepted, or the owner explicitly changes scope. No unsupported completion percentage.
- Phase 1 ends only when the full agreed outcome set has relevant execution/delivery evidence, no unresolved release-blocking defects or unapproved scope deferrals, and owner acceptance of the intended first-deliverable experience. Existing working features do not offset missing defining outcomes.

These are completion requirements, not a claim that an automated gate already enforces them.

## Subsequent SI remediation — required outcomes, not implemented here

Once Phase 1 is accepted, use its final product, actual rejected intermediate results, corrections and delivery evidence as the concrete reference standard. The repair must change execution behavior and acceptance enforcement, not merely add an instruction to try harder.

- Hallucinations: tie factual progress claims to exact source, executed checks, delivery surface and evidence scope. Detect unsupported claims and contradictions. Explicitly separate implemented, tested, published, deployed, installed and player-accepted states. Preserve uncertainty instead of inventing facts or success.
- Drift: carry the original product intent, complete requirements, owner corrections, current scope and last verified state across turns/workers. Detect unapproved scope substitutions, omissions and premature finish claims. Resume the next actual dependency without rediscovery displacing delivery.
- Incomplete or low-quality design: require complete user workflows and rendered desktop/phone review, not generic screens, inaccessible functionality, placeholders or backend-only proof. Evaluate task success and understandable information presentation, not styling alone.
- Premature completion: make failed acceptance and owner rejection persist across checkpoints. A verifier or polished status report must not substitute for the requested product. Match tests and evidence to the actual delivered revision and device/surface.
- Continuity and efficiency: preserve and integrate parallel work without losing requirements or overwriting newer changes. Optimize for completed, accepted outcomes and reduced rework, not code volume, test volume, token savings or the number of tasks labeled done.

Evaluate the repaired SI on fresh end-to-end tasks beyond this one project. Measure first-pass user acceptance, requirement coverage, successful real workflows, corrective prompts/rework, unapproved drift and unsupported completion claims. State denominators and failures. Required acceptance targets are complete agreed outcome coverage, no known unsupported completion claims, no unapproved scope substitutions and no unresolved release-blocking owner feedback; a prompt edit or a single favorable demo is not proof of repeatability. Do not promise model infallibility.

This note records the future SI work; no SI code, installation or universal enforcement was changed or verified by writing it. Do not overwrite the latest implementation checkpoint with this scope note.

---

## Earlier first-phone feedback and requirements — retained context

Owner feedback on the first personal-phone screenshots: this is useful as a first deliverable, but remains far from finished. Do not redefine completion as QR pairing, a public download, a passing test count, or cosmetic polish. Preserve the original player-owned, multi-game product.

### Required player outcomes

1. Manage an actual COTW hunt from the phone: current grind, target versus other harvests, zones/herds, maps/routes, setup and notes, reliable update and reconnect states. Unknown animal status, medals, fur and source coverage must remain explicitly unknown.
2. Own progress: local or authorized cloud game data stays user/platform-controlled and read-only. Durable GrindZone history and notes are user data, not disposable cache. Ingestion must retain provenance, deduplication and the distinction between retained records and lifetime counters.
3. Open permitted cached progress on another device when the gaming PC is unavailable. Account association, source timestamps, stale/read-only state, export, disconnect and deletion are part of delivery. Cache deletion must not delete the user's source or durable journal.
4. Show real work: a customizable profile/trophy room, media/cards/collages and deliberate private/friends/public publication with withdrawal. Do not publish raw saves, private coordinates or inferred rare/medal facts by default.
5. Community: following, mutual friends, selected activity, blocking and viewer-isolation tests using two independent application identities. Following someone never grants private cache access.
6. Complete self-service delivery: bundled PC runtime, understandable version/update state, normal phone setup, camera and link fallback, and recovery without developer-issued secrets or remote-control tools.

COTW is the first end-to-end proof. Way of the Hunter follows; the player/profile/community layer must support games beyond hunting. Do not restart a generic framework or conflate this companion with the separate original ranch-management game.

### Historical first-phone acceptance boundary — not current release status

The owner's screenshots demonstrate personal game data visible in a phone browser. They do not establish how the QR/link path succeeded, that camera scanning is fixed, automatic source changes on that device, offline caching, account recovery, or private/friends/public isolation. The owner explicitly has not accepted the product as finished. Do not publish their screenshots or personal records as test fixtures.

### Historical first correction

Source 0c35a0f1 reorganizes the existing grind view: recent activity precedes goal setup, animal breakdown and Finish; all existing commands, filter choices, counts and details remain available. Target/other/total scopes appear together. Pairing gains an immediately visible private-link fallback and expired/disconnected-code handling. The existing real browser gate must show a recent harvest above the phone dock without scrolling at 390x844. This is a bounded first-deliverable improvement, not completion of the outcomes above.

### Historical continuation note — not the current resume point

Reconcile and reuse the saved private-cache candidate with current self-service activation, source identity and existing projection. Do not introduce a second game parser or another proof service. Deliver private source-scoped cached reading and clear stale status, then account-bound cross-device access and selective profile publication. Keep the original durable journal separate from rebuildable projections. Correct resume/checkpoints so connection testing does not repeatedly displace these unfinished requirements. QR camera behavior and update/onboarding remain open until device evidence resolves them.

The historical note above must be reconciled against the latest actual implementation/release checkpoint; do not restart already completed cache, connection or zone work from this older text.
