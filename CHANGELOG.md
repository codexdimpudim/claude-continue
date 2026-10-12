# Changelog

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
