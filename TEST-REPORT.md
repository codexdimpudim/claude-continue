# Validation report

Build: `2.1.1-mac-preview`, based on Claude Desktop `2.31226.1` / Electron `44.4.3`.

## Automated checks

The test suite covers 67 JavaScript cases across the pure state machine, synthetic DOM, and mocked Electron loader, plus two Python update tests (69 total). Run the commands in README.md to reproduce the automated checks. Tests do not contact Claude.

Verified behaviors include:

- Explicit transitions and rejection of illegal rate-limit-to-send transitions.
- Observed generation plus stable completion controls; Stop disappearance alone is insufficient.
- One send across mutation bursts, and cancellation during the text-insertion/submission gap.
- Human typing preservation, pause/disable/stop, navigation, generation restart, and single-window ownership.
- Response-scoped Continue controls; unrelated Continue buttons are ignored.
- Safe text insertion, missing/disabled Send handling, and no blind Enter fallback.
- Hidden Send control recognition while the composer is empty, with visible/enabled checks before submission.
- Repeated passive usage-limit checks without sends, verified recovery, and a limit reappearing during recovery.
- Midnight/noon/AM/PM, local date rollover, invalid reset text, and reset-time buffer.
- Network/service recovery, unknown-state pause, and no resend after uncertain delivery.
- Exact continuation caps, Unlimited preserving safeguards, runtime expiry, empty responses, and exact duplicate-response loop detection.
- Duplicate initialization and complete renderer disposal.
- Power assertion release on pause/navigation/quit/renderer destruction in mocked Electron.
- Operational log field whitelisting and rejection of non-Claude origins.

## Real macOS checks

Verified against the installed app:

- Bundle/version/architecture detection and original strict/deep code-signature verification.
- Reading the real ASAR entrypoint and preload architecture.
- Versioned backup creation, original/backup hash comparison, and backup signature verification.
- App-copy ASAR modification, read-back, integrity metadata, local signing, and strict/deep signature verification.
- Launching the copied real Claude Desktop app.
- Exactly one widget, composer detection, Send control detection, and OFF-by-default state in the actual chat renderer.
- Repeated `dom-ready` / `did-finish-load` injection without duplicate widgets.
- Installer refusal while Claude was running, and failure reporting when startup verification timed out.

The earliest signed-copy attempts failed as described in `ARCHITECTURE.md`. They were corrected before packaging. Keychain prompts and delayed startup were observed. Touch ID reported unavailable in the local copy, consistent with its changed signing identity.

## Not verified / limitations

Live testing was limited by exhausted usage. An initial continuation attempt detected generation but paused on an unfamiliar warning; the later classifier fixes were tested separately. No sending harness is distributed. **Sustained end-to-end loops and real quota-reset recovery are not verified.** Simulated tests are not a substitute for those checks.

The actual “You are out of free messages … until … Upgrade” notice was inspected and added to regression coverage. The Waiting for usage reset state was manually confirmed in the real app. Resume and waiting are now distinguished from an unfamiliar error. Actual reset recovery remains unverified. See the later live sequence below for the confirmed continuation attempt.

Not completed: a multihour unattended soak; actual quota reset; physical network-disconnect recovery; Chrome Remote Desktop interaction; actual app upgrade; separate Apple Silicon hardware; all enterprise/Keychain integrations; full-screen/resize visual acceptance across displays (the card and settings were visually checked in a browser fixture); live response-completion-selector validation after a successful response; a fresh full reinstall cycle. These remain acceptance checks before calling the release production-ready.

Uninstall and restoration to the untouched original were exercised during development. Restoration returns to the untouched signed original rather than overwriting it with a backup. This report intentionally distinguishes simulated coverage, live injection, and unverified live automation.

## October 12 fixes

- Replaced the always-Pause control with Start / Pause / Resume and visible explanations.
- Recognized the real free-message quota notice, including reset time joined to the Upgrade label.
- Prevented ordinary status/alert notifications from causing instant re-pauses, while explicit error banners still pause.
- Prioritized quota notices over unrelated earlier notifications.
- Found sibling response toolbars within one assistant turn; never borrowed an older response's Copy control or a code-copy control. This change has synthetic coverage, and the later live sequence confirmed response completion detection.
- Disabled automation stays disabled during manual composer interaction.
- Renderer heartbeat health survives navigation, preventing false launch-verification failures.
- Added a source-only Update launcher for installed copies.

The update tests verify source backups, preservation of signed app files, and refusal of incomplete update folders before shutdown. The final plugin was reloaded in the running local copy, and the launch verifier confirmed one widget, composer, and Send control.

## Urgent continuation repair

Live operational logs showed quota recovery returning to IDLE without scheduling a continuation. Read-only inspection of the loaded chat showed action-bar-copy outside annotated response bodies. Both cases now have regression coverage. After injection, the real adapter reported completed=true with error=NONE, composer=true, and send=true. A subsequent live sequence showed Start → countdown → submission → observed generation → stable response completion → another scheduled continuation. The user confirmed the repaired version worked. A later submission reached SEND_NOT_ACKNOWLEDGED and paused, so this remains bounded live evidence rather than a validated unattended loop. No conversation text or account data is included in this report.
