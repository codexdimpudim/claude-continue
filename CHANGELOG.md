# Changelog

## 2.2.1 Beta — 2026-10-13

**Release status: Beta.** The interrupted-chat repair passed a bounded live continuation test. A fresh real usage-reset cycle and sustained unattended operation remain unverified.

- Fixed the overnight failure reproduced from the real 12:20 AM quota-reset logs: recovery reached a countdown, then paused because a quota-interrupted reply had no completion toolbar.
- Verified quota recovery now distinguishes an interrupted task from a normally completed response. Incomplete replies get an additional ten-second stable-idle check before a cancellable countdown; ordinary automatic completion retains its completion-marker requirement.
- Explicit Start/Resume can resume a stable interrupted reply after ten idle seconds, including an existing user task that produced no assistant text. Empty chats still do not send.
- Pin the latest user turn as well as the assistant response during countdown and submission. Streaming/busy metadata also prevents sending.
- Added regression coverage for overnight recovery, the already-stuck chat, draft/generation cancellation, task changes, network ambiguity, quota reappearing during submission, and one-send activation without changing saved preferences. 98 JavaScript and five Python cases pass (103 total).
- A one-continuation live test resumed the actual interrupted chat and observed generation. The test stopped automation after one acknowledged send; regular unattended operation still needs observation.

## 2.2.0 preview — 2026-10-12

- Added a once-per-profile greeting and five-step onboarding tour, with Skip and manual replay.
- Added Paranoid mode with a tenth-of-a-second countdown, target time, and progress; usage waits display the next passive check.
- Added Terracotta, Ocean, Forest, Lavender, and Light themes, compact view, position reset, recent activity, and Option + Shift + P to pause.
- Added approval before every continuation and continue-once mode. Appearance changes preserve an active session; automation changes pause it.
- Recognize a completed fast reply even if its Stop control was missed between samples. Uncertain unchanged replies still pause without resending.
- Cancel a pending send if the response changes or its completion marker disappears. Preserve submitted composer text if delivery is not acknowledged.
- Keep active renderer timers unthrottled and restore their prior setting on pause, navigation, renderer exit, stale heartbeat, and app quit. Extended the native heartbeat lease to tolerate a throttled timer.
- Stage update sources before replacing them and roll back failed replacements. Check app hashes before update shutdown. Find the managed copy even when a recorded PID was reused after reboot.
- Preserve custom continuation text, normalize malformed saved settings, and prevent enlarged cards from moving below the window edge.
- 86 JavaScript regression tests plus five Python update tests pass locally (91 total). Long unattended use and real quota-reset recovery remain unverified.

## 2.1.1 preview — 2026-10-12

- Fixed a usage wait entered from idle losing its continuation intent when usage returned.
- Start now explicitly continues a completed chat after quiet checks and a cancellable countdown.
- Fixed completion controls outside annotated assistant bodies, including real Claude action-bar-copy toolbars. Mounted hidden toolbars are recognized; older turns and code-copy controls remain excluded.
- Added seven regression cases; 69 automated checks total.

## 2.1.0 preview — 2026-10-12

Initial public release of Claude Continue for macOS.

- Separate app copy, verified backups, compatibility checks, local signing, launch, and restoration.
- Continuation engine with countdown, runtime/count limits, draft protection, and one-window ownership.
- Start/Pause/Resume controls and a redesigned status card with visible pause reasons.
- Real free-message quota notice recognition, reset-time parsing, and passive waiting.
- Scoped response-completion controls and protections against code-copy and older-turn false positives.
- Source update launcher, metadata-only operational logs, and optional keep-awake.
- 60 JavaScript and two Python tests.

End-to-end automatic continuation and actual quota-reset recovery remain unverified. See TEST-REPORT.md.
