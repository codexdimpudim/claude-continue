# Installation and maintenance

[Back to README](../README.md)

## Before installation

Claude Continue currently accepts Claude Desktop **2.31226.1** and the exact inspected ASAR hash in `macos/compatibility.json`. It was tested on an Intel Mac. The launchers require **`/usr/bin/python3` version 3.8 or later**, plus macOS `codesign` and `ditto`. The tested system interpreter is Python 3.9.6, provided through Apple's developer tools; a Homebrew-only interpreter is not automatically selected. Node and an API key are not needed for normal use. At least 3 GB of free space is required for the app copy and backup.

Use **Check Compatibility.command** to inspect your app before installing. It does not modify it. An unknown build is a stop condition; do not edit the hash file simply to make installation proceed.

## First installation

1. Download the current Beta ZIP from [Releases](https://github.com/codexdimpudim/claude-continue/releases/tag/v2.2.2-beta.1).
2. Extract it and keep every file in the same folder. Avoid running launchers from inside a ZIP viewer.
3. Finish active work and quit Claude.
4. Double-click **Install.command**. If macOS prevents it from opening, inspect the package and use your normal approved method to open it. Do not disable system security settings to install this preview.
5. Installation verifies the original app’s signature and compatibility, creates and verifies a versioned backup, patches a separate copy, updates ASAR integrity metadata, and locally signs the copy.
6. Resolve Keychain prompts yourself. Do not share a password with a script, issue, or chat.
7. Open an existing conversation in the local copy. Installation reports verified loading only after detecting exactly one widget, the composer, and the Send control. Automation begins off.

Touch ID/passkey authentication linked to Anthropic’s signing identity is unavailable in the local copy. See [architecture notes](../ARCHITECTURE.md) for the signing tradeoffs.

The small release ZIP includes plugin sources, launchers, tests, documentation, and artwork. It omits the original 4K trailer, which remains available in the repository. No Claude app binaries are included.

## Subsequent launches

Use **Launch.command**. The normal Claude icon opens the original app and does not load this plugin. The launcher checks that the original and copied app still match the recorded build and modified-file hashes. If the widget is off, open the intended chat and press Start when you want continuation.

If launch verification times out, let the app finish loading, open an existing chat, and run Launch.command again. A timeout does not prove a complete installation.

## Updating an existing plugin installation

1. Download and extract the new preview package.
2. Finish active work in the local Claude copy.
3. Run **Update.command** from the newly downloaded folder, not from the installed Runtime directory.
4. The updater checks source completeness, generated bundle consistency, and app compatibility before graceful shutdown, stages all replacements and backups, replaces the plugin sources, and reopens the local copy. A replacement failure restores the previous source files. A process-held lock prevents competing launchers or updates.
5. Your prompt, themes, and mode preferences remain saved. Reopen your intended chat and press Start: automation starts off after the update. The welcome tour appears only if it has never been shown in this profile.

The source updater does not re-sign or upgrade Claude itself. A vendor app update needs a fresh compatibility investigation.

## Uninstalling or returning to original Claude

Run **Uninstall.command** or **Restore Claude.command**. They request graceful shutdown, release the power assertion, verify the original’s signature, then remove the managed runtime and open the original. They refuse to delete a still-running managed copy or one whose original is missing/invalid. They do not overwrite an original app that was updated.

The original app was never patched. Versioned backups and operational logs remain after removal. If the original is missing, the tool stops and identifies the backup instead of guessing where to restore it.

## Installed locations

| Location | Contents |
| --- | --- |
| `~/Library/Application Support/ClaudeAutoContinue/Runtime/Claude.app` | Managed local app copy |
| `~/Library/Application Support/ClaudeAutoContinue/Runtime/lib/` | Installed engine and renderer sources |
| `~/Library/Application Support/ClaudeAutoContinue/Runtime/plugins/` | Installed standalone plugin |
| `~/Library/Application Support/ClaudeAutoContinue/Backups/` | Versioned app and plugin-source backups |
| `~/Library/Logs/ClaudeAutoContinue/` | Operational and installation logs |

The historical internal folder names are preserved for compatibility. The installer does not create a login item or start continuation automatically after reboot.
