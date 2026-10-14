#!/bin/bash
set -euo pipefail
installed_manager="$HOME/Library/Application Support/ClaudeAutoContinue/Runtime/macos/manage.py"
if [[ -f "$installed_manager" ]]; then
  exec /usr/bin/python3 "$installed_manager" launch "$@"
fi
cd "$(dirname "$0")"
exec /usr/bin/python3 macos/manage.py launch "$@"
