"""Merge Database_sources into the browser dictionary without replacing it.

Never deletes an existing Latin key. Writes public/data/dictionary.json and
dictionary_stats.json with measured counts.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT.parent / "Database_sources"
OUT_DIR = ROOT / "public" / "data"
CURRENT = OUT_DIR / "dictionary.json"
LATIN_SRC = SOURCES / "dictionary_latin.json"
FULL_DB = SOURCES / "full curreny database.json"
SPELLING = SOURCES / "spelling.md"
FRITZ = ROOT / "tools" / "fritz_closed_class.json"

POS_CANON = {
    "n": "noun",
    "noun": "noun",
    "nan": "noun",
    "ނަން": "noun",
    "nanithuruge nan": "noun",
    "v": "verb",
    "verb": "verb",
    "masdharu": "verb",
    "kan": "verb",
    "adj": "adjective",
    "adjective": "adjective",
    "nanithuru": "adjective",
    "adv": "adverb",
    "adverb": "adverb",
    "kanithuru": "adverb",
    "ithuru": "adverb",
    "pron": "pronoun",
    "pronoun": "pronoun",
    "conj": "conjunction",
    "conjunction": "conjunction",
    "particle": "particle",
    "prep": "preposition",
    "preposition": "preposition",
    "interj": "interjection",
    "num": "numeral",
    "numeral": "numeral",
    "akuru": "unknown",
}

WEAK_POS = {"", "unknown", "akuru"}
THAANA_RE = re.compile(r"[\u0780-\u07BF]")


def canon_pos(value: str | None) -> str:
    raw = (value or "").strip()
    return POS_CANON.get(raw.lower(), raw or "unknown")


def parse_english(raw) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    if not isinstance(raw, str):
        return [str(raw).strip()] if str(raw).strip() else []
    text = raw.strip()
    if not text:
        return []
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return [part.strip() for part in re.split(r"[;|]", text) if part.strip()]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def latin_key(value: str | None) -> str:
    return (value or "").strip().lower()


def looks_like_english_phrase(latin: str) -> bool:
    return " " in latin and bool(re.fullmatch(r"[A-Za-z][A-Za-z0-9' -]{2,}", latin))


def union_english(existing: list[str], incoming: list[str]) -> tuple[list[str], bool]:
    seen = {item.lower() for item in existing}
    added = False
    out = list(existing)
    for item in incoming:
        key = item.lower()
        if not key or key.startswith("[unknown:"):
            continue
        if key not in seen:
            out.append(item)
            seen.add(key)
            added = True
    return out, added


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def parse_spelling(path: Path) -> tuple[dict[str, int], dict[str, str]]:
    freq: dict[str, int] = {}
    thaana: dict[str, str] = {}
    if not path.exists():
        return freq, thaana
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if len(parts) < 3 or not THAANA_RE.search(parts[0]):
            continue
        try:
            count = int(parts[2].strip())
        except ValueError:
            continue
        key = parts[1].strip().lower()
        if not key:
            continue
        if key not in freq or count > freq[key]:
            freq[key] = count
            thaana[key] = parts[0].strip()
    return freq, thaana


def as_entry(
    *,
    dhivehi: str,
    latin: str,
    english: list[str],
    pos: str,
    frequency: int,
) -> dict:
    return {
        "dhivehi": dhivehi or "",
        "latin": latin.strip(),
        "english": english,
        "pos": canon_pos(pos),
        "frequency": int(frequency or 0),
    }


def merge_into(
    index: dict[str, dict],
    incoming: dict,
    stats: dict[str, int],
    *,
    verified_thaana: bool = False,
) -> None:
    key = latin_key(incoming.get("latin"))
    if not key:
        return
    if key not in index:
        if looks_like_english_phrase(incoming["latin"]):
            stats["skippedEnglishKeys"] += 1
            return
        index[key] = incoming
        stats["newlyAdded"] += 1
        return

    current = index[key]
    merged, added = union_english(current["english"], incoming["english"])
    if added:
        current["english"] = merged
        stats["glossesUnioned"] += 1

    incoming_pos = canon_pos(incoming.get("pos"))
    if incoming_pos not in WEAK_POS and current.get("pos") in WEAK_POS:
        current["pos"] = incoming_pos
        stats["posFilled"] += 1

    incoming_freq = int(incoming.get("frequency") or 0)
    if incoming_freq > int(current.get("frequency") or 0):
        current["frequency"] = incoming_freq
        stats["frequencyUpdated"] += 1

    incoming_th = incoming.get("dhivehi") or ""
    current_th = current.get("dhivehi") or ""
    if incoming_th and THAANA_RE.search(incoming_th):
        if not current_th or (verified_thaana and incoming_th != current_th):
            current["dhivehi"] = incoming_th
            stats["thaanaRepaired"] += 1


def load_current() -> list[dict]:
    if CURRENT.exists():
        data = load_json(CURRENT)
        return [
            as_entry(
                dhivehi=row.get("dhivehi", ""),
                latin=row.get("latin", ""),
                english=parse_english(row.get("english")),
                pos=row.get("pos", ""),
                frequency=row.get("frequency") or 0,
            )
            for row in data
            if row.get("latin") or row.get("dhivehi")
        ]
    return []


def load_latin_src() -> list[dict]:
    if not LATIN_SRC.exists():
        return []
    rows = []
    for row in load_json(LATIN_SRC):
        rows.append(
            as_entry(
                dhivehi=row.get("word") or "",
                latin=row.get("word_latin") or "",
                english=parse_english(row.get("english")),
                pos=row.get("part_of_speech_latin") or row.get("part_of_speech") or "",
                frequency=1,
            )
        )
    return rows


def load_full_db() -> tuple[list[dict], set[str]]:
    if not FULL_DB.exists():
        return [], set()
    rows = []
    verified = set()
    for row in load_json(FULL_DB):
        latin = row.get("latin") or ""
        entry = as_entry(
            dhivehi=row.get("dhivehi") or "",
            latin=latin,
            english=parse_english(row.get("english")),
            pos=row.get("pos") or "",
            frequency=row.get("frequency") or 0,
        )
        rows.append(entry)
        if int(row.get("thaana_verified") or 0) == 1 and latin_key(latin):
            verified.add(latin_key(latin))
    return rows, verified


def main() -> dict:
    current_rows = load_current()
    before_entries = len(current_rows)
    before_latin = {latin_key(row["latin"]) for row in current_rows if row["latin"]}

    stats = {
        "newlyAdded": 0,
        "glossesUnioned": 0,
        "posFilled": 0,
        "frequencyUpdated": 0,
        "thaanaRepaired": 0,
        "skippedEnglishKeys": 0,
    }

    index: dict[str, dict] = {}
    for row in current_rows:
        key = latin_key(row["latin"])
        if not key:
            continue
        if key not in index:
            index[key] = row

    for row in load_latin_src():
        merge_into(index, row, stats)

    full_rows, verified = load_full_db()
    for row in full_rows:
        merge_into(index, row, stats, verified_thaana=latin_key(row["latin"]) in verified)

    if FRITZ.exists():
        for raw in load_json(FRITZ):
            merge_into(
                index,
                as_entry(
                    dhivehi=raw.get("dhivehi") or "",
                    latin=raw.get("latin") or "",
                    english=parse_english(raw.get("english")),
                    pos=raw.get("pos") or "particle",
                    frequency=raw.get("frequency") or 1,
                ),
                stats,
            )

    spell_freq, spell_thaana = parse_spelling(SPELLING)
    for key, count in spell_freq.items():
        if key not in index:
            continue
        current = index[key]
        if count > int(current.get("frequency") or 0):
            current["frequency"] = count
            stats["frequencyUpdated"] += 1
        incoming_th = spell_thaana.get(key, "")
        if incoming_th and not (current.get("dhivehi") or ""):
            current["dhivehi"] = incoming_th
            stats["thaanaRepaired"] += 1

    exported = list(index.values())
    exported.sort(key=lambda row: (-int(row.get("frequency") or 0), row.get("latin", "").lower()))

    after_latin = {latin_key(row["latin"]) for row in exported if row["latin"]}
    dropped = sorted(before_latin - after_latin)
    if dropped:
        raise RuntimeError(f"Refusing to write: dropped {len(dropped)} Latin keys, e.g. {dropped[:5]}")

    thaana = {row["dhivehi"] for row in exported if row["dhivehi"]}
    with_english = sum(1 for row in exported if row["english"])

    out_stats = {
        "beforeEntries": before_entries,
        "beforeUniqueLatin": len(before_latin),
        "rawDbRows": len(exported),
        "uniqueThaana": len(thaana),
        "uniqueLatin": len(after_latin),
        "entriesWithEnglish": with_english,
        "finalExportedEntries": len(exported),
        "newlyAdded": stats["newlyAdded"],
        "glossesUnioned": stats["glossesUnioned"],
        "posFilled": stats["posFilled"],
        "frequencyUpdated": stats["frequencyUpdated"],
        "thaanaRepaired": stats["thaanaRepaired"],
        "skippedEnglishKeys": stats["skippedEnglishKeys"],
        "latinKeysDropped": 0,
        "source": (
            "merge: public/data/dictionary.json + Database_sources/dictionary_latin.json "
            "+ Database_sources/full curreny database.json + tools/fritz_closed_class.json "
            "+ Database_sources/spelling.md"
        ),
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    CURRENT.write_text(json.dumps(exported, ensure_ascii=False), encoding="utf-8")
    (OUT_DIR / "dictionary_stats.json").write_text(
        json.dumps(out_stats, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return out_stats


if __name__ == "__main__":
    counts = main()
    print("Dictionary improve")
    for key, value in counts.items():
        print(f"  {key}: {value}")
