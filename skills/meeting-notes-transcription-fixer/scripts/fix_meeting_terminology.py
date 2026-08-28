#!/usr/bin/env python3
"""Normalize meeting-note terminology with a safe, repeatable pass (ReFi DAO OS).

- Scopes to meeting files from audit JSON (or all markdown if audit missing)
- Dry-run by default
- Creates per-file backups on write
- Skips conflict-like files unless --include-conflicts
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


CONFLICT_RE = re.compile(r"(\.sync-conflict-| [0-9a-f]{16,}\.md$)", re.IGNORECASE)

# High-confidence terminology normalization (ReFi DAO scope)
RULES: list[tuple[re.Pattern[str], str, str]] = [
    # Organizations / programs
    (re.compile(r"\bReFIDAO\b", re.IGNORECASE), "ReFi DAO", "ReFIDAO/ReFiDAO variant"),
    (re.compile(r"\bReFiDAO\b"), "ReFi DAO", "ReFiDAO variant"),
    (re.compile(r"\bReFIDAL\b", re.IGNORECASE), "ReFi DAO", "ReFIDAL variant"),
    (re.compile(r"\bRefIDal\b"), "ReFi DAO", "RefIDal transcription variant"),
    (re.compile(r"\brefi\s+dao\b"), "ReFi DAO", "refi dao casing (lowercase)"),
    (re.compile(r"\bGreenpeal\b", re.IGNORECASE), "Greenpill Network", "Greenpeal typo"),
    (re.compile(r"\bRegenerative\s+Catalonia\b", re.IGNORECASE), "Regenerant Catalunya", "translated program name"),
    (re.compile(r"\bregenerating\s+Catalu(?:n|ñ)a\b", re.IGNORECASE), "Regenerant Catalunya", "Regenerating Catalunya variant"),

    # KOI (Knowledge Organization Infrastructure) — context-dependent.
    # Only auto-correct when paired with KOI-context phrases nearby.
    # We use a context-bounded pattern: COI followed/preceded by KOI-context words.
    # Conservative: replace COI when in clear KOI context phrases.
    (re.compile(r"\b(?:onboard\s+into|integration\s+with|building\s+on|adopt(?:ion)?\s+of|into\s+the?)\s+COI\b"),
     lambda m: m.group(0).replace("COI", "KOI"), "COI -> KOI (clear KOI-integration context)"),
    (re.compile(r"\bCOI\s+(?:integration|sensor|sensors|MCP|infrastructure|ecosystem|plugin|stack|node|nodes|membership)\b"),
     lambda m: m.group(0).replace("COI", "KOI", 1), "COI -> KOI (followed by KOI domain noun)"),
    (re.compile(r"\bCOI[-\s]integrated\b"), lambda m: m.group(0).replace("COI", "KOI"), "COI-integrated -> KOI-integrated"),
    (re.compile(r"\bRegen\s+COI\b"), "Regen KOI", "Regen COI -> Regen KOI"),
    (re.compile(r"\bawesome[-\s]coi\b", re.IGNORECASE), "awesome-koi", "awesome-coi -> awesome-koi"),

    # Names
    (re.compile(r"\bLuis\b"), "Luizfernando", "Luis -> Luizfernando"),
    (re.compile(r"\bZargon\b"), "Zargham", "Zargon -> Zargham"),
    (re.compile(r"\bMonte\b"), "Monty", "Monte -> Monty"),

    # Project naming style
    (re.compile(r"\blocal\s+refi\s+toolkit\b", re.IGNORECASE), "Local ReFi Toolkit", "local refi toolkit casing"),
    (re.compile(r"\brefi\s+space\b", re.IGNORECASE), "ReFi space", "refi space casing"),
    (re.compile(r"\brefi\s+token\b", re.IGNORECASE), "ReFi token", "refi token casing"),
    (re.compile(r"\brefi\s+barcelona\b", re.IGNORECASE), "ReFi Barcelona", "refi barcelona casing"),
]

# Ambiguous terms to review manually (reported, never auto-changed)
AMBIGUOUS_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bCOI\b"), "Bare COI without KOI context — review (could be KOI typo or genuine COI)"),
    (re.compile(r"\bMichelle\b"), "Could be person or Miceli typo; validate context"),
]


@dataclass
class FileResult:
    path: str
    replacements: int


def load_paths_from_audit(root: Path, audit_path: Path | None) -> list[Path]:
    if audit_path and audit_path.exists():
        data = json.loads(audit_path.read_text(encoding="utf-8"))
        issues = data.get("issues", [])
        out: list[Path] = []
        for issue in issues:
            rel = issue.get("path")
            if not rel:
                continue
            p = (root / rel).resolve()
            if p.exists() and p.is_file():
                out.append(p)
        return out

    return [p for p in root.rglob("*.md") if p.is_file()]


def apply_rules(text: str) -> tuple[str, dict[str, int]]:
    counts: dict[str, int] = {}
    new = text

    for pattern, replacement, label in RULES:
        changed = 0

        def _repl(match: re.Match[str]) -> str:
            nonlocal changed
            src = match.group(0)
            replaced = replacement(match) if callable(replacement) else replacement
            if src == replaced:
                return src
            changed += 1
            return replaced

        new = pattern.sub(_repl, new)
        if changed:
            counts[label] = counts.get(label, 0) + changed

    return new, counts


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize meeting terminology (ReFi DAO OS)")
    parser.add_argument("--root", default="packages/operations/meetings", help="Meetings directory root")
    parser.add_argument(
        "--audit",
        default="skills/meeting-notes-transcription-fixer/last-audit.json",
        help="audit json path for scoped file list",
    )
    parser.add_argument("--include-conflicts", action="store_true", help="include sync-conflict/hash files")
    parser.add_argument("--write", action="store_true", help="write changes (default: dry-run)")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.exists():
        raise SystemExit(f"Root not found: {root}")

    audit_path = Path(args.audit)
    if not audit_path.is_absolute():
        audit_path = audit_path.resolve()

    targets = load_paths_from_audit(root, audit_path if audit_path.exists() else None)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    changed_files: list[FileResult] = []
    totals: dict[str, int] = {}
    ambiguous_totals: dict[str, int] = {}

    for path in sorted(set(targets)):
        if not args.include_conflicts and CONFLICT_RE.search(path.name):
            continue

        original = path.read_text(encoding="utf-8", errors="ignore")
        updated, counts = apply_rules(original)

        for k, v in counts.items():
            totals[k] = totals.get(k, 0) + v

        for pattern, label in AMBIGUOUS_PATTERNS:
            n = len(pattern.findall(updated))
            if n:
                ambiguous_totals[label] = ambiguous_totals.get(label, 0) + n

        if updated != original:
            if args.write:
                backup = path.with_name(f"{path.name}.termbak-{stamp}")
                backup.write_text(original, encoding="utf-8")
                path.write_text(updated, encoding="utf-8")
            try:
                rel = path.relative_to(root).as_posix()
            except ValueError:
                rel = str(path)
            changed_files.append(FileResult(path=rel, replacements=sum(counts.values())))

    mode = "WRITE" if args.write else "DRY-RUN"
    print(f"{mode} summary -> changed_files={len(changed_files)}")

    if totals:
        print("Applied counts:")
        for k in sorted(totals):
            print(f"- {k}: {totals[k]}")
    else:
        print("Applied counts: none")

    if ambiguous_totals:
        print("Ambiguous terms to review:")
        for k in sorted(ambiguous_totals):
            print(f"- {k}: {ambiguous_totals[k]}")

    if changed_files:
        print("Changed files (first 30):")
        for item in changed_files[:30]:
            print(f"- {item.path} ({item.replacements})")


if __name__ == "__main__":
    main()
