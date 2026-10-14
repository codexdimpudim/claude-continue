# Reliability audit — 2.2.2 Beta

The [2.2.3 launch/repair report](../TEST-REPORT.md#223-beta-launchrepair--october-14-2026) adds coverage for vendor updates replacing the copied app, exact-path foreground launch, home health, preserved-source compatibility, queued-update refusal, and staged repair. Its 216 passing cases extend the audit below; prior releases remain unchanged.

Date: October 13, 2026. Scope: the complete tracked plugin source, generated bundle, native loader, local-copy installer, launch/update/removal scripts, saved settings, and continuation safeguards. The 2.2.1 Beta release is retained unchanged.

The audit repaired reproducible blockers and added regression cases at the layer where each failure occurred. It does **not** prove successful completion in every possible Claude, network, macOS, or project state. A deliberate pause for human input, uncertain delivery, or a configured cap is expected behavior.

## Continuation and recovery

| Scenario | Expected behavior and coverage |
| --- | --- |
| Completed existing chat | Explicit Start checks a stable latest turn, then schedules one cancellable send; engine and rendered submission tests |
| Generation already running | Wait for stable supported completion; Stop disappearing alone cannot authorize a send |
| Interrupted reply or user task with no assistant text | Explicit Start verifies ten idle seconds; empty chats remain blocked |
| Quota interrupted an active task | Suspend sending; verify clear availability and stable idle controls before resuming, even with no completion toolbar |
| Network/server outage during quota wait | Preserve the original interrupted-task recovery basis; engine regressions and a 200-submission interruption simulation |
| Start while offline / outage before submission | Preserve the unsent explicit request through passive recovery |
| Network failure after submission | Pause on uncertain delivery; never blindly resend |
| Quota returns during countdown or composer handoff | Cancel submission and return to passive waiting |
| Quota banner precedes the submitted user turn | Accept one renderer-proven owned-turn handoff; another user's identical-text turn cannot inherit recovery |
| Fast response finishes between samples | Changed response text or a distinct assistant-turn identity acknowledges it; identical repeated output still has loop protection |
| Task/response changes during recovery or countdown | Cancel before another request is adopted or submitted |
| New human draft, settings change, navigation, or pause | Cancel pending work and preserve human text, including delayed window-lock acquisition |
| Twelve-turn rendered chat | Observe each accepted send and response; stop exactly at the configured twelve-submission cap |
| Quota interruption mid rendered chat | Resume the same partial task, then continue the next completed turn |
| Human follow-up mid rendered chat | Preserve the draft and prevent all subsequent automatic sends |
| Runtime/count limits, duplicate/empty output, long wake gap | Pause with a reason; Unlimited retains draft, warning, acknowledgment, cooldown, and loop safeguards |
| Replies finish during a passive wait | Account new completed assistant identities toward duplicate/empty-loop protection without counting the old completed reply twice |
| Runtime expires as generation begins | Observe fresh Stop/streaming controls and allow the active response to finish before pausing |
| Approval mode / one-shot / another active window | Require explicit approval, stop at one submission, or refuse competing ownership |

## Renderer and controls

| Scenario | Expected behavior and coverage |
| --- | --- |
| Textarea / rich editor / multiline prompt | Preserve text and paragraph structure; verify the exact inserted text before clicking |
| Partial insertion or editor failure | Clean up only plugin-owned unsent text; preserve any intervening human edit |
| Hidden, disabled, unrelated, or generated-content Send | Reject it; use only the actual composer control |
| Latest-turn native Continue without a composer form | Use the legitimate response action once and look for acknowledgment |
| Continue inside generated content, dialog, artifact, or approval | Exclude it; human approval regions pause automation |
| Copy, expand details, text selection, caret movement | Allow read-only inspection without an unnecessary pause |
| Submission click throws / missing controls | Pause rather than leaving a pending send stuck |
| Widget detached or required controls removed | Dispose automation; no invisible continuation loop |
| Quota wording is unfamiliar | Explicit semantic quota elements outside chat content still suspend sends |
| Hidden warnings / quoted error text | Do not adopt chat prose or hidden unrelated elements as live controls |
| Storage unavailable or malformed | Normalize settings, preserve valid custom prompts, and report unavailable storage |
| Initialization, disposal, resizing, themes, tour | One widget, released observers/timers, visible position, persisted appearance, once-per-profile onboarding |

## Native loader and installation

| Scenario | Expected behavior and coverage |
| --- | --- |
| Page already loaded when attached | Inject it without waiting for a future load event |
| Duplicate load events / navigation during injection | Avoid overlapping injection and reject stale document health |
| Untrusted origin / same-version altered Claude build | Refuse injection; validate the installed copied ASAR against its manifest |
| Invalid or incomplete replacement bundle | Leave the working plugin intact; validate before disposal |
| Reload injection fails | Restore the cached working widget with automation off; retain the request for recovery instead of reporting success |
| Same-chat in-place navigation | Preserve enabled automation and active background timer/power leases; different chat/full navigation cancels the relevant session/leases |
| Renderer exit, app exit, pause, expired heartbeat | Restore prior throttling, release optional power assertion, and remove stale health |
| Native power or log-folder failure | Continue functioning without relying on optional power/log facilities |
| Concurrent launcher/update | Refuse the second operation through a process-held lock |
| Missing sources / stale generated bundle | Refuse before update shutdown or launch |
| Stale PID or malformed/old health | Refuse false launch verification |
| Staging/replacement/signature failure | Keep the original app intact and restore replaced plugin sources where possible |
| Removal with missing/invalid original | Refuse destructive removal; retain the managed copy and backups |

Tests use synthetic DOM, fake clocks, mocked Electron, and temporary installation folders. Linux/macOS CI runs the same source checks; neither job launches Claude or signs a real app. See [TEST-REPORT.md](../TEST-REPORT.md) for counts and live observations.

## Boundaries that remain

- The exact inspected Claude Desktop 2.31226.1 build is required. Future remote UI changes can invalidate controls independently of the desktop version.
- A stale usage banner must visibly clear. The plugin sends no quota probes and does not refresh away a live chat automatically; manual refresh may be necessary.
- Unknown errors, pending permissions, absent completion controls, or ambiguous delivery require human review. It cannot answer security dialogs or determine that every project task is finished.
- Restart, shutdown, closed-lid sleep, lost authentication, and server quota are external constraints. Launch starts off; open your chat and Start again. Keep-awake does not override all macOS sleep conditions.
- Earlier bounded real continuations succeeded. This release's extended simulations are not a multihour real-app soak, a fresh real usage reset, physical network-disconnect testing, or Apple Silicon hardware acceptance.

Use [the bug-report guide](TROUBLESHOOTING.md#reporting-a-bug) with the state/reason and whether a send was accepted. Do not share conversation text, credentials, or unredacted logs.
