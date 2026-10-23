# GrindZone managed Windows updates

## One-time installation

Use the managed package from the existing download page:
https://sway-tips.onrender.com/grindzone-download/index.html

Close the old running companion application, not merely its browser tab. Extract the whole `GrindZone-Setup-Windows-x64.zip` package and run `INSTALL.cmd`. Use the `GrindZone` desktop shortcut for later launches. The runtime is included. The installer can also be reached through `START.cmd` in the managed package. The separate portable ZIP retains its existing non-managed launcher.

The default managed code directory is `%LOCALAPPDATA%\GrindZone`. The existing journal remains in `%LOCALAPPDATA%\COTW Field Companion`, or the explicit companion-data directory selected during installation. Existing configured save selection and port are retained. Reinstalling against another journal/profile/trust policy is rejected rather than silently repointing the installation. Do not erase or move the old journal to upgrade code.

## Normal operation

The supervisor checks for compatible updates at launch and hourly while open. `Settings → App updates` shows the current build, any staged build, the latest check error and a manual check button. A check downloads and verifies an update; it does not restart an active hunt. Activation happens on the next launch after the running companion has closed.

An unavailable network/feed leaves the installed release usable. Expired metadata blocks new downloads, not offline use of already installed signed code. Rejected or older releases do not automatically override the installation's high-water sequence.

## Signing and installation boundaries

Release manifests and individual payload members are authenticated with a pinned Ed25519 public key. Downloads use bounded HTTPS requests without redirects or account credentials. Archive paths, sizes, duplicates, checksums and symlink/junction boundaries are checked before immutable side-by-side staging. The private signing key is held by the existing host's dedicated signing configuration and is excluded from source, tests and download packages.

Ed25519 application-release signatures are **not Windows Authenticode signing**. This project does not claim a trusted Windows publisher certificate or SmartScreen reputation. Do not disable security settings to install a package. Independently check the source and publisher before allowing an unsigned installer.

The initial bootstrap kernel and trust policy are pinned. Versioned signed supervisors can update within that protocol; arbitrary trust-root or bootstrap-protocol migrations are not promised by the current implementation.

When a newer complete signed setup is rerun with `--open`, it verifies and stages the release, then starts that release's verified supervisor under the same installation lock. This allows a repaired supervisor to activate a compatible update even when the currently installed supervisor cannot complete its cold journal backup. The normal desktop shortcut still selects the committed release.
If GrindZone starts during setup, close it and rerun the same signed setup. If the new candidate fails startup and is rejected, the previous app remains usable; a newer corrected signed setup is required.

## Journal and pairing recovery

The installation lock prevents competing managed supervisors. The next-launch activation checks that the selected local port is no longer serving another companion. It verifies the staged release and creates a hashed cold backup of the journal database and its SQLite sidecars. Those records include existing private pairing metadata.

The candidate starts with the existing game-save read-only permission boundary. It cannot serve player commands or reconnect its phone bridge until the parent has checked its startup identity and durably committed activation. Failed pre-commit startup restores the previous compatible app and backed-up journal; failed candidate bytes are quarantined. Unrelated user files are not erased.

After activation is committed, later player entries must never be rewound by restoring the old backup. A compatible previous executable release may instead be selected without restoring old journal data. Automatic updates that change the exact storage-module contract or journal epoch are withheld pending a separately verified compatible migration.

## Verification scope

The automated update cycle uses actual processes, private IPC, filesystem operations and the production application/SQLite with synthetic records. Tests cover download rejection, staging without interrupting the running child, next-launch activation, failed startup recovery, stored pairing-record preservation, and blocking commands before activation. Repeated suite runs are not additional independent coverage.

The initial Windows Actions attempt `35919917220` / job `107380951838` reported failure without executing steps or providing a log artifact. The cause was not established by available evidence. This does not establish Windows installer, desktop shortcut or Windows update-cycle acceptance. Hosted Linux tests do not substitute for physical owner-PC or phone acceptance. Those remain explicitly unverified until recorded separately.

Use `.selective-intelligence/progress/latest.json` for the latest exact release and execution records. The separate screenshot-intake work in PR11 and the rest of Phase 1 remain separate requirements; this updater does not provide Xbox telemetry or cross-phone account recovery.
