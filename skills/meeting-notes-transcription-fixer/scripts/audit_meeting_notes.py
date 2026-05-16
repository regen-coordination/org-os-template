#!/usr/bin/env python3
"""Audit meeting notes/transcriptions in ReFi DAO OS.

Outputs a concise report with:
- meeting-file counts
- metadata gaps (frontmatter/categories/projects/date)
- possible duplicate/conflict files
- terminology drift counts (ReFi-DAO-scoped)
- structure gaps (attendees/agenda/decisions/actions/next steps)
- transcript artifact markers
- severity-ranked queue for staged cleanup
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

DEFAULT_SKIP_DIRS = {
    ".git",
    ".obsidian",
    ".cursor",
    "node_modules",
    ".venv-transcribe",
    ".venv-whisper",
}

MEETING_KEYWORDS = re.compile(
    r"(meeting|meetup|sync|call|office hours|workshop|work session|work sesh|ops sync|weekly ops|kickoff|discovery|standup|stand-up)",
    re.IGNORECASE,
)
DATE_PREFIX = re.compile(r"^\d{6} ")
HASH_SUFFIX = re.compile(r" [0-9a-f]{16,}\.md$", re.IGNORECASE)

# ReFi-DAO-scoped terminology drift markers
TERM_PATTERNS = {
    "Luis": re.compile(r"\bLuis\b"),
    "ReFIDAO": re.compile(r"\bReFIDAO\b"),
    "ReFiDAO": re.compile(r"\bReFiDAO\b"),
    "ReFIDAL": re.compile(r"\bReFIDAL\b"),
    "RefIDal": re.compile(r"\bRefIDal\b"),
    "Greenpeal": re.compile(r"\bGreenpeal\b"),
    "Zargon": re.compile(r"\bZargon\b"),
    # KOI/COI is context-dependent — flag occurrences for review (not auto-correct)
    "COI": re.compile(r"\bCOI\b"),
}

SECTION_PATTERNS = {
    "attendees": re.compile(r"\battendees\b", re.IGNORECASE),
    "agenda": re.compile(r"\bagenda\b", re.IGNORECASE),
    "key_decisions": re.compile(r"\b(key decisions?|decisions?)\b", re.IGNORECASE),
    "action_items": re.compile(r"\baction items?\b", re.IGNORECASE),
    "next_steps": re.compile(r"\bnext steps?\b", re.IGNORECASE),
}

TRANSCRIPT_PATTERNS = {
    "transcript_header": re.compile(r"^Transcript[:\s]*$", re.IGNORECASE | re.MULTILINE),
    "speaker_line": re.compile(r"^(?:\*\*)?[A-Z][A-Za-zÀ-ÖØ-öø-ÿ\-_' ]{1,30}[:：]", re.MULTILINE),
    "timestamp": re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?\b"),
    "repeated_word": re.compile(r"\b(\w+)\s+\1\b", re.IGNORECASE),
}


@dataclass
class FileIssue:
    path: str
    has_frontmatter: bool
    has_meetings_category: bool
    has_projects: bool
    projects_is_list: bool
    has_date_field: bool
    nonstandard_name: bool
    conflict_like_name: bool
    missing_sections: list[str]
    term_counts: dict[str, int]
    transcript_markers: dict[str, int]
    severity: int


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


def is_excluded_path(path: Path) -> bool:
    if any(skip in path.parts for skip in DEFAULT_SKIP_DIRS):
        return True
    lowered = path.name.lower()
    if "template" in lowered:
        return True
    return False


def list_markdown_files(root: Path) -> list[Path]:
    out: list[Path] = []
    for path in root.rglob("*.md"):
        if not path.is_file():
            continue
        if is_excluded_path(path):
            continue
        out.append(path)
    return out


def is_meeting_candidate(path: Path, fm: dict[str, Any]) -> bool:
    lowered = path.name.lower()
    if "template" in lowered:
        return False

    by_name = bool(DATE_PREFIX.match(path.name) and MEETING_KEYWORDS.search(path.stem))

    categories = fm.get("categories", []) if isinstance(fm, dict) else []
    if isinstance(categories, str):
        categories = [categories]
    by_category = any(str(c).strip().lower() == "meetings" for c in categories)

    return by_name or by_category


def has_meetings_category(fm: dict[str, Any]) -> bool:
    categories = fm.get("categories", []) if isinstance(fm, dict) else []
    if isinstance(categories, str):
        categories = [categories]
    return any(str(c).strip().lower() == "meetings" for c in categories)


def has_projects(fm: dict[str, Any]) -> bool:
    projects = fm.get("projects") if isinstance(fm, dict) else None
    if isinstance(projects, list):
        return len([p for p in projects if str(p).strip()]) > 0
    if isinstance(projects, str):
        return bool(projects.strip())
    return False


def projects_is_list(fm: dict[str, Any]) -> bool:
    projects = fm.get("projects") if isinstance(fm, dict) else None
    return isinstance(projects, list)


def looks_nonstandard_name(path: Path) -> bool:
    return bool(MEETING_KEYWORDS.search(path.stem) and not re.match(r"^\d{6} .+\.md$", path.name))


def looks_conflict_name(path: Path) -> bool:
    name = path.name
    return ".sync-conflict-" in name or bool(HASH_SUFFIX.search(name))


def compute_severity(
    has_frontmatter_flag: bool,
    has_meetings_category_flag: bool,
    has_projects_flag: bool,
    projects_is_list_flag: bool,
    has_date_field_flag: bool,
    conflict_like_name_flag: bool,
    missing_sections: list[str],
    term_counts: dict[str, int],
) -> int:
    score = 0
    if not has_frontmatter_flag:
        score += 4
    if not has_meetings_category_flag:
        score += 2
    if not has_projects_flag:
        score += 3
    if has_projects_flag and not projects_is_list_flag:
        score += 1
    if not has_date_field_flag:
        score += 1
    if conflict_like_name_flag:
        score += 2

    score += len(missing_sections)
    score += min(sum(term_counts.values()), 5)
    return score


def infer_issue(path: Path, root: Path, text: str) -> FileIssue:
    fm, body, has_frontmatter_flag = split_frontmatter(text)

    term_counts = {k: len(p.findall(text)) for k, p in TERM_PATTERNS.items()}
    transcript_markers = {k: len(p.findall(text)) for k, p in TRANSCRIPT_PATTERNS.items()}

    missing_sections = [
        key for key, pattern in SECTION_PATTERNS.items() if not pattern.search(body)
    ]

    has_meetings_category_flag = has_meetings_category(fm)
    has_projects_flag = has_projects(fm)
    projects_is_list_flag = projects_is_list(fm)
    has_date_field_flag = bool(fm.get("date")) if isinstance(fm, dict) else False
    conflict_like_name_flag = looks_conflict_name(path)

    severity = compute_severity(
        has_frontmatter_flag,
        has_meetings_category_flag,
        has_projects_flag,
        projects_is_list_flag,
        has_date_field_flag,
        conflict_like_name_flag,
        missing_sections,
        term_counts,
    )

    return FileIssue(
        path=path.relative_to(root).as_posix(),
        has_frontmatter=has_frontmatter_flag,
        has_meetings_category=has_meetings_category_flag,
        has_projects=has_projects_flag,
        projects_is_list=projects_is_list_flag,
        has_date_field=has_date_field_flag,
        nonstandard_name=looks_nonstandard_name(path),
        conflict_like_name=conflict_like_name_flag,
        missing_sections=missing_sections,
        term_counts=term_counts,
        transcript_markers=transcript_markers,
        severity=severity,
    )


def build_summary(issues: list[FileIssue]) -> dict[str, Any]:
    summary: dict[str, Any] = {}

    summary["meeting_files"] = len(issues)
    summary["missing_frontmatter"] = sum(not i.has_frontmatter for i in issues)
    summary["missing_meetings_category"] = sum(not i.has_meetings_category for i in issues)
    summary["missing_projects"] = sum(not i.has_projects for i in issues)
    summary["projects_not_list"] = sum(i.has_projects and not i.projects_is_list for i in issues)
    summary["missing_date_field"] = sum(not i.has_date_field for i in issues)
    summary["nonstandard_name"] = sum(i.nonstandard_name for i in issues)
    summary["conflict_like_name"] = sum(i.conflict_like_name for i in issues)

    section_missing: Counter[str] = Counter()
    term_counts: Counter[str] = Counter()
    transcript_counts: Counter[str] = Counter()

    for issue in issues:
        section_missing.update(issue.missing_sections)
        term_counts.update({k: v for k, v in issue.term_counts.items() if v})
        transcript_counts.update({k: v for k, v in issue.transcript_markers.items() if v})

    summary["section_missing"] = dict(section_missing)
    summary["term_counts"] = dict(term_counts)
    summary["transcript_markers"] = dict(transcript_counts)

    summary["examples"] = {
        "missing_meetings_category": [i.path for i in issues if not i.has_meetings_category][:20],
        "missing_projects": [i.path for i in issues if not i.has_projects][:20],
        "projects_not_list": [
            i.path for i in issues if i.has_projects and not i.projects_is_list
        ][:20],
        "conflict_like_name": [i.path for i in issues if i.conflict_like_name][:20],
        "nonstandard_name": [i.path for i in issues if i.nonstandard_name][:20],
    }

    summary["top_severity"] = [
        {
            "path": i.path,
            "severity": i.severity,
            "missing_projects": not i.has_projects,
            "missing_meetings_category": not i.has_meetings_category,
            "missing_date_field": not i.has_date_field,
            "conflict_like_name": i.conflict_like_name,
        }
        for i in sorted(issues, key=lambda x: x.severity, reverse=True)[:30]
    ]

    return summary


def to_markdown(root: Path, summary: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append("# Meeting Notes Audit (ReFi DAO OS)")
    lines.append("")
    lines.append(f"- Root: `{root}`")
    generated = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    lines.append(f"- Generated (UTC): `{generated}`")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(f"- Meeting files: **{summary['meeting_files']}**")
    lines.append(f"- Missing frontmatter: **{summary['missing_frontmatter']}**")
    lines.append(f"- Missing `categories: [Meetings]`: **{summary['missing_meetings_category']}**")
    lines.append(f"- Missing `projects`: **{summary['missing_projects']}**")
    lines.append(f"- `projects` present but not list format: **{summary['projects_not_list']}**")
    lines.append(f"- Missing `date` field: **{summary['missing_date_field']}**")
    lines.append(f"- Nonstandard filename for meeting-like files: **{summary['nonstandard_name']}**")
    lines.append(f"- Conflict-like filenames: **{summary['conflict_like_name']}**")
    lines.append("")

    lines.append("## Missing Sections")
    lines.append("")
    for key in ["attendees", "agenda", "key_decisions", "action_items", "next_steps"]:
        lines.append(f"- {key}: {summary['section_missing'].get(key, 0)}")
    lines.append("")

    lines.append("## Terminology Drift Counts")
    lines.append("")
    if summary["term_counts"]:
        for term, count in sorted(summary["term_counts"].items()):
            lines.append(f"- {term}: {count}")
    else:
        lines.append("- (none detected)")
    lines.append("")

    lines.append("## Transcript Artifact Markers")
    lines.append("")
    if summary["transcript_markers"]:
        for marker, count in sorted(summary["transcript_markers"].items()):
            lines.append(f"- {marker}: {count}")
    else:
        lines.append("- (none detected)")
    lines.append("")

    lines.append("## Sample Problem Files")
    lines.append("")
    for bucket in [
        "missing_meetings_category",
        "missing_projects",
        "projects_not_list",
        "conflict_like_name",
        "nonstandard_name",
    ]:
        lines.append(f"### {bucket}")
        sample = summary["examples"].get(bucket, [])
        if not sample:
            lines.append("- none")
        else:
            for p in sample:
                lines.append(f"- `{p}`")
        lines.append("")

    lines.append("## Priority Review Queue (by severity)")
    lines.append("")
    for row in summary["top_severity"]:
        lines.append(
            f"- `{row['path']}` | severity={row['severity']} | missing_projects={row['missing_projects']} | missing_meetings_category={row['missing_meetings_category']} | missing_date_field={row['missing_date_field']} | conflict_like_name={row['conflict_like_name']}"
        )

    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit ReFi DAO OS meeting notes")
    parser.add_argument("--root", default="packages/operations/meetings", help="Meetings directory root")
    parser.add_argument("--json", dest="json_path", help="Write JSON report")
    parser.add_argument("--markdown", dest="markdown_path", help="Write markdown report")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.exists():
        raise SystemExit(f"Root not found: {root}")

    files = list_markdown_files(root)

    issues: list[FileIssue] = []
    for path in files:
        text = path.read_text(encoding="utf-8", errors="ignore")
        fm, _body, _ = split_frontmatter(text)
        if not is_meeting_candidate(path, fm):
            continue
        issues.append(infer_issue(path, root, text))

    summary = build_summary(issues)

    output = {
        "summary": summary,
        "issues": [asdict(i) for i in issues],
    }

    if args.json_path:
        json_path = Path(args.json_path)
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    markdown = to_markdown(root, summary)
    if args.markdown_path:
        md_path = Path(args.markdown_path)
        md_path.parent.mkdir(parents=True, exist_ok=True)
        md_path.write_text(markdown, encoding="utf-8")

    print(markdown)


if __name__ == "__main__":
    main()
