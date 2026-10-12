# Using Claude Continue

[Back to README](../README.md)

## A normal session

Open an existing chat in the managed local copy. Choose Settings, configure your continuation prompt and limits, close Settings, and press Start.

For a completed assistant response, Start verifies the current response and begins a countdown. During an active response, Start waits for generation to finish. During a usage limit, Start keeps your request pending while availability is checked. Empty chats pause: submit your first request normally before starting automation.

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
| Open Logs | Open the local operational-log folder |
| Drag the card header | Move the widget; position is saved and clamped to the window |

Resume resets the enabled-session count and elapsed timer. App reloads and launches start off even if the previous session was active.

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
| Sending Continue | Final checks passed and a submission is in progress |
| Waiting for Claude | One submission was made; generation acknowledgment is pending |
| Waiting for usage reset | A usage notice is visible; sends are suspended |
| Checking Availability / Verifying availability | A passive check is clear; availability must remain clear before scheduling |
| Waiting for connection/service | A network or service error is being checked conservatively |
| Paused | The detail text explains what needs attention |
| Stopped | Automatic continuations were stopped explicitly |

## Manual control and safeguards

Typing, pasting, dropping content, or interacting with chat controls cancels pending automation. Changing conversations and editing automation settings also pause it. Your own message in the composer is not overwritten. Only one window can hold automation ownership at a time.

The plugin re-checks the conversation, generation state, warnings, composer, and Send control before submission. It clicks once; it does not press Enter as a blind fallback or resend when acknowledgment is uncertain. Three identical completed responses or repeated empty responses can pause a possible loop.

Runtime limits let an already generating response finish before pausing. Count limits apply to submissions, not a count of completed successful tasks. Keep-awake is optional and does not make shutdown, lid-close sleep, or lost connectivity disappear.

## Usage waiting

A visible quota notice suspends sending. A recognized local reset time schedules a passive check after a buffer; otherwise the configurable interval sequence is used. The notice must clear and controls must remain usable through a verification interval before continuation is scheduled. No extra request is sent just to probe quota.

If the page keeps an outdated notice after the displayed reset time, inspect or refresh the chat yourself. The plugin cannot guarantee that server state will be reflected in a stale page, and it cannot add quota or bypass limits.
