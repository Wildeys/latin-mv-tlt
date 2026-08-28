#!/usr/bin/env python3
"""Recover aligned (Thaana, Malé Latin, English) sentence triples.

The tokenizer comparison needs the *same sentence* in all three scripts —
otherwise a difference in token counts could be a difference in sentence length
rather than a difference in script. No file in the repo holds all three: the
training corpus strips Thaana at build time (that is the point of the design),
and roundtrip_sample.jsonl keeps Thaana but not English.

So the third column is recovered by joining. roundtrip_sample.jsonl carries
{dv, latin}; the dv-en rows of the corpus splits carry {latin, english}; `latin`
is the join key, and it is exact because both sides were produced by the same
transliterator run.

    python tools/build_script_triples.py
    python tools/build_script_triples.py --with-train --n 1000

Writes evaluation/script_triples.json. The result is committed because
data/parallel/ is gitignored: without it the comparison could not be re-run from
a fresh clone, and a figure whose inputs cannot be regenerated is an assertion,
not a measurement.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARALLEL = ROOT / "data" / "parallel"
SAMPLE = PARALLEL / "roundtrip_sample.jsonl"
OUT = ROOT / "evaluation" / "script_triples.json"

SEED = 11

# A hand-checked triple, kept verbatim so the headline claim of the tokenization
# figures is anchored to a sentence a reader can retype and verify. Under
# t5-small this Thaana string encodes to four ids, two of which are <unk>.
SHOWCASE = {
    "thaana": "ދިވެހިރާއްޖޭގެ ރައީސުލްޖުމްހޫރިއްޔާ",
    "latin": "dhivehiraahjeyge raeesuljumhooriyyaa",
    "english": "the President of the Maldives",
    "note": "hand-checked; not drawn from the corpus",
}


def load_prefixes() -> dict[str, str]:
    stats = json.loads((PARALLEL / "corpus_stats.json").read_text("utf-8"))
    return stats["prefixes"]


def latin_to_english(paths: list[Path], prefix: str) -> dict[str, str]:
    """Index the dv-en rows: unprefixed Latin input -> English target."""
    index: dict[str, str] = {}
    for path in paths:
        if not path.exists():
            continue
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                row = json.loads(line)
                if row.get("direction") != "dv-en":
                    continue
                index[row["input"][len(prefix):]] = row["target"]
    return index


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--n", type=int, default=400, help="triples to keep")
    ap.add_argument("--with-train", action="store_true",
                    help="also scan the 198 MB train split for a larger match pool (~60 s)")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    if not SAMPLE.exists():
        raise SystemExit(
            f"not found: {SAMPLE}\n"
            "data/parallel/ is gitignored; rebuild it with tools/build_translation_pairs.py, "
            "or keep the committed evaluation/script_triples.json."
        )

    prefixes = load_prefixes()
    sources = [PARALLEL / "valid.jsonl", PARALLEL / "test.jsonl"]
    if args.with_train:
        sources.append(PARALLEL / "train.jsonl")

    english = latin_to_english(sources, prefixes["dv-en"])

    matched, domains = [], Counter()
    for line in SAMPLE.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        target = english.get(row["latin"])
        if target is None:
            continue
        matched.append(
            {
                "thaana": row["dv"],
                "latin": row["latin"],
                "english": target,
                "domain": row.get("domain", ""),
            }
        )
        domains[row.get("domain", "")] += 1

    if not matched:
        raise SystemExit("no triples matched — was roundtrip_sample.jsonl built from this corpus?")

    matched.sort(key=lambda t: t["latin"])
    keep = matched if len(matched) <= args.n else random.Random(SEED).sample(matched, args.n)
    keep.sort(key=lambda t: t["latin"])

    report = {
        "generatedBy": "tools/build_script_triples.py",
        "sources": [str(p.relative_to(ROOT)) for p in [SAMPLE, *sources] if p.exists()],
        "sourceSha256": hashlib.sha256(SAMPLE.read_bytes()).hexdigest(),
        "joinKey": "latin",
        "sampleRows": sum(1 for l in SAMPLE.read_text(encoding="utf-8").splitlines() if l.strip()),
        "matchedBeforeSampling": len(matched),
        "kept": len(keep),
        "seed": SEED,
        "domains": dict(sorted(Counter(t["domain"] for t in keep).items())),
        "domainsBeforeSampling": dict(sorted(domains.items())),
        "showcase": SHOWCASE,
        "triples": keep,
        "note": "the same sentence in three scripts, so a token-count difference between "
                "columns is a property of the script and not of the sentence. Thaana comes "
                "from the source corpus; Latin is the transliterator's output for that "
                "Thaana; English is the corpus's own reference translation.",
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {args.out.relative_to(ROOT)}")
    print(f"  matched {len(matched)} of {report['sampleRows']} sample rows, kept {len(keep)}")
    print(f"  domains {report['domains']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
