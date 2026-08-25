"""Merge dv-lexicon-forge's database improvements into the shipped dictionary.

This is an ADDITIVE merge onto the current public/data/dictionary.json, not a
full regeneration from SQLite. 1,332 of the currently-shipped entries --
including high-frequency closed-class words like "eve" (they say, freq 6946)
and "mi" (this) -- are NOT present in dhivehi-latin-slm's `dictionary` table
at all; some earlier build step merged them in directly from spelling.md.
Regenerating purely from SQLite silently drops all 1,332 of them. Always
merge onto the existing file; never replace it wholesale.

What this actually does, given the SQLite database's current state:
  - Updates frequency for entries ALREADY shipped, where corpus.tsv (the
    Dhivehi Wikipedia dump) has a real count. Safe: never touches English.
  - Does NOT add new headwords, even ones with an English gloss already in
    the DB. Tried that once: of 2,352 DB rows with a gloss not yet shipped,
    essentially all turned out to be pre-existing INVERTED or malformed rows
    ("step-mother" -> "dhonmamma", "coconut (malformed)" -> "huhi") that the
    original clean_dictionary.py pass deliberately excluded for exactly that
    reason. Every dv-lexicon-forge headword added today is still gloss-less
    (notes='needs_gloss'), so there is no genuinely new, clean content to add
    yet -- new vocabulary should ship only after clean_dictionary.py's actual
    inversion/malformed-key repair runs, or after review_missing.tsv glosses
    get filled and a human spot-checks the result.

    python tools/export_dictionary.py
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT.parent / "dhivehi-latin-slm" / "data" / "dhivehi_dictionary.db"
CORPUS_TSV = ROOT.parent / "Dhivehi-Tools" / "dhivehi_spell" / "data" / "corpus.tsv"
SHIPPED_JSON = ROOT / "public" / "data" / "dictionary.json"
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


def load_corpus_freq(path: Path) -> dict[str, int]:
    out: dict[str, int] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip("\r")
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) > 1 and parts[1].strip().isdigit():
            out[parts[0].strip()] = int(parts[1].strip())
    return out


def merge(db_path: Path = DEFAULT_DB) -> dict:
    if not db_path.exists():
        raise FileNotFoundError(f"Dictionary DB not found: {db_path}")
    if not SHIPPED_JSON.exists():
        raise FileNotFoundError(
            f"No shipped dictionary at {SHIPPED_JSON} -- nothing to merge onto."
        )

    shipped = json.loads(SHIPPED_JSON.read_text(encoding="utf-8"))
    by_key = {e["latin"]: e for e in shipped}
    corpus_freq = load_corpus_freq(CORPUS_TSV)

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT dhivehi, latin, english, pos, frequency, notes FROM dictionary"
    ).fetchall()
    conn.close()

    freq_updated = 0

    for row in rows:
        key = (row["latin"] or "").strip().lower()
        if not key:
            continue
        existing = by_key.get(key)
        if existing is None:
            continue  # see module docstring: not safe to add new entries here
        real_freq = corpus_freq.get(row["dhivehi"] or "", 0)
        if real_freq and real_freq > existing.get("frequency", 0):
            existing["frequency"] = real_freq
            existing["freqSource"] = "corpus.tsv"
            freq_updated += 1

    exported = sorted(by_key.values(), key=lambda e: e["latin"])

    stats = {
        "shippedBefore": len(shipped),
        "shippedAfter": len(exported),
        "frequencyUpdatedFromCorpus": freq_updated,
        "source": str(db_path),
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    SHIPPED_JSON.write_text(json.dumps(exported, ensure_ascii=False), encoding="utf-8")
    (OUT_DIR / "dictionary_stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return stats


if __name__ == "__main__":
    counts = merge()
    print("Dictionary merge (additive -- nothing dropped)")
    for key, value in counts.items():
        print(f"  {key}: {value}")
