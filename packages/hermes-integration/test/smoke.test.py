"""Smoke test for the hermes integration.

Verifies the tool module is importable in standalone mode (without hermes's
real registry), and that check_requirements gates correctly on ORG_OS_ROOT.
Run: python3 test/smoke.test.py
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

# Add the package root to sys.path so `from tools.org_os import ...` resolves
# in standalone mode (the file uses a stub registry when hermes isn't present).
_PKG_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_PKG_ROOT))


def _import_tool():
    """Import the tool module fresh, ensuring stub registry is active."""
    # Drop any cached version (in case of repeated runs).
    for mod in list(sys.modules):
        if mod.startswith("tools.org_os") or mod == "tools":
            del sys.modules[mod]
    from tools.org_os import check_requirements, org_os_page  # noqa: WPS433

    return check_requirements, org_os_page


def test_check_requirements_without_env() -> None:
    os.environ.pop("ORG_OS_ROOT", None)
    check_requirements, _ = _import_tool()
    assert check_requirements() is False, "should return False when ORG_OS_ROOT unset"


def test_check_requirements_with_invalid_path() -> None:
    os.environ["ORG_OS_ROOT"] = "/tmp/definitely-not-a-real-org-os-repo-xyz"
    check_requirements, _ = _import_tool()
    assert check_requirements() is False, "should return False when path lacks package.json"


def test_check_requirements_with_valid_path() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "package.json").write_text("{}")
        os.environ["ORG_OS_ROOT"] = tmp
        check_requirements, _ = _import_tool()
        assert check_requirements() is True, "should return True when path has package.json"


def test_org_os_page_returns_error_when_unset() -> None:
    os.environ.pop("ORG_OS_ROOT", None)
    _, org_os_page = _import_tool()
    result = org_os_page({"page_id": "dashboard"})
    assert "ORG_OS_ROOT" in result, f"expected error mentioning ORG_OS_ROOT, got: {result}"


def test_org_os_page_validates_page_id() -> None:
    os.environ["ORG_OS_ROOT"] = "/some/path"  # invalid but bypasses the env check below
    _, org_os_page = _import_tool()
    result = org_os_page({"page_id": ""})
    assert "non-empty string" in result, f"expected validation error, got: {result}"


def main() -> int:
    tests = [
        test_check_requirements_without_env,
        test_check_requirements_with_invalid_path,
        test_check_requirements_with_valid_path,
        test_org_os_page_returns_error_when_unset,
        test_org_os_page_validates_page_id,
    ]
    failures = 0
    for t in tests:
        try:
            t()
            print(f"✓ {t.__name__}")
        except AssertionError as err:
            print(f"✗ {t.__name__}: {err}")
            failures += 1
        except Exception as err:  # noqa: BLE001
            print(f"✗ {t.__name__}: unexpected {type(err).__name__}: {err}")
            failures += 1
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
