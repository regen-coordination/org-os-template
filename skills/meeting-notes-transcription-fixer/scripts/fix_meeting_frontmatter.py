#!/usr/bin/env python3
"""Safely fix meeting-note frontmatter in batch (ReFi DAO OS).

Default mode is dry-run.
Write mode creates per-file backups: <file>.bak-<UTCSTAMP>

Fixes:
- ensure frontmatter exists
- ensure categories includes Meetings
- ensure projects key exists (inferred from filename + path context)
- ensure date field exists (from YYMMDD filename when possible)
"""

from __future__ import annotations

import argparse
import re
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

SKIP_DIRS = {
    ".git",
    ".obsidian",
    ".cursor",
    "node_modules",
    ".venv-transcribe",
    ".venv-whisper",
}

DATE_RE = re.compile(r"^(\d{2})(\d{2})(\d{2}) ")
HASH_SUFFIX = re.compile(r" [0-9a-f]{16,}\.md$", re.IGNORECASE)
WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")
MEETING_KEYWORDS = re.compile(
    r"(meeting|meetup|sync|call|office hours|workshop|work session|work sesh|ops sync|weekly ops|kickoff|discovery|standup|stand-up)",
    re.IGNORECASE,
)

# ReFi DAO project mapping (canonical hub-vault project pages)
PROJECT_MAP: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\brefi\s*dao\b", re.IGNORECASE), "[[260101 ReFi DAO]]"),
    (
        re.compile(r"\bregen coordination\b|\bregion coordination\b", re.IGNORECASE),
        "[[260101 Regen Coordination]]",
    ),
    (re.compile(r"\brefi\s*bcn\b|\brefi\s*barcelona\b", re.IGNORECASE), "[[260101 ReFi BCN]]"),
    (re.compile(r"\bregenerant catalunya\b", re.IGNORECASE), "[[260101 Regenerant Catalunya]]"),
    (re.compile(r"\bkoi\b", re.IGNORECASE), "[[260101 ReFi DAO]]"),
]

PROJECT_ALIAS_TARGETS: dict[str, str] = {
    "260101 refi dao": "[[260101 ReFi DAO]]",
    "251001 refi dao": "[[260101 ReFi DAO]]",
    "250701 refi dao": "[[260101 ReFi DAO]]",
    "260101 regen coordination": "[[260101 Regen Coordination]]",
    "251001 regen coordination": "[[260101 Regen Coordination]]",
    "260101 refi bcn": "[[260101 ReFi BCN]]",
    "260101 regenerant catalunya": "[[260101 Regenerant Catalunya]]",
}


def split_frontmatter(text: str) -> tuple[dict[str, Any], str, bool]:
    if text.startswith("---\n") and "\n---\n" in text:
        front_raw, body = text[4:].split("\n---\n", 1)
        try:
            data = yaml.safe_load(front_raw) or {}
            if not isinstance(data, dict):
                data = {}
        except Exception:
            data = {}
        return data, body, True
    return {}, text, False


def to_iso_date_from_filename(name: str) -> str | None:
    m = DATE_RE.match(name)
    if not m:
        return None
    yy, mm, dd = m.groups()
    year = 2000 + int(yy)
    return f"{year:04d}-{int(mm):02d}-{int(dd):02d}"


def normalize_project_link(value: str) -> str:
    raw = str(value).strip()
    m = WIKILINK_RE.search(raw)
    if not m:
        return raw

    inner = m.group(1).strip()
    key = inner.lower()
    if key in PROJECT_ALIAS_TARGETS:
        return PROJECT_ALIAS_TARGETS[key]

    return f"[[{inner}]]"


def infer_projects_from_context(path: Path) -> list[str]:
    context = " / ".join(path.parts)
    found: list[str] = []
    for pattern, canonical in PROJECT_MAP:
        if pattern.search(context) and canonical not in found:
            found.append(canonical)
    return found


def should_process(
    path: Path,
    include_conflicts: bool,
) -> bool:
    if any(skip in path.parts for skip in SKIP_DIRS):
        return False

    if not path.name.endswith(".md"):
        return False

    name = path.name
    lowered = name.lower()

    if "template" in lowered:
        return False

    if not include_conflicts and (".sync-conflict-" in name or HASH_SUFFIX.search(name)):
        return False

    return bool(MEETING_KEYWORDS.search(path.stem) and DATE_RE.match(path.name))


def normalize_frontmatter(path: Path, fm: dict[str, Any]) -> dict[str, Any]:
    normalized: OrderedDict[str, Any] = OrderedDict()

    categories = fm.get("categories", [])
    if isinstance(categories, str):
        categories = [categories]
    if not isinstance(categories, list):
        categories = []

    cleaned_categories = [str(c).strip() for c in categories if str(c).strip()]
    if "Meetings" not in cleaned_categories:
        cleaned_categories.insert(0, "Meetings")

    projects = fm.get("projects")
    if isinstance(projects, str) and projects.strip():
        projects = [projects.strip()]
    elif not isinstance(projects, list):
        projects = []

    projects = [normalize_project_link(str(p)) for p in projects if str(p).strip()]
    if not projects:
        projects = infer_projects_from_context(path)

    deduped_projects: list[str] = []
    for project in projects:
        if project not in deduped_projects:
            deduped_projects.append(project)

    date_value = fm.get("date")
    if not date_value:
        date_value = to_iso_date_from_filename(path.name)

    normalized["categories"] = cleaned_categories
    if date_value:
        normalized["date"] = date_value
    normalized["projects"] = deduped_projects

    for key, value in fm.items():
        if key not in normalized:
            normalized[key] = value

    return dict(normalized)


def render_content(fm: dict[str, Any], body: str) -> str:
    front = yaml.safe_dump(fm, sort_keys=False, allow_unicode=True).rstrip()
    return f"---\n{front}\n---\n{body}"


def backup_path(path: Path) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return path.with_name(f"{path.name}.bak-{stamp}")


def collect_targets(
    root: Path,
    explicit_paths: list[str],
    include_conflicts: bool,
) -> list[Path]:
    if explicit_paths:
        out = []
        for p in explicit_paths:
            full = (root / p).resolve() if not Path(p).is_absolute() else Path(p)
            if full.exists() and full.is_file():
                out.append(full)
        return out

    out: list[Path] = []
    for path in root.rglob("*.md"):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if should_process(rel, include_conflicts):
            out.append(path)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Fix meeting-note frontmatter safely (ReFi DAO OS)")
    parser.add_argument("--root", default="packages/operations/meetings", help="Meetings root directory")
    parser.add_argument("--paths", nargs="*", default=[], help="Optional explicit file paths")
    parser.add_argument("--include-conflicts", action="store_true", help="Include sync-conflict/hash-suffixed files")
    parser.add_argument("--write", action="store_true", help="Write changes (default: dry-run)")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.exists():
        raise SystemExit(f"Root not found: {root}")

    targets = collect_targets(
        root,
        args.paths,
        args.include_conflicts,
    )

    changed = 0
    skipped = 0

    for path in sorted(targets):
        original = path.read_text(encoding="utf-8", errors="ignore")
        fm, body, has_frontmatter = split_frontmatter(original)

        if not has_frontmatter:
            fm = {}

        new_fm = normalize_frontmatter(path, fm)
        semantic_changed = (not has_frontmatter) or (new_fm != fm)
        if not semantic_changed:
            skipped += 1
            continue

        new_content = render_content(new_fm, body if has_frontmatter else original)

        changed += 1
        rel = path.relative_to(root).as_posix()
        print(f"CHANGED: {rel}")

        if args.write:
            bak = backup_path(path)
            bak.write_text(original, encoding="utf-8")
            path.write_text(new_content, encoding="utf-8")
            print(f"  backup: {bak.relative_to(root).as_posix()}")

    mode = "WRITE" if args.write else "DRY-RUN"
    print(f"{mode} summary -> targets={len(targets)} changed={changed} skipped={skipped}")


if __name__ == "__main__":
    main()
