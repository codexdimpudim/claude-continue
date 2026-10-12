#!/usr/bin/env python3
"""Bundle the safety engine with the renderer for legacy one-file loaders."""
from pathlib import Path
root=Path(__file__).resolve().parent.parent
engine=(root/'lib/engine.js').read_text()
renderer=(root/'lib/renderer.js').read_text()
(root/'plugins/auto-continue.js').write_text(
    '// Bundled safety engine preserves compatibility with the original one-file loader.\n'
    'if (typeof window !== "undefined" && !window.ClaudeAutoContinueEngine) {\n'
    +engine+'\n}\n'+renderer)
