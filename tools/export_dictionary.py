"""Export the SQLite dictionary to browser JSON and print counted stats.

Do not hardcode 6795 or 16000 in the report. Use the printed counts.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT.parent / "dhivehi-latin-slm" / "data" / "dhivehi_dictionary.db"
OUT_DIR = ROOT / "public" / "data"


def parse_english(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return [part.strip() for part in raw.split(";") if part.strip()]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def export(db_path: Path = DEFAULT_DB) -> dict:
    if not db_path.exists():
        raise FileNotFoundError(f"Dictionary DB not found: {db_path}")

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT dhivehi, latin, english, pos, frequency FROM dictionary"
    ).fetchall()
    conn.close()

    exported = []
    thaana = set()
    latin = set()
    with_english = 0
    for row in rows:
        english = parse_english(row["english"])
        if english:
            with_english += 1
        entry = {
            "dhivehi": row["dhivehi"] or "",
            "latin": (row["latin"] or "").strip(),
            "english": english,
            "pos": row["pos"] or "",
            "frequency": int(row["frequency"] or 0),
        }
        if not entry["latin"] and not entry["dhivehi"]:
            continue
        exported.append(entry)
        if entry["dhivehi"]:
            thaana.add(entry["dhivehi"])
        if entry["latin"]:
            latin.add(entry["latin"].lower())

    stats = {
        "rawDbRows": len(rows),
        "uniqueThaana": len(thaana),
        "uniqueLatin": len(latin),
        "entriesWithEnglish": with_english,
        "finalExportedEntries": len(exported),
        "source": str(db_path),
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "dictionary.json").write_text(
        json.dumps(exported, ensure_ascii=False), encoding="utf-8"
    )
    (OUT_DIR / "dictionary_stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return stats


if __name__ == "__main__":
    counts = export()
    print("Dictionary export")
    for key, value in counts.items():
        print(f"  {key}: {value}")
