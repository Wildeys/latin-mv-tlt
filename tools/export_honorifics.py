"""Convert honorifics.tsv to public/data/honorifics.json."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TSV = ROOT.parent / "dhivehi-latin-slm" / "data" / "honorifics.tsv"
OUT = ROOT / "public" / "data" / "honorifics.json"


def export(tsv_path: Path = DEFAULT_TSV) -> int:
    rows = []
    for line in tsv_path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 6 or parts[0].strip() == "latin":
            continue
        # Thaana is read from the TSV but not exported: the shipped data is
        # Latin + English only. See Context/PROJECT.md.
        latin, _thaana, english, register, kind, plain = (p.strip() for p in parts[:6])
        if not latin:
            continue
        rows.append(
            {
                "latin": latin,
                "english": [g.strip() for g in english.split(";") if g.strip()],
                "register": register,
                "kind": kind,
                "plainForm": None if plain in ("", "-") else plain,
            }
        )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(rows)


if __name__ == "__main__":
    print(f"Honorifics exported: {export()}")
