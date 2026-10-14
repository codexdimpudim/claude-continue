# Troubleshooting

[Back to README](../README.md)

Start with the card’s detail text. It explains the pause reason rather than treating every pause as the same problem.

## The widget is missing

Use Launch.command to open the managed copy, then open an existing chat. The original app does not load the plugin. If the local app takes time to load, run Launch.command again once its chat controls appear. If the launcher reports a version or hash mismatch, stop and use Check Compatibility.command; do not patch an unknown build by removing the checks.

If an older managed copy updated itself and lost the widget, quit Claude and run Repair.command from the latest complete package. It rebuilds from the exact signed supported source or a preserved installation backup. The current original app remains installed. A missing Runtime is also repairable when a supported backup exists.

## Start or Resume immediately pauses

- **Your message is still in the composer:** send or clear it yourself. The plugin preserves manual drafts.
- **Settings saved:** close Settings and Resume when the configuration is ready.
- **Open an existing chat:** the current page does not identify a supported chat.
- **No assistant response yet:** send your first request normally.
- **Another window active:** pause that window’s automation first.
- **Warning or controls unavailable:** resolve the visible warning, inspect the app, and Resume when ready.

## Claude finished, but continuation did not happen

A Stop control disappearing is insufficient: it might indicate an error or interruption. The adapter also needs a supported completion marker in the latest response area and a stable quiet period. Version 2.1.1 fixes Claude’s action-bar-copy control appearing outside the annotated response body. Update from the latest package if you are on 2.1.0.

If the response visibly finished but the card still says completion is uncertain, report the Claude version, macOS version, architecture, card status/reason, and whether the response action toolbar appears. Redact chat text and account information from screenshots.

## The countdown finished but generation was not observed

Check the actual chat. The plugin waits up to 45 seconds for generation acknowledgment, then pauses with SEND_NOT_ACKNOWLEDGED. Do not repeatedly Resume without checking whether the previous message was accepted: uncertain delivery is deliberately not retried automatically.

A network interruption after submission can similarly pause with DELIVERY_UNCERTAIN. Repeating the request could duplicate work, so review it before taking over.

## Waiting for usage reset continues past the displayed time

Checks are passive. They follow the recognized reset time plus a buffer, or the configured checking intervals. A status banner can remain stale even after server availability changes. Inspect the page, refresh manually if appropriate, and Resume after the chat is available. Genuine quota-reset recovery has not yet been fully validated live.

## The local app asks for Keychain access or Touch ID fails

The copied app is locally signed and has a different signing identity. Resolve Keychain prompts yourself. Touch ID/passkey authentication tied to Anthropic’s Keychain groups is unavailable in the copy; use the original signed app for those features. Other signing-dependent integrations may also need the original app.

## App update or compatibility failure

Launch checks the preserved signed baseline and the copied app’s recorded modified-file hashes. The loader also checks the copied ASAR hash when opened directly and blocks its inspected native updater entry points. The original app can update independently. An unknown copied build pauses launch rather than being patched blindly. Use Repair.command to rebuild from a supported backup, file a compatibility request, or use Restore Claude.command to return to the current native original.

Extract the complete release folder before running Update.command. The updater rejects missing files or a generated bundle that differs from its source files before it closes Claude. Keep the folder together; developers must rebuild after source changes. If another launcher is running, let it finish before launching again. After an update, reopen your existing chat and press Start.

## Mac sleep, background operation, and long sessions

Keep-awake requests prevent-app-suspension while automation is active, but does not guarantee operation after a shutdown or with the lid closed. A wake gap can require revalidation. Background browser timer throttling and long unattended sessions have not been comprehensively validated; a short successful continuation is not evidence of a whole-night soak.

## Useful error categories

| Category | What it indicates |
| --- | --- |
| HUMAN_CONTROL / HUMAN_DRAFT | Manual interaction or draft content canceled automation |
| HUMAN_APPROVAL_REQUIRED | A visible dialog or tool approval needs your attention |
| SETTINGS_CHANGED / CONVERSATION_CHANGED | Configuration or selected chat changed |
| NO_RESPONSE_TO_CONTINUE | Empty or unsupported response area |
| COMPLETION_UNCERTAIN | The latest turn lacks a supported completion signal |
| SEND_PREFLIGHT_CHANGED | Controls, chat, or state changed before submission |
| SEND_BUTTON_DISABLED / EDITOR_INSERT_FAILED | Safe composer submission could not complete |
| SEND_NOT_ACKNOWLEDGED / DELIVERY_UNCERTAIN | A previous submission needs human review |
| MAX_CONTINUATIONS / MAX_RUNTIME | Enabled-session cap reached |
| DUPLICATE_RESPONSE_LOOP / EMPTY_RESPONSE_LOOP | Repeated output triggered loop protection |
| WINDOW_LOCK_UNAVAILABLE / ANOTHER_WINDOW_ACTIVE | Single-window coordination could not be acquired |
| WAKE_REVALIDATION_REQUIRED | Resume only after reviewing the chat following a gap |

## Reporting a bug

Use [Issues](https://github.com/codexdimpudim/claude-continue/issues) with the plugin release, Claude version, macOS version, hardware architecture, launch method, steps to reproduce, and the card’s state/reason. Note whether a message was actually sent and whether Claude began responding. Distinguish what the page showed from what you expected.

Logs live in `~/Library/Logs/ClaudeAutoContinue/`. Sharing a short redacted state sequence is more useful than posting the entire folder. Remove account details, chat URLs, prompts, message bodies, credentials, and unrelated vendor output. For sensitive security issues, follow [SECURITY.md](../SECURITY.md).
