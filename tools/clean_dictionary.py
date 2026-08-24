"""Repair the browser lexicon and ship a Latin-only dictionary.

Runs after tools/improve_dictionary.py. Three failure modes are handled, all of
them inherited from the original SQLite export rather than introduced by the
Database_sources merge:

  A. Inverted      English sits in `latin`, Dhivehi Latin sits in `english`,
                   and `dhivehi` holds a Thaana back-transliteration of the
                   English. Repaired by flipping.
  B. Corrupt       `latin` is a wrong English word while `dhivehi`/`english`
                   are right. Cannot be resolved automatically. Quarantined.
  C. Malformed key `latin` is correctly oriented but still carries glossary
                   formatting -- "firi (firimeehaa)", "gon'di/ isheenna than"
                   -- so no tokenizer will ever match it. Split into keys.

Writes:
  public/data/dictionary.json        Latin + English only (no `dhivehi`)
  data/quarantine.json               mode B rows, for manual review
  public/data/dictionary_stats.json  measured counters
  data/dictionary_full.json          build-side copy that keeps `dhivehi`
  tools/cleanup_report.json          every edit, so the numbers are checkable
  tools/inversion_candidates.json    mode A suspects the orthography test
                                     cannot prove; reported, never auto-applied

No Latin key disappears without a recorded rewrite. The script refuses to write
if that invariant is broken.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "data"
CURRENT = OUT_DIR / "dictionary.json"
SHIPPED = OUT_DIR / "dictionary.json"
# Build-side only: this is a review artefact, not something the browser
# should download with the lexicon.
QUARANTINE = ROOT / "data" / "quarantine.json"
STATS = OUT_DIR / "dictionary_stats.json"
FULL = ROOT / "data" / "dictionary_full.json"
REPORT = ROOT / "tools" / "cleanup_report.json"
CANDIDATES = ROOT / "tools" / "inversion_candidates.json"

# Male Latin does not use w or x, and uses c only in the digraph ch. It does
# use q, for the Arabic-derived letter: naquluvun, baithulmaqdhis. Including q
# here would flag those as English.
NON_DHIVEHI = re.compile(r"[wx]|c(?!h)", re.IGNORECASE)

# A key a tokenizer can actually produce: lowercase letters, apostrophe for
# prenasalisation, spaces for genuine multi-word entries.
VALID_KEY = re.compile(r"^[a-z][a-z' ]*$")

ENGLISH_STOPWORDS = {
    "a", "an", "the", "of", "to", "in", "on", "at", "for", "and", "or", "with",
    "is", "are", "was", "were", "be", "been", "by", "from", "that", "this",
    "kind", "sort", "type", "used", "someone", "something", "person", "place",
}

# The lexicon carries 26 function words against 10,913 nouns, and tags `aharen`
# and `kaley` as nouns. The frame extractor cannot lean on POS without these.
POS_OVERRIDES = {
    "aharen": "pronoun", "aharemen": "pronoun", "aharenge": "pronoun",
    "kaley": "pronoun", "thibaa": "pronoun", "eyna": "pronoun",
    "emeehun": "pronoun", "thimaa": "pronoun", "thimange": "pronoun",
    "mi": "pronoun", "e": "pronoun", "ey": "pronoun", "thi": "pronoun",
    "thiya": "pronoun", "kon": "pronoun",
    "nu": "particle", "nuun": "particle", "neth": "particle",
    "noonee": "particle", "eve": "particle", "ves": "particle",
    "namaves": "conjunction", "iru": "particle", "maa": "particle",
    "gai": "particle", "ah": "particle", "ge": "particle",
    "male": "proper", "maale": "proper", "raajje": "proper",
    "addu": "proper", "hulhumale": "proper",
}

# Glosses the merge glued onto the wrong headword.
GLOSS_FIXES = {
    "male": ["Male"],
    "maale": ["Male"],
    "hulhumale": ["Hulhumale"],
}

# frequency is two placeholder constants for 96% of rows, not a corpus count.
PLACEHOLDER_FREQS = {1, 50}


def normalise_key(text: str) -> str:
    text = text.replace("’", "'").strip().lower()
    return re.sub(r"\s+", " ", text)


def is_dhivehi_latin(text: str) -> bool:
    key = normalise_key(text)
    return bool(key) and not NON_DHIVEHI.search(key)


def alpha_tokens(text: str) -> list[str]:
    return [t for t in re.split(r"[^a-z']+", normalise_key(text)) if len(t) > 1]


def split_keys(latin: str) -> list[str]:
    """Turn one glossary-formatted headword into the keys it actually contains.

    "firi (firimeehaa)"        -> ["firi", "firimeehaa"]
    "gon'di/ isheenna than"    -> ["gon'di", "isheenna than"]
    """
    text = latin.replace("’", "'")
    parts: list[str] = []
    for chunk in re.split(r"[/;]", text):
        # A parenthetical is an alternate form, not a comment: keep both sides.
        inner = re.findall(r"\(([^)]*)\)?", chunk)
        outer = re.sub(r"\([^)]*\)?", " ", chunk)
        for piece in [outer, *inner]:
            key = normalise_key(re.sub(r"[^A-Za-z' ]+", " ", piece))
            if key and VALID_KEY.match(key) and len(key) >= 2:
                parts.append(key)
    seen: list[str] = []
    for key in parts:
        if key not in seen:
            seen.append(key)
    return seen


def build_english_wordlist(rows: list[dict]) -> set[str]:
    """English vocabulary drawn from rows the orthography test trusts."""
    words: Counter[str] = Counter()
    for row in rows:
        if not is_dhivehi_latin(row["latin"]):
            continue
        for gloss in row.get("english") or []:
            for token in alpha_tokens(gloss):
                words[token] += 1
    return {word for word, count in words.items() if count >= 2} | ENGLISH_STOPWORDS


def english_score(text: str, wordlist: set[str]) -> float:
    tokens = alpha_tokens(text)
    if not tokens:
        return 0.0
    return sum(1 for t in tokens if t in wordlist) / len(tokens)


def classify(row: dict) -> str:
    """A / B / C / clean. Orthography only -- high precision, reported counts."""
    latin = row["latin"]
    english = row.get("english") or []
    if not is_dhivehi_latin(latin):
        if english and all(is_dhivehi_latin(value) for value in english):
            return "inverted"
        return "corrupt"
    if not VALID_KEY.match(normalise_key(latin)):
        return "malformed"
    return "clean"


def expand_glosses(values: list[str]) -> list[str]:
    """Add the searchable forms hiding inside a glossary-style gloss.

    "lovely/ cute"   -> also "lovely", "cute"
    "spring (water)" -> also "spring"

    Without this the reverse index only ever matches the full compound string,
    so an English lookup of "cute" misses a row that glosses exactly that.
    """
    out: list[str] = []
    seen: set[str] = set()

    def keep(value: str) -> None:
        value = re.sub(r"\s+", " ", value).strip(" -,;")
        if not value or value.lower() in seen:
            return
        seen.add(value.lower())
        out.append(value)

    for value in values:
        keep(value)
        pieces = [value]
        if "/" in value:
            pieces = value.split("/")
        for piece in pieces:
            keep(piece)
            if "(" in piece:
                keep(re.sub(r"\([^)]*\)?", " ", piece))
    return out


def merge_into(target: dict, english: list[str]) -> bool:
    seen = {value.lower() for value in target["english"]}
    added = False
    for value in english:
        if value.lower() not in seen:
            target["english"].append(value)
            seen.add(value.lower())
            added = True
    return added


def main() -> None:
    rows = json.loads(CURRENT.read_text(encoding="utf-8"))
    before_keys = {normalise_key(r["latin"]) for r in rows}
    wordlist = build_english_wordlist(rows)

    report: dict = {
        "inputRows": len(rows),
        "flips": [],
        "quarantined": [],
        "splits": [],
        "posFixed": [],
        "glossFixed": [],
    }

    by_key: dict[str, dict] = {}
    order: list[str] = []
    quarantine: list[dict] = []
    rewrites: dict[str, list[str]] = {}

    def add(key: str, english: list[str], pos: str, frequency: int, thaana: str) -> None:
        if key in by_key:
            merge_into(by_key[key], english)
            by_key[key]["frequency"] = max(by_key[key]["frequency"], frequency)
            if not by_key[key]["dhivehi"] and thaana:
                by_key[key]["dhivehi"] = thaana
            return
        by_key[key] = {
            "dhivehi": thaana,
            "latin": key,
            "english": list(english),
            "pos": pos,
            "frequency": frequency,
        }
        order.append(key)

    for row in rows:
        original = normalise_key(row["latin"])
        english = [value for value in (row.get("english") or []) if value.strip()]
        pos = row.get("pos") or "unknown"
        frequency = int(row.get("frequency") or 0)
        thaana = row.get("dhivehi") or ""
        kind = classify(row)

        if kind == "inverted":
            # english[] holds the Dhivehi Latin; latin holds the English gloss.
            # The Thaana is a back-transliteration of the English -- drop it.
            gloss = row["latin"].strip()
            report["flips"].append({"was": row["latin"], "nowKeys": english, "gloss": gloss})
            targets = []
            for value in english:
                targets.extend(split_keys(value) or [normalise_key(value)])
            for key in targets:
                add(key, [gloss], pos, frequency, "")
            rewrites[original] = targets
            continue

        if kind == "corrupt":
            quarantine.append(row)
            report["quarantined"].append(row["latin"])
            rewrites[original] = []
            continue

        if kind == "malformed":
            keys = split_keys(row["latin"])
            if not keys:
                quarantine.append(row)
                report["quarantined"].append(row["latin"])
                rewrites[original] = []
                continue
            report["splits"].append({"was": row["latin"], "into": keys})
            for key in keys:
                add(key, english, pos, frequency, thaana)
            rewrites[original] = keys
            continue

        add(original, english, pos, frequency, thaana)

    # Mirror pairs. If row X reads `latin: "i", english: ["aharen"]` and the
    # lexicon also holds `latin: "aharen", english: ["I", "me"]`, one of the
    # two is backwards. Which one is decided by `frequency`: those counts come
    # from a Dhivehi corpus, so the real Dhivehi headword carries the larger
    # number (aharen 800 vs i 6; mas 400 vs fish 6; foiy 300 vs book 1).
    #
    # The loser keeps its key -- nothing becomes unreachable -- but takes the
    # winner's English glosses, which turns a backwards row into a correct one.
    # Equal frequencies cannot be decided this way (firihen 300 vs male 300 is
    # a genuine ambiguity), so those are reported for review instead.
    mirror_fixed = []
    mirror_ties = []
    for key in list(order):
        entry = by_key.get(key)
        if entry is None or not entry["english"]:
            continue
        for value in entry["english"]:
            target = by_key.get(normalise_key(value))
            if target is None or target is entry:
                continue
            if not any(normalise_key(g) == key for g in target["english"]):
                continue
            if entry["frequency"] == target["frequency"]:
                pair = sorted([entry["latin"], target["latin"]])
                if pair not in mirror_ties:
                    mirror_ties.append(pair)
                break
            loser, winner = (
                (entry, target) if entry["frequency"] < target["frequency"] else (target, entry)
            )
            # Only repair the unambiguous stub shape, where the loser's whole
            # gloss list is nothing but the winner's headword:
            #     book: ["foiy"]   against   foiy: ["book"]
            # A loser carrying real content of its own is a different problem
            # -- `filmu: ["film", "movie", "develop"]` against `film:
            # ["filmu"]` is a loanword collision, not a stub -- so it goes to
            # the review list rather than being overwritten.
            if not all(normalise_key(g) == winner["latin"] for g in loser["english"]):
                pair = sorted([entry["latin"], target["latin"]])
                if pair not in mirror_ties:
                    mirror_ties.append(pair)
                break
            mirror_fixed.append(
                {"latin": loser["latin"], "was": list(loser["english"]), "now": list(winner["english"])}
            )
            loser["english"] = list(winner["english"])
            break
    report["mirrorGlossFixed"] = mirror_fixed
    report["mirrorTies"] = mirror_ties

    # POS and gloss repairs, applied after the merge so a split row gets them too.
    for key, pos in POS_OVERRIDES.items():
        entry = by_key.get(key)
        if entry and entry["pos"] != pos:
            report["posFixed"].append({"latin": key, "was": entry["pos"], "now": pos})
            entry["pos"] = pos
    for key, english in GLOSS_FIXES.items():
        entry = by_key.get(key)
        if entry and entry["english"] != english:
            report["glossFixed"].append({"latin": key, "was": entry["english"], "now": english})
            entry["english"] = list(english)

    # Every pre-existing key must still resolve, directly or through a rewrite.
    # Rewrites chain: a malformed key can split into keys that the mirror rule
    # then merges away. Follow the chain rather than checking one hop.
    def resolves(key: str, seen: set[str] | None = None) -> bool:
        seen = seen or set()
        if key in by_key:
            return True
        if key in seen:
            return False
        seen.add(key)
        replacement = rewrites.get(key)
        if replacement is None:
            return False
        if not replacement:
            return True  # deliberately quarantined
        return any(resolves(target, seen) for target in replacement)

    lost = [key for key in before_keys if not resolves(key)]
    if lost:
        raise SystemExit(
            f"refusing to write: {len(lost)} Latin keys would vanish with no recorded rewrite, "
            f"e.g. {lost[:5]}"
        )

    entries = [by_key[key] for key in order]
    for entry in entries:
        entry["english"] = expand_glosses(entry["english"])
    # Only tag the rows whose frequency is a real count. Tagging all 15k as
    # "placeholder" would cost ~380 KB on a file that blocks first paint, so
    # absence of the field means placeholder -- recorded in Context/DATA.md.
    for entry in entries:
        if entry["frequency"] not in PLACEHOLDER_FREQS:
            entry["freqSource"] = "spelling.md"

    # Report-only: rows the orthography test cannot prove are inverted. These
    # need a human, so they are never applied automatically.
    candidates = []
    for entry in entries:
        if english_score(entry["latin"], wordlist) < 0.7:
            continue
        if len(alpha_tokens(entry["latin"])) < 2:
            continue
        if any(english_score(value, wordlist) > 0.0 for value in entry["english"]):
            continue
        candidates.append({"latin": entry["latin"], "english": entry["english"]})

    shipped = []
    for e in entries:
        row = {
            "latin": e["latin"],
            "english": e["english"],
            "pos": e["pos"],
            "frequency": e["frequency"],
        }
        if "freqSource" in e:
            row["freqSource"] = e["freqSource"]
        shipped.append(row)

    stats = {
        "rawDbRows": len(rows),
        "uniqueLatin": len(shipped),
        "entriesWithEnglish": sum(1 for e in shipped if e["english"]),
        "finalExportedEntries": len(shipped),
        "invertedFlipped": len(report["flips"]),
        "mirrorGlossFixed": len(report["mirrorGlossFixed"]),
        "mirrorTies": len(report["mirrorTies"]),
        "quarantined": len(quarantine),
        "keysSplit": len(report["splits"]),
        "keysRecovered": len(set(by_key) - before_keys),
        "posFixed": len(report["posFixed"]),
        "source": "tools/clean_dictionary.py",
    }

    FULL.parent.mkdir(parents=True, exist_ok=True)
    FULL.write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")
    SHIPPED.write_text(json.dumps(shipped, ensure_ascii=False), encoding="utf-8")
    QUARANTINE.write_text(json.dumps(quarantine, ensure_ascii=False, indent=2), encoding="utf-8")
    STATS.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    CANDIDATES.write_text(json.dumps(candidates, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"input rows              {stats['rawDbRows']}")
    print(f"shipped entries         {stats['finalExportedEntries']}")
    print(f"inverted rows flipped   {stats['invertedFlipped']}")
    print(f"mirror glosses repaired {stats['mirrorGlossFixed']}")
    print(f"mirror ties (review)    {stats['mirrorTies']}")
    print(f"rows quarantined        {stats['quarantined']}")
    print(f"malformed keys split    {stats['keysSplit']}")
    print(f"new lookup keys         {stats['keysRecovered']}")
    print(f"POS corrected           {stats['posFixed']}")
    print(f"review candidates       {len(candidates)}  -> tools/inversion_candidates.json")
    print(f"shipped bytes           {SHIPPED.stat().st_size}")
    print(f"full copy bytes         {FULL.stat().st_size}")


if __name__ == "__main__":
    main()
