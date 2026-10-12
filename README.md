# Claude Continue

Automatic continuation controls for Claude Desktop on macOS.

[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://github.com/codexdimpudim/claude-continue/actions/workflows/tests.yml/badge.svg)](https://github.com/codexdimpudim/claude-continue/actions/workflows/tests.yml)
[![Status: preview](https://img.shields.io/badge/status-preview-d99577.svg)](TEST-REPORT.md)

Keep Claude working on a task with a configurable continuation prompt, visible countdown, and clear Start, Pause, Resume, and Stop controls.

![Widget preview](assets/widget-preview.svg)

**Preview release:** 69 automated checks pass. App loading, the widget, Resume, and detection of the real free-message usage notice have been exercised on macOS. Successful automatic continuation after a real response and recovery after an actual usage reset still need live validation. See [the test report](TEST-REPORT.md).

## What it does

- Continues after observed generation and confirmed, stable completion.
- Offers reusable prompts for coding, game development, or your own work.
- Displays why it paused and when it will check a usage warning again.
- Waits passively during usage limits or connection problems.
- Protects manual drafts and cancels when you interact with or change the chat.
- Limits continuation count and runtime, with optional keep-awake.
- Starts off after launch and allows only one active automation window.

The plugin uses a separately patched copy of the real Claude app. Your installed original stays intact. No Claude app binaries are included in this repository or its downloads.

## Compatibility

| Requirement | Current support |
| --- | --- |
| Operating system | macOS |
| Claude Desktop | **2.31226.1**, exact inspected ASAR build |
| Hardware tested | Intel Mac |
| Apple Silicon | Universal app slices preserved; not tested on hardware |
| Installation tools | Python 3 and macOS `codesign` / `ditto` |
| API key or Node for everyday use | Not required |

Unknown app versions stop at the compatibility check. This is an independent project, unaffiliated with Anthropic.

## Install

1. Download and extract the [latest preview](https://github.com/codexdimpudim/claude-continue/releases). Keep the folder together.
2. Quit Claude and double-click **Install.command**.
3. Resolve any macOS Keychain prompts yourself. Local signing can trigger them.
4. Open an existing chat in the local copy. The installer checks for one widget, the composer, and Send.
5. Use **Launch.command** to reopen this copy later. Opening the original Claude app loads the original app.

If no release download is available, use [Download source](https://github.com/codexdimpudim/claude-continue/archive/refs/heads/main.zip).

Installation creates a versioned backup before patching a separate copy. The inspected build requires local signing: **Touch ID/passkey authentication tied to Anthropic’s signing identity is unavailable in the local copy.** Other signing-dependent integrations remain unverified. Read [the architecture notes](ARCHITECTURE.md) before using the preview for important work.

## Use

Open Settings, choose your continuation prompt and limits, then close Settings. Press **Start** in an existing chat. For a completed response, the card checks it and begins a cancellable countdown. During generation, it waits for Claude to finish. Starting during a usage limit preserves the request and schedules the continuation after availability is verified.

Press **Pause** or **Cancel countdown** to cancel pending automation. Press **Resume** after a pause. **Stop** stops the automation without interrupting Claude’s current response. Editing the prompt pauses automation until you resume.

Start explicitly requests continuation of the latest assistant response. An empty chat pauses; send the first request normally. Loading the widget alone never sends a message.

Defaults are a 10-second delay, 10 continuations, six hours, and a five-second minimum send cooldown. Unlimited limits retain the other safeguards. Uncertain delivery pauses instead of retrying a send.

When a usage notice appears, pending sends stop. Checks happen after 2, 5, 10, then 15 minutes, or after a recognized local reset time plus a buffer. A stale notice may require you to refresh manually. The feature does not change server-side usage limits.

## Update or remove

- **Update.command** backs up and updates plugin sources, then reopens the local copy. The app is not re-signed and preferences remain saved.
- **Uninstall.command** or **Restore Claude.command** closes and removes the managed copy, verifies the original app’s signature, and opens it. Backups and logs remain.
- **Check Compatibility.command** inspects the installed app without patching it.

Runtime: `~/Library/Application Support/ClaudeAutoContinue/Runtime/`  
Backups: `~/Library/Application Support/ClaudeAutoContinue/Backups/`  
Logs: `~/Library/Logs/ClaudeAutoContinue/`

These existing internal names remain unchanged for upgrade compatibility. Logs store operational metadata, not chat URLs, prompt text, or message bodies. Prompts stay in renderer localStorage. Response fingerprints stay in memory.

## Development

```sh
npm ci
npm run build
npm test
npm run test:update
```

The engine, DOM adapter, and mocked loader tests do not contact Claude. Python update tests use temporary folders. GitHub Actions runs the checks on Linux and macOS; neither CI job signs or launches Claude.

Canonical sources are `lib/engine.js`, `lib/renderer.js`, `macos/loader.cjs`, and `macos/manage.py`. Rebuild the committed standalone plugin after changes. See [CONTRIBUTING.md](CONTRIBUTING.md) for validation expectations.

## License and credits

[MIT](LICENSE). Derived from [Bluscream’s claude-desktop-plugin-system](https://github.com/Bluscream/claude-desktop-plugin-system), commit `c3f14f1c2d2d3b42aa0ff2567d785bb610575d0a`. The original copyright notice is preserved. Claude Continue adds the macOS copy-and-restore workflow, a tested continuation engine, and the redesigned widget.
