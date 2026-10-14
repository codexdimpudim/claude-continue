# Using Claude Continue

[Back to README](../README.md)

## First launch

A five-step welcome tour explains Start, Pause, settings, and usage waiting. It appears automatically only once per Claude browser profile. Skip it or complete it; even closing the app partway does not bring it back on the next launch. **Settings → Quick tour** replays it on request. Opening the tour during automation pauses the session.

## A normal session

Open an existing chat in the managed local copy. Choose Settings, configure your continuation prompt and limits, close Settings, and press Start.

For a completed assistant response, Start verifies the current response and begins a countdown. During an active response, Start waits for generation to finish. During a usage limit, Start keeps your request pending while availability is checked. Empty chats pause: submit your first request normally before starting automation. If a previous response was interrupted and has no finished toolbar, explicit Start/Resume verifies ten stable idle seconds before continuing. A pending user request with no assistant text can also be resumed explicitly.

An example coding workflow is to ask Claude to implement a focused feature, then enable the plugin while it works. The continuation prompt can ask it to preserve finished work, test changes, fix failures, and move to the next unfinished task. Review the result and use Pause or Stop when you need control.

## Controls

| Control | Result |
| --- | --- |
| Start | Explicitly enable continuation in the selected chat |
| Pause | Cancel pending automatic actions and release ownership |
| Cancel countdown | Cancel the upcoming send and pause automation |
| Resume | Enable a fresh session after a pause; re-check the chat before scheduling |
| Stop | Stop automatic continuations; does not interrupt Claude’s current response |
| Settings | Edit prompts, session limits, checking intervals, and optional behavior |
| Approve this continuation | In approval mode, authorize the current continuation after its countdown; final checks still apply |
| Option + Shift + P | Pause active automation immediately |
| Quick tour | Replay onboarding on request; pauses an active session |
| Reset position | Bring the widget back to a visible position |
| Open Logs | Open the local operational-log folder |
| Drag the card header | Move the widget; position is saved and clamped to the window |

Resume resets the enabled-session count and elapsed timer. App reloads and launches start off even if the previous session was active.

## Visibility and modes

**Paranoid mode:** enable it in Settings to see a countdown updating every tenth of a second, the earliest scheduled send time, and a progress bar. Usage or network waits show the time to the next passive check instead. While Claude is generating, there is no scheduled send yet. A timestamp is a local schedule, not a guarantee of successful submission: final checks can cancel or delay it.

**Ask me before each continuation:** when the countdown finishes, the card waits and reveals an approval button. No message is sent until you click it. Approval applies to one continuation and expires if you pause, change chats, or encounter a warning. The next continuation needs its own approval. This option can be combined with Paranoid mode.

**Continue once, then pause:** temporarily caps the enabled session at one submission, even if your normal maximum is Unlimited. The plugin monitors that response and pauses after completion; it does not schedule a second continuation. Resume starts another one-shot session.

**Color schemes:** Terracotta, Ocean, Forest, Lavender, and Light apply to the card, settings panel, and tutorial. **Compact widget** hides extra detail and statistics while leaving the buttons and optional monitor available. Appearance changes apply immediately and preserve the active session.

**Recent activity:** Settings lists the latest five state transitions, with local times and reasons. It contains operational metadata, not conversation text. Session diagnostics show continuation counts, failures, usage waits, and versions. History is held in memory, bounded, and cleared when the widget is reloaded.

Appearance and modes are saved across launches. Automation itself always starts off. Editing approval or one-shot behavior pauses the session so Resume explicitly adopts it.

## Prompts and presets

Default asks Claude to continue from the current project state, preserve finished work, test recent changes, repair problems, and proceed to the next unfinished task. Simple uses `Continue.` Coding focuses on code and testing. Game Development focuses on the game’s working systems, bugs, visuals, interactions, and performance. Autonomous Development asks for further unfinished development work.

A custom prompt replaces the preset text. Optional project instructions are appended after a blank line. Prompt text is inserted as text, not interpreted as widget HTML. A response-scoped Continue/Resume button takes precedence when available, so not every continuation uses the custom composer prompt.

Example custom project instructions:

> Keep the current architecture. Finish the settings screen, check keyboard navigation, and summarize any remaining issues before changing another feature.

Prompt wording influences Claude’s behavior; the plugin does not independently verify that a whole project is complete.

## Status messages

| State | Meaning |
| --- | --- |
| Ready when you are | Installed and disabled |
| Claude is working | Generation has been observed |
| Continuing in … | Stable completion was confirmed and a send is scheduled |
| Waiting for your approval | Approval mode has reached its deadline; no send occurs until approved |
| Sending Continue | Final checks passed and a submission is in progress |
| Waiting for Claude | One submission was made; generation acknowledgment is pending |
| Waiting for usage reset | A usage notice is visible; sends are suspended |
| Checking Availability / Verifying availability | A passive check is clear; availability must remain clear before scheduling |
| Waiting for connection/service | A network or service error is being checked conservatively |
| Paused | The detail text explains what needs attention |
| Stopped | Automatic continuations were stopped explicitly |

## Manual control and safeguards

Typing, pasting, dropping content, sending, stopping generation, and changing conversations cancel pending automation. Copying a response, expanding its details, selecting response text, and moving the caret with the keyboard are allowed. Clicking into the composer takes manual control and pauses automation. Editing automation settings also pauses it. Your own message in the composer is not overwritten. Only one window can hold automation ownership at a time. Pause also cancels an activation that is still waiting to acquire that ownership.

The plugin re-checks the conversation, latest task and response identities, generation state, warnings, composer, and Send control before submission. A native Continue control must belong to the latest response actions; controls in generated content, dialogs, or tool approvals are excluded. Pending human approvals pause automation. It clicks once; it does not press Enter as a blind fallback or resend when acknowledgment is uncertain. Three identical completed responses or repeated empty responses can pause a possible loop.

Runtime limits let an already generating response finish before pausing. Count limits apply to submissions, not a count of completed successful tasks. Keep-awake is optional and does not make shutdown, lid-close sleep, or lost connectivity disappear.

## Usage waiting

A visible quota notice suspends sending. A recognized local reset time schedules a passive check after a buffer; otherwise the configurable interval sequence is used. Time-zone-qualified or ambiguous dates use polling. The notice must clear and controls must remain usable through a verification interval before continuation is scheduled. A quota-interrupted response can lack a completion toolbar even after the notice clears. This case gets an additional ten-second stable-idle check; its continuation remains cancellable and still requires all normal chat, draft, warning, and generation checks. Connection/service failures during this passive wait preserve the same interrupted task. A changed task cancels recovery. No extra request is sent just to probe quota.

If the page keeps an outdated notice after the displayed reset time, inspect or refresh the chat yourself. The plugin cannot guarantee that server state will be reflected in a stale page, and it cannot add quota or bypass limits.
