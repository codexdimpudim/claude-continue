# Inspection and macOS port decisions

This project is derived from Bluscream’s claude-desktop-plugin-system at commit `c3f14f1c2d2d3b42aa0ff2567d785bb610575d0a`. The macOS adapter was developed against the installed application’s package metadata and entrypoint.

## Existing project

The Linux patcher extracts an AppImage and ASAR, prepends a loader hook to `.vite/build/index.pre.js` (falling back to `index.js`), then repacks both. It requires Linux-specific tools and paths. The Windows patcher finds installed ASAR files, stops Claude, adds the same hook, creates a `.bak`, and repacks. Its overwrite-style backup is not suitable for the requested macOS recovery design.

`loader.js` discovers scripts under Electron's `app.getPath('userData')/plugins`. It requires `*.main.js` in the main process and injects renderer `*.js` scripts through `executeJavaScript` on `dom-ready` and `did-finish-load`. Renderer plugins guard against duplicate initialization. On macOS, the Electron userData path itself works already; the missing pieces are bundle detection, integrity metadata, signing, safe backups, and installation/restore.

The original Auto Continue plugin has useful compact styling, dragging, persisted preferences, configurable text/delay, countdown/cancel, and basic composer/Stop/Send/Continue detection. Its Stop-disappearance rule can confuse errors with completion. Its delayed callbacks lack cancellation tokens, it can overwrite drafts, its direct Continue search is global, and it interpolates prompt text into HTML. These behaviors were replaced while preserving the useful UI foundation and settings key.

## Installed macOS application

- Claude: `2.31226.1`, bundle ID `com.anthropic.claudefordesktop`.
- Electron framework: `44.4.3`.
- Universal Mach-O: Intel and Apple Silicon slices.
- Package: `Contents/Resources/app.asar`, entry `.vite/build/index.pre.js`.
- Multiple sandboxed/context-isolated renderers and bundled preloads; the chat is loaded from `https://claude.ai`.
- Original strict/deep code signature verification passed.
- Node-option injection, Node CLI inspection, and RunAsNode fuses are disabled. Embedded ASAR validation and ASAR-only loading are enabled.
- The startup code refuses remote debugging/network override switches without a vendor-signed developer authorization. No token forgery or alteration of that authorization check was attempted.

## Chosen strategy

Ordinary runtime debugging injection and Node environment hooks are unavailable on this build. A wrapper alone cannot supply the missing injection hook. Replacing preloads or rebuilding the client would increase scope. The implemented fallback is a small ASAR startup hook in a **separate local copy of the real app**, preserving the installed original.

The archive patch appends the replacement entrypoint and updates its header entry and block integrity. It preserves existing payload bytes and `app.asar.unpacked`. Both relevant plist integrity hashes are updated. Read-back validation precedes local signing.

Initial live signing experiments showed two distinct failures: retaining Anthropic-only entitlements caused macOS to terminate the copied app; loading an ad-hoc Electron framework under ordinary library validation also failed. The local-copy signing procedure removes the unsupported identity/Keychain groups and permits the affected copied executables to load the locally signed framework. These changes are confined to the copy and have real functionality tradeoffs, especially Touch ID. They are not equivalent to preserving Anthropic's signature.

## Files added or changed

- `plugins/auto-continue.js`: bundled standalone renderer, with a redesigned status card.
- `lib/engine.js`: testable state machine, waiting/recovery policy, limits, and classifications.
- `lib/renderer.js`: DOM adapter, widget, settings, cancellation, and conversation/window ownership.
- `macos/loader.cjs`: origin-restricted adapter following the upstream injection lifecycle, operational logging, health verification, and native power assertion lifecycle.
- `macos/manage.py`, `macos/compatibility.json`, and `.command` launchers: detect, backup, patch copied app, sign, verify, launch, uninstall, and restore.
- `tests/`, package manifests, build script, and documentation.

This distribution includes only the macOS adapter and Auto Continue plugin. The upstream loader, Windows/Linux installers, version spoofing, and unrelated plugins are excluded. No account files, conversation databases, authentication tokens, or billing state are directly edited.

The loader's health record contains widget/control booleans, process/version metadata, and power assertion status. No persistent conversation identifier is needed. Renderer automation pins the current conversation only in memory and cancels when the selected chat changes; same-chat fragment/history navigation preserves the session. Unknown DOM states and ambiguous sends pause rather than retry.

## Active timers and optional visibility

The renderer owns a 500 ms safety tick and, in Paranoid mode, a 100 ms display timer. The native loader disables background timer throttling only for active compatible Claude renderers, independently of the optional prevent-app-suspension assertion. It records and restores the prior throttle setting on pause, changed-chat/full navigation, renderer exit, stale heartbeat, or quit. Same-chat in-place navigation preserves the lease. Leases expire after two minutes without a heartbeat; this tolerates a browser timer delayed by one minute while still releasing abandoned assertions. This does not prevent shutdown or guarantee lid-close operation.

Onboarding and appearance use the existing renderer preference storage. A separate seen flag records the first tutorial display, so it does not recur automatically if interrupted. Session activation stays explicit and is never restored from storage. Approval is scoped to the current countdown and invalidated by cancellation or warnings; final response fingerprint and completion checks remain mandatory.

Source updates verify app hashes before shutdown, stage every source and backup, and restore replaced files if a later replacement fails. App binaries and account preferences are outside the source update set.

Version 2.2.3 separates the recorded supported source from the original app used for restoration. The source remains a verified signed baseline backup; the managed copy still requires its exact patched hashes. The original can update independently. Repair stages a newly copied/signed app from that source, archives an existing Runtime by rename, and restores it if activation fails.

The inspected updater chunk uses Electron's native `autoUpdater.setFeedURL`, `checkForUpdates`, and `quitAndInstall`. The first-entrypoint hook loads the adapter before vendor initialization. After exact managed-copy verification, the adapter replaces those three entry points with immutable local guards and reports `vendorUpdatesBlocked`. It does not modify the original process or enterprise preferences. Update checks return a native `update-not-available` event without contacting an update feed. [Electron's updater documentation](https://www.electronjs.org/docs/latest/api/auto-updater) explains that checks can download updates automatically and already-downloaded updates can install on restart; the launcher therefore separately checks for a queued payload targeting the copied app. Shared ShipIt state is read, never cleared.
