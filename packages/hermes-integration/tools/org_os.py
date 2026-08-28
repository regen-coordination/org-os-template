"""hermes tool: org_os_page — calls `npm run page <id>` in the operator's org-os repo.

Discovered automatically by hermes's tool registry via the top-level
`registry.register()` call. To activate, symlink this file into the hermes
checkout's `tools/` directory and add `"org_os"` to a toolset in
`hermes_cli/toolsets.py` (typically `_HERMES_CORE_TOOLS`).

The skill manifest lives at ../SKILL.md and should be symlinked into
`<hermes>/skills/org_os_pages/SKILL.md`.

Environment:
    ORG_OS_ROOT — required. Absolute path to the operator's org-os repo.

Behavior on missing config:
    The tool returns a human-readable error string rather than raising.
    `check_requirements()` returns False if ORG_OS_ROOT is unset or invalid,
    which lets hermes hide the tool from the model when it can't be used.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

# Hermes registry import — this file is dropped into hermes's `tools/`
# directory at install time. The import is intentionally absolute (`tools.registry`)
# to match hermes's own tool files; it will only resolve at runtime inside hermes.
try:
    from tools.registry import registry  # type: ignore[import-not-found]
except ImportError:
    # Standalone mode (unit tests, lint, IDE) — define a no-op stub so the
    # module loads. Hermes overrides this at runtime.
    class _StubRegistry:
        def register(self, **_kwargs):
            pass

    registry = _StubRegistry()  # type: ignore[assignment]


_TIMEOUT_SECONDS = 15


def _resolve_root() -> str | None:
    """Return ORG_OS_ROOT if set and valid, else None."""
    root = os.getenv("ORG_OS_ROOT")
    if not root:
        return None
    pkg = Path(root) / "package.json"
    if not pkg.exists():
        return None
    return root


def check_requirements() -> bool:
    """Return True iff ORG_OS_ROOT is set and points at a valid org-os repo."""
    return _resolve_root() is not None


def org_os_page(args: dict, **_kwargs) -> str:
    """Render an org-os page and return its text output.

    Args:
        args: dict with key 'page_id' (string).

    Returns:
        Rendered page text on success, or an error message string on failure.
    """
    page_id = args.get("page_id", "dashboard")
    if not isinstance(page_id, str) or not page_id.strip():
        return "ERROR: page_id must be a non-empty string."

    root = _resolve_root()
    if not root:
        return (
            "ERROR: ORG_OS_ROOT env var not set or invalid. "
            "Set it to your org-os repo path: `export ORG_OS_ROOT=~/code/org-os`"
        )

    try:
        result = subprocess.run(
            ["npm", "run", "page", "--silent", "--", page_id],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return f"ERROR: page {page_id} timed out (>{_TIMEOUT_SECONDS}s)"
    except FileNotFoundError:
        return "ERROR: `npm` not found on PATH. Install Node.js ≥ 22."

    if result.returncode != 0:
        return (
            f"ERROR: page {page_id} exited with code {result.returncode}\n"
            f"stderr: {result.stderr.strip() or '(empty)'}"
        )
    return result.stdout


registry.register(
    name="org_os_page",
    toolset="org_os",
    schema={
        "type": "object",
        "properties": {
            "page_id": {
                "type": "string",
                "description": (
                    "Page id to render. Examples: 'dashboard', 'projects', "
                    "'project/v2-stabilization', 'instances', 'this-week', "
                    "'health', 'decisions', 'attention'. Full list in the "
                    "org-os repo at packages/tui-data/src/builtin-pages.mjs."
                ),
            },
        },
        "required": ["page_id"],
    },
    handler=org_os_page,
    check_fn=check_requirements,
    requires_env=["ORG_OS_ROOT"],
)
