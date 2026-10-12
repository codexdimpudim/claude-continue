# Code review and bug fixes — 2.2.0 preview

[Back to README](../README.md)

This review covers all distributed source, launchers, generated plugin, build and test configuration, and documentation. “Database” in the feature request was interpreted as the plugin codebase and persisted settings. Claude account and conversation databases were not scanned or modified.

## Findings addressed

| Issue | Impact | Fix and evidence |
| --- | --- | --- |
| Background timers can be throttled while the app is unfocused | A 30-second native lease can expire before a delayed heartbeat, and countdown samples can be missed | Active-only timer unthrottling with restoration; two-minute abandoned-session lease; mocked loader tests |
| Reply can finish between sampling ticks | No Stop control is seen and a successful send is mistaken for an unacknowledged one | A changed, completed assistant response can acknowledge it; unchanged responses never trigger retries; engine regression |
| Response changes after countdown starts | A continuation could be sent for a different response | Pin and recheck the response fingerprint and completion marker in engine and renderer preflight; regressions |
| Composer retains submitted text after a failed or uncertain send | Resume could resubmit or erase a draft | Preserve submitted text, remove ownership on pause, and require the user to send or clear the draft; DOM regression |
| A later file replacement fails during update | Earlier files are new while later files are old | Stage all files and backups before replacement; restore replaced sources on failure; simulated failure regression |
| Original app changes before source update | Incompatible sources can be applied before launch notices the change | Verify original and copied app hashes before shutdown; preflight rejection regression |
| Recorded PID belongs to a different process after reboot | Running managed app is missed, risking an unsafe update/removal | Fall back to scanning the exact managed executable; PID-reuse regression |
| Unfamiliar error appears during network recovery | Polling can continue indefinitely instead of showing a useful pause | Pause unknown errors; engine regression |
| Malformed persisted timing values bypass expected minimums | Too-short quiet, verification, or retry periods | Normalize settings type, clamp timing options, and floor count caps; engine regression |
| A saved custom `Continue` prompt is silently replaced | User-selected text changes unexpectedly | Preserve explicit saved prompt text |
| Enlarged countdown appears after position clamping | The bottom of the widget can fall outside the viewport | Re-clamp when the rendered card size changes; visually checked in the browser fixture |

## Feature safeguards

The welcome tour is automatic only on its first display per profile, with Skip and manual replay. It cannot enable a session and replaying it pauses an active one. Paranoid mode describes an **earliest** scheduled send time; an active Claude response has no exact future send time. Approval mode waits for a click and rechecks all normal safeguards. Each continuation needs its own approval. Continue-once caps submissions at one, regardless of the normal maximum.

Themes and compact mode can change during a countdown without resetting it. Changes to sending behavior pause the session. History contains only operational states and reasons and is bounded in memory. The keyboard shortcut only pauses; it never activates automation.

## Remaining limits

The preview depends on Claude’s page controls and exact desktop build. A completed fast reply must visibly change the response fingerprint; an identical reply remains ambiguous and pauses. Full unattended overnight operation, actual quota-reset recovery, real network-loss recovery, and Apple Silicon hardware have not been established by this review. A disk or permission failure that also prevents rollback is reported with the backup location; no updater can guarantee recovery when the filesystem refuses writes. See [the validation report](../TEST-REPORT.md).
