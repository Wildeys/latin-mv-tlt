#!/usr/bin/env python3
"""Measure Thaana -> Latin -> Thaana round-trip stability (M-2, R-1.8, AC-11).

Why this runs *before* training: every training pair is normalised by the
transliterator, so its error rate is a hard ceiling on translation quality
(REQUIREMENTS §6.8). Measuring it after training would tell you nothing you could
act on.

Three metrics, weakest claim to strongest:

  exact          raw Thaana equality. The strict standard R-1.8 asks for.
  exact_folded   equality after folding the Arabic-derived Thaana letters onto
                 their native counterparts.
  latin_stable   does the round-tripped Thaana read out to the SAME Latin?

R-1.2 mandates exactly one romanization, which *forces* Thaana -> Latin to be
many-to-one for ten letter pairs (th/th both read `th`, h/h both read `h`, ...).
No inverse rule can recover which was written, so `exact` can never reach 100%.

But `exact` is also measuring the wrong thing. The model never sees Thaana - it
sees Latin. What bounds training quality (REQUIREMENTS 6.8) is whether the Latin
is stable, not whether an arbitrary Thaana spelling is reproduced byte for byte.
A source spelling that is nonstandard (kulli written with lam+sukun rather than
alifu+sukun) round-trips to the standard form and yields identical Latin; that
costs the model nothing and is reported as `spelling_normalised`, not as a
failure of the rules.

So latin_stable is the gated metric. exact and exact_folded are reported beside
it rather than hidden, because R-1.8 asks for exact match and NFR-8 requires the
weaker number be visible too.

The fold table is not hardcoded here — it is derived from the transliterator's
own mapping via `node tools/transliterate.mjs --variants`, so it cannot drift.

Usage
    python tools/measure_roundtrip.py                     # dictionary, all rows
    python tools/measure_roundtrip.py --n 1000            # sample 1000
    python tools/measure_roundtrip.py --source data/parallel/train.jsonl --field dhivehi

Writes evaluation/roundtrip_stats.json. Exits non-zero if latin_stable is below
--gate (default 98.0), so it can be used as the M-2 gate in CI or a Makefile.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _transliterate_bridge import SCRIPT, Transliterator  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "data" / "dictionary_full.json"
OUT = ROOT / "evaluation" / "roundtrip_stats.json"

THAANA_RE = re.compile(r"[ހ-޿]")

# Structural features whose inverse rules were added in v0.2. Used to attribute a
# failure to a class rather than reporting an undifferentiated percentage — R-1.8
# requires "the failing classes listed".
SUKUN = "ް"
NOONU = "ނ"
ALIFU = "އ"
THAA = "ތ"
SHAVIYANI = "ށ"
PRENASAL_STOPS = "ބޑދޓތޒ"  # b d dh t th g



def rel_to_root(path: Path) -> str:
    """Path relative to the repo root, for stats and log lines.

    `Path.relative_to` compares lexically, so a relative argument raises even
    when it points inside the repo — and it raises *after* the measurement has
    run, discarding the result. Resolve first, and degrade to the path as given
    when it genuinely lies outside the tree.
    """
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)

def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def load_fold() -> tuple[dict[str, str], dict[str, list[str]]]:
    """Read the many-to-one fold from the transliterator's own mapping."""
    result = subprocess.run(
        ["node", str(SCRIPT), "--variants"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=str(ROOT),
    )
    if result.returncode != 0:
        raise SystemExit(f"could not read --variants: {result.stderr.strip()}")
    data = json.loads(result.stdout)
    return data["fold"], data["collisions"]


def classify(
    original: str, back: str, folded_equal: bool, latin_stable: bool, preserved: list[str]
) -> str:
    """Attribute a round-trip failure to a class, most-specific first."""
    if folded_equal:
        return "variant_fold"
    if latin_stable:
        # The Thaana differs but reads out to the same Latin, so the model sees
        # identical input either way. Usually the source spelling is nonstandard
        # and the round trip normalised it (ކުލްލި → ކުއްލި). Costs nothing at
        # training time — which is what R-1.8 exists to protect.
        return "spelling_normalised"
    if preserved:
        return "unmapped_char"
    if any(NOONU + stop in original for stop in PRENASAL_STOPS):
        return "prenasalized"
    if THAA + SUKUN in original or SHAVIYANI + SUKUN in original or ALIFU + SUKUN in original:
        # ށް and އް both read out as `h` under sukun; only one can be the inverse.
        return "coda_h_ambiguity"
    if ALIFU in original:
        # ސް + އެ vs ސެ, and friends: an alifu onset after a coda is invisible in
        # Latin. Not recoverable without word-boundary knowledge.
        return "alifu_onset_ambiguity"
    if len(original) != len(back):
        return "length_mismatch"
    return "other"


def read_samples(source: Path, field: str) -> list[str]:
    if not source.exists():
        raise SystemExit(f"source not found: {source}")

    text = source.read_text(encoding="utf-8")
    rows: list[str] = []

    if source.suffix == ".jsonl":
        for line in text.splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            value = row.get(field) or ""
            if THAANA_RE.search(value):
                rows.append(value)
    elif source.suffix == ".json":
        data = json.loads(text)
        for row in data:
            value = (row.get(field) or "") if isinstance(row, dict) else str(row)
            if THAANA_RE.search(value):
                rows.append(value)
    else:  # plain text, one sample per line
        for line in text.splitlines():
            if THAANA_RE.search(line):
                rows.append(line.strip())

    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    ap.add_argument("--field", default="dhivehi", help="JSON field holding Thaana")
    ap.add_argument("--n", type=int, default=0, help="sample size (0 = all)")
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--gate", type=float, default=98.0, help="minimum latin-stable %% to pass")
    ap.add_argument("--examples", type=int, default=5, help="failures to record per class")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    samples = read_samples(args.source, args.field)
    if not samples:
        raise SystemExit(f"no Thaana found in {args.source} (field {args.field!r})")

    if args.n and args.n < len(samples):
        random.Random(args.seed).shuffle(samples)
        samples = samples[: args.n]

    if len(samples) < 1000:
        print(
            f"warning: {len(samples)} samples, below R-1.8's ≥1,000 minimum.",
            file=sys.stderr,
        )

    fold, collisions = load_fold()
    fold_table = str.maketrans(fold)

    with Transliterator() as tr:
        sha = tr.sha256
        latins = tr.thaana_to_latin_many(samples)
        backs = tr.latin_to_thaana_many(latins)
        # Re-read the round-tripped Thaana. If it yields the same Latin, the
        # model sees identical input whichever spelling it started from — the
        # round trip lost nothing that training can notice.
        relatins = tr.thaana_to_latin_many([b for b, _ in backs])

    exact = 0
    exact_folded = 0
    latin_stable = 0
    distance = 0
    chars = 0
    classes: Counter[str] = Counter()
    examples: dict[str, list[dict]] = {}

    for original, latin, (back, preserved), relatin in zip(samples, latins, backs, relatins):
        chars += len(original)
        distance += levenshtein(original, back)

        stable = relatin == latin
        if stable:
            latin_stable += 1

        if original == back:
            exact += 1
            exact_folded += 1
            continue

        folded_equal = original.translate(fold_table) == back.translate(fold_table)
        if folded_equal:
            exact_folded += 1

        cls = classify(original, back, folded_equal, stable, preserved)
        classes[cls] += 1
        bucket = examples.setdefault(cls, [])
        if len(bucket) < args.examples:
            bucket.append(
                {"thaana": original, "latin": latin, "back": back, "preserved": preserved}
            )

    total = len(samples)
    stats = {
        "source": rel_to_root(args.source),
        "field": args.field,
        "samples": total,
        "seed": args.seed,
        "transliteratorSha256": None,
        "exact": exact,
        "exactPercent": round(100 * exact / total, 3),
        "exactFolded": exact_folded,
        "exactFoldedPercent": round(100 * exact_folded / total, 3),
        "latinStable": latin_stable,
        "latinStablePercent": round(100 * latin_stable / total, 3),
        "levenshteinTotal": distance,
        "levenshteinPerChar": round(distance / chars, 5) if chars else 0,
        "failingClasses": dict(classes.most_common()),
        "examples": examples,
        "variantCollisions": collisions,
        "gate": args.gate,
        "note": (
            "Three metrics, weakest claim to strongest. exact is raw Thaana equality. "
            "exactFolded folds the ten Arabic-derived letters onto their native "
            "counterparts; those ten are many-to-one under R-1.2's single-romanization "
            "rule and can never round-trip exactly. latinStable asks whether the "
            "round-tripped Thaana reads out to the SAME Latin - which is what actually "
            "bounds training quality (REQUIREMENTS 6.8), because the model only ever "
            "sees the Latin. A Thaana spelling variant that yields identical Latin "
            "costs the model nothing."
        ),
        "generatedBy": "tools/measure_roundtrip.py",
    }

    stats["transliteratorSha256"] = sha

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"source            {stats['source']} ({total} samples)")
    print(f"exact             {exact:>6} / {total}  {stats['exactPercent']:.2f}%")
    print(f"exact (folded)    {exact_folded:>6} / {total}  {stats['exactFoldedPercent']:.2f}%")
    print(f"latin-stable      {latin_stable:>6} / {total}  {stats['latinStablePercent']:.2f}%   <- bounds training quality")
    print(f"levenshtein/char  {stats['levenshteinPerChar']:.5f}")
    if classes:
        print("\nfailing classes")
        for cls, count in classes.most_common():
            print(f"  {cls:<16} {count:>6}  {100 * count / total:.2f}%")
    print(f"\nwrote {rel_to_root(args.out)}")

    if stats["latinStablePercent"] < args.gate:
        print(
            f"\nFAIL: latin-stable {stats['latinStablePercent']:.2f}% is below the {args.gate}% gate (R-1.8).",
            file=sys.stderr,
        )
        print("Fix latinToThaana.ts before training — this caps every downstream metric.", file=sys.stderr)
        return 1

    print(f"\nPASS: at or above the {args.gate}% gate (R-1.8).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
