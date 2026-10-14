# Validation report

## 2.2.2 Beta audit — October 13, 2026

Build: `2.2.2-mac-preview`, for the same exact Claude Desktop `2.31226.1` / Electron `44.4.3` build. The previous release remains available unchanged.

This audit adds regressions for interrupted-task recovery through network/service failures, semantic quota notices, task/response identity, fast identical replies, rich editor paragraphs, partial insertion cleanup, control scoping, harmless inspection, pending human approvals, delayed ownership cancellation, damaged widgets, reload/injection races, exact managed-build validation, stale health, concurrent launchers, and installer rollback/removal failures. The [scenario matrix](docs/RELIABILITY-AUDIT.md) explains the intended result and remaining boundaries.

Rendered acceptance cases exercise twelve acknowledged continuations with an exact cap, an interrupted quota response without a completion toolbar followed by further turns, and preservation of human text preventing later sends. A deterministic engine simulation exercises 200 submissions with 23 quota interruptions and 19 service waits. It checks cooldown, count limits, and duplicate-action prevention. These are simulations, not live Claude sessions.

Canonical sources are tested directly, and the committed standalone bundle must exactly match the build output. Installer fixtures use temporary folders; loader fixtures use mocked Electron.

All **194 automated cases pass locally** on the tested Intel Mac (Node 26.11.1; Python 3.9.6):

| Layer | Passing cases |
| --- | ---: |
| Engine | 77 |
| Renderer / DOM | 68 |
| Rendered multi-turn acceptance | 3 |
| Native loader mocks | 29 |
| Installer / update / removal fixtures | 17 |

JavaScript syntax, Python compilation, launcher syntax, generated-bundle parity, and diff whitespace checks also pass. [GitHub Actions](https://github.com/codexdimpudim/claude-continue/actions/workflows/tests.yml) runs the full source suite on Linux and macOS with Node 24; inspect the commit's run for its result. CI never launches Claude or sends a message.

The managed local copy was updated without changing its signed app files. All six installed source files match this release. Its real native loader reports `compatible=true` and `bundleReady=true`, and the actual Claude renderer loaded exactly one `2.2.2-mac-preview` widget in `DISABLED`, with no power assertion and no repeated tutorial. The app reopened on its home screen, so its first control-verification wait timed out. After the user opened an existing chat, fresh health confirmed one widget, composer, and Send; the launch check was rerun. This confirms loading, the new exact-ASAR gate, and current-chat controls in the real app. No live continuation was submitted by the audit.

**Still Beta:** no new unrestricted live sends were made during this audit. Previous authorized bounded continuations are recorded below. A fresh real quota-reset cycle, overnight unattended soak, physical network-loss recovery, Apple Silicon hardware, remote UI changes, and enterprise/signing-dependent integrations remain acceptance boundaries. Unknown delivery intentionally pauses rather than retrying.

## Previous release evidence — 2.2.1 Beta

Build: `2.2.1-mac-preview`, based on Claude Desktop `2.31226.1` / Electron `44.4.3`.

## Automated checks

The test suite covers 98 JavaScript cases across the pure state machine, synthetic DOM, and mocked Electron loader, plus five Python update tests (103 total). Run the commands in README.md to reproduce the automated checks. Tests do not contact Claude.

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

Not completed: a multihour unattended soak; actual quota reset; physical network-disconnect recovery; Chrome Remote Desktop interaction; actual app upgrade; separate Apple Silicon hardware; all enterprise/Keychain integrations; full-screen/resize visual acceptance across displays (the card and settings were visually checked in a browser fixture); a fresh full reinstall cycle. These remain acceptance checks before calling the release production-ready.

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

## 2.2.0 codebase review and feature validation

The full distributed codebase was reviewed: the state engine, renderer, generated bundle, native loader, installer/update/restore paths, launchers, build configuration, tests, and documentation. Claude account or conversation databases were not inspected or modified. Findings and remaining limits are documented in [the review notes](docs/CODE-REVIEW.md). This is a code review with regression coverage, not proof that no bugs remain.

Additional automated cases cover fast replies without a sampled Stop control, changed-response cancellation, loss of completion markers, approval for one send only, unknown errors during network recovery, saved timing clamps, first-run tour and replay, skipping or closing onboarding, smooth countdown display, theme persistence without session interruption, one-shot sessions, submitted composer preservation, keyboard pause, renderer throttling restoration, stale heartbeat expiry, PID reuse, pre-shutdown compatibility rejection, and update rollback after a simulated disk failure.

The actual new tour, theme controls, settings layout, and countdown were exercised in a browser fixture using the real plugin sources. That fixture submits no Claude requests. Real app loading is checked separately after source deployment; this version does not claim a new live quota-reset or overnight soak result. The earlier successful 2.1.1 continuation remains the bounded live evidence described above.

After the 2.2.0 source update, the real managed app reopened and the launcher verified one widget, composer, and Send control. Native health reported loader 2.2.0, renderer 2.2.0-mac-preview, DISABLED, tutorialVisible=true, and no power assertion. No Claude request was sent to perform this update verification. This confirms deployment and first-tour visibility in the actual renderer, not new end-to-end continuation or overnight validation.

## October 13 overnight quota-recovery failure

The real local log showed WAITING_FOR_USAGE_RESET → CHECKING_AVAILABILITY at 12:20:30 AM America/New_York on October 13, followed by RECOVERING → COUNTDOWN at 12:20:35 and PAUSED / COMPLETION_UNCERTAIN half a second later. Two manual Resume attempts also immediately paused for the same reason. This is evidence of a real failed reset recovery, not a successful soak result.

The quota had interrupted generation, so no finished-response toolbar was available after the warning cleared. The previous implementation incorrectly required normal completion for that interrupted task. The repair gives verified quota recovery a scoped interrupted-task path with an additional ten-second stable-idle check. Explicit Start/Resume can also resume the already-stuck chat after ten idle seconds. Ordinary completion, unknown network delivery, generation detection, drafts, warning checks, and no-duplicate-submit rules remain enforced. Latest user-turn and response fingerprints are pinned in memory during submission.

Eleven new cases cover the logged overnight timing, missing toolbar through actual renderer insertion/click in a synthetic DOM, manual Resume, no-text user tasks, renewed generation, task changes, network errors, and quota returning before submission. Synthetic tests do not contact Claude. A new actual reset recovery still requires live observation.

The authorized one-continuation live test ran in the user-selected existing chat on October 13. Before submission, native diagnostics reported completed=false, resumable=true, ready=true, no warning, no generation, and no human draft. At 5:28:35 PM America/New_York the one-send session was activated; after stable-idle verification it entered COUNTDOWN at 5:28:46, submitted at 5:28:56, and observed GENERATING at 5:28:57. The test immediately paused automation after that single acknowledged send. It used the saved continuation behavior and did not change prompt or limit preferences. The temporary harness was removed from the installed plugin and is not distributed. This confirms live resumption of the already-interrupted chat. A fresh real quota-reset cycle and sustained unattended looping remain unverified.
