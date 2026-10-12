# Contributing

Issues and pull requests are welcome. Include the Claude version, macOS version, architecture, and what the widget shows. Remove account information, conversation text, chat URLs, and credentials from reports.

Run `npm ci`, `npm run build`, `npm test`, and `npm run test:update`. Commit the rebuilt `plugins/auto-continue.js` together with source changes. Prefer regression cases for real failure modes: draft preservation, duplicate submission, usage notices, navigation, and response completion.

Compatibility changes need evidence from the exact Claude build. Do not simply loosen the version/hash gate. Distinguish synthetic tests from live validation. Keep app binaries, account files, and raw diagnostic captures out of the repository. Preserve upstream license attribution.
