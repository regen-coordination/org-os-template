#!/usr/bin/env python3
"""Build actionable fix queues from audit JSON output (ReFi DAO OS).

Usage:
  python3 skills/meeting-notes-transcription-fixer/scripts/build_fix_queue.py \
    --audit skills/meeting-notes-transcription-fixer/last-audit.json
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def chunks(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [items[i:i + size] for i in range(0, len(items), size)]


def is_metadata_issue(issue: dict[str, Any]) -> bool:
    return (
        (not issue.get("has_frontmatter", True))
        or (not issue.get("has_meetings_category", True))
        or (not issue.get("has_projects", True))
        or (issue.get("has_projects", False) and not issue.get("projects_is_list", True))
        or (not issue.get("has_date_field", True))
    )


def is_transcript_heavy(issue: dict[str, Any], speaker_threshold: int, repeated_threshold: int) -> bool:
    markers = issue.get("transcript_markers", {})
    return (
        markers.get("transcript_header", 0) > 0
        or markers.get("speaker_line", 0) >= speaker_threshold
        or markers.get("repeated_word", 0) >= repeated_threshold
    )


def term_total(issue: dict[str, Any]) -> int:
    return sum((issue.get("term_counts") or {}).values())


def main() -> None:
    parser = argparse.ArgumentParser(description="Build meeting-note fix queues from audit output")
    parser.add_argument(
        "--audit",
        default="skills/meeting-notes-transcription-fixer/last-audit.json",
        help="Path to audit JSON",
    )
    parser.add_argument("--batch-size", type=int, default=15)
    parser.add_argument("--speaker-threshold", type=int, default=120)
    parser.add_argument("--repeated-threshold", type=int, default=80)
    parser.add_argument(
        "--json",
        dest="json_path",
        default="skills/meeting-notes-transcription-fixer/fix-queue.json",
    )
    parser.add_argument(
        "--markdown",
        dest="markdown_path",
        default="skills/meeting-notes-transcription-fixer/fix-queue.md",
    )
    args = parser.parse_args()

    audit_path = Path(args.audit)
    data = json.loads(audit_path.read_text(encoding="utf-8"))
    issues: list[dict[str, Any]] = data.get("issues", [])

    ranked = sorted(issues, key=lambda x: int(x.get("severity", 0)), reverse=True)

    metadata_queue = [i for i in ranked if is_metadata_issue(i) and not i.get("conflict_like_name", False)]
    conflict_queue = [i for i in ranked if i.get("conflict_like_name", False)]
    semantic_queue = [
        i
        for i in ranked
        if is_transcript_heavy(i, args.speaker_threshold, args.repeated_threshold)
        and not i.get("conflict_like_name", False)
    ]
    term_queue = [i for i in ranked if term_total(i) > 0 and not i.get("conflict_like_name", False)]

    output = {
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source_audit": str(audit_path),
        "summary": {
            "issues_total": len(issues),
            "metadata_queue": len(metadata_queue),
            "semantic_queue": len(semantic_queue),
            "term_queue": len(term_queue),
            "conflict_queue": len(conflict_queue),
        },
        "queues": {
            "metadata": metadata_queue,
            "semantic": semantic_queue,
            "terminology": term_queue,
            "conflicts": conflict_queue,
        },
        "batches": {
            "metadata": chunks(metadata_queue, args.batch_size),
            "semantic": chunks(semantic_queue, args.batch_size),
            "terminology": chunks(term_queue, args.batch_size),
        },
    }

    json_path = Path(args.json_path)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    lines: list[str] = []
    lines.append("# Meeting Notes Fix Queue (ReFi DAO OS)")
    lines.append("")
    lines.append(f"- Generated (UTC): `{output['generated_utc']}`")
    lines.append(f"- Source audit: `{output['source_audit']}`")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(f"- Total issues: **{output['summary']['issues_total']}**")
    lines.append(f"- Metadata queue: **{output['summary']['metadata_queue']}**")
    lines.append(f"- Semantic queue: **{output['summary']['semantic_queue']}**")
    lines.append(f"- Terminology queue: **{output['summary']['term_queue']}**")
    lines.append(f"- Conflict queue: **{output['summary']['conflict_queue']}**")
    lines.append("")

    def append_queue(title: str, items: list[dict[str, Any]], limit: int = 30) -> None:
        lines.append(f"## {title}")
        lines.append("")
        if not items:
            lines.append("- none")
            lines.append("")
            return

        for i in items[:limit]:
            lines.append(
                "- `{}` | severity={} | term_total={} | missing_sections={}".format(
                    i.get("path"),
                    i.get("severity", 0),
                    term_total(i),
                    len(i.get("missing_sections", [])),
                )
            )
        lines.append("")

    append_queue("Priority Metadata Queue", metadata_queue)
    append_queue("Priority Semantic Queue", semantic_queue)
    append_queue("Priority Terminology Queue", term_queue)
    append_queue("Conflict Review Queue", conflict_queue)

    lines.append("## Batch Plan")
    lines.append("")
    for queue_name in ["metadata", "semantic", "terminology"]:
        batches = output["batches"][queue_name]
        lines.append(f"### {queue_name}")
        lines.append("")
        if not batches:
            lines.append("- none")
            lines.append("")
            continue
        for idx, batch in enumerate(batches, start=1):
            head = ", ".join(item.get("path", "") for item in batch[:2])
            lines.append(f"- Batch {idx}: {len(batch)} files (e.g., {head})")
        lines.append("")

    md_path = Path(args.markdown_path)
    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")

    print(f"Wrote {json_path}")
    print(f"Wrote {md_path}")


if __name__ == "__main__":
    main()
