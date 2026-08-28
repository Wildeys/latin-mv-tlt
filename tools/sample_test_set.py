#!/usr/bin/env python3
"""Draw the scoring sample from the held-out test split (M-10, R-8.9, AC-9).

The full test split is 40,592 rows. Generating a prediction for every one of them
with the quantized ONNX model on this machine's CPU is a multi-hour run, and the
result would not be more trustworthy than a stratified sample - only slower. So
this script draws a sample that clears R-8.9's >=500-pairs-per-direction floor
with headroom, and records loudly that it is a sample.

    python tools/sample_test_set.py
    python tools/sample_test_set.py --pairs-per-group 500

Writes evaluation/test_sample.jsonl in the same schema as data/parallel/test.jsonl,
so `tools/evaluate.py --test evaluation/test_sample.jsonl` works unchanged, plus
evaluation/test_sample_stats.json describing exactly what was drawn.

Three decisions that are not arbitrary:

  - sample *pairs*, not rows. The split stores every pair twice, once per
    direction with input and target swapped. Sampling rows independently would
    score dv-en on different sentences than en-dv, and the direction gap - the
    thing the sample exists to measure - would be confounded with content.
  - keep the two holdout kinds apart. The nine news domains are held out whole,
    so their score measures generalisation to unseen subject matter.
    `conversational` is held out by row from a register the model trains on, so
    its score is in-domain and reads higher. corpus_stats.json says so; averaging
    them would describe neither.
  - give the small domains a floor. Proportional allocation alone would draw one
    sentence from `law` and two from `society`. A floor of 20 costs the large
    domains almost nothing and keeps the sample from silently becoming a
    health-and-entertainment benchmark.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEST = ROOT / "data" / "parallel" / "test.jsonl"
OUT = ROOT / "evaluation" / "test_sample.jsonl"
OUT_STATS = ROOT / "evaluation" / "test_sample_stats.json"

SEED = 11  # the project's seed everywhere: corpus split, roundtrip, spellability
MIN_PER_DOMAIN = 20
IN_DOMAIN_GROUP = "conversational"


def load_prefixes() -> dict[str, str]:
    """The task prefixes, from the file the corpus builder wrote (R-2.5).

    Restating the literals here would put a second definition in the repo, and
    two characters of drift is exactly the failure R-2.5 exists to prevent.
    """
    stats = json.loads((ROOT / "data" / "parallel" / "corpus_stats.json").read_text("utf-8"))
    prefixes = stats.get("prefixes") or {}
    if set(prefixes) != {"dv-en", "en-dv"}:
        raise SystemExit("corpus_stats.json does not carry both task prefixes")
    return prefixes


def load_pairs(path: Path, prefixes: dict[str, str]) -> tuple[dict, Counter]:
    """Rejoin the two directional rows of each underlying pair."""
    pairs: dict[tuple[str, str], dict] = {}
    seen_inputs: Counter = Counter()

    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        seen_inputs[row["input"]] += 1
        provenance = row.get("provenance") or {}
        domain = provenance.get("domain", "")

        prefix = prefixes[row["direction"]]
        if not row["input"].startswith(prefix):
            raise SystemExit(
                f"row is not prefixed with {prefix!r}: {row['input'][:60]!r}\n"
                "The split was built with a different prefix than corpus_stats.json records."
            )
        content = row["input"][len(prefix):]

        # The dv-en row carries (latin -> english); the en-dv row carries the
        # reverse. Keying on the *unprefixed* content is what lets the two halves
        # find each other - the prefixes differ, so the raw inputs never match.
        if row["direction"] == "dv-en":
            key = (content, row["target"])
        else:
            key = (row["target"], content)
        entry = pairs.setdefault(key, {"domain": domain, "rows": {}})
        entry["rows"][row["direction"]] = row

    return pairs, seen_inputs


def allocate(counts: dict[str, int], total: int, floor: int) -> dict[str, int]:
    """Proportional allocation with a floor, settled by largest remainder."""
    domains = sorted(counts)
    floors = {d: min(floor, counts[d]) for d in domains}
    remaining = total - sum(floors.values())
    if remaining <= 0:
        # Asked for fewer than the floors need; fall back to pure proportional.
        floors = {d: 0 for d in domains}
        remaining = total

    headroom = {d: counts[d] - floors[d] for d in domains}
    pool = sum(headroom.values())
    exact = {d: (remaining * headroom[d] / pool if pool else 0) for d in domains}
    alloc = {d: floors[d] + int(exact[d]) for d in domains}

    short = total - sum(alloc.values())
    order = sorted(domains, key=lambda d: (-(exact[d] - int(exact[d])), d))
    i = 0
    while short > 0 and i < len(order) * 4:
        d = order[i % len(order)]
        if alloc[d] < counts[d]:
            alloc[d] += 1
            short -= 1
        i += 1
    return alloc


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--test", type=Path, default=TEST)
    ap.add_argument("--pairs-per-group", type=int, default=500,
                    help="pairs drawn per holdout group; each becomes 2 rows "
                         "(one per direction), so this is the per-direction count")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    if not args.test.exists():
        raise SystemExit(
            f"not found: {args.test}\n"
            "data/parallel/ is gitignored. Rebuild it with tools/build_translation_pairs.py."
        )

    prefixes = load_prefixes()
    pairs, seen_inputs = load_pairs(args.test, prefixes)

    # evaluate.py keys predictions by the source string. Two rows with the same
    # input and different references would silently share one prediction and one
    # of the two references would be scored against the wrong hypothesis.
    duplicated = {text for text, n in seen_inputs.items() if n > 1}

    complete: dict[str, list] = defaultdict(list)
    dropped_incomplete = dropped_duplicate = 0
    for key, entry in pairs.items():
        rows = entry["rows"]
        if len(rows) != 2:
            dropped_incomplete += 1
            continue
        if any(r["input"] in duplicated for r in rows.values()):
            dropped_duplicate += 1
            continue
        group = IN_DOMAIN_GROUP if entry["domain"] == IN_DOMAIN_GROUP else "heldout"
        complete[group].append((entry["domain"], rows))

    rng = random.Random(SEED)
    selected: list[dict] = []
    stats_groups: dict[str, dict] = {}

    for group in ("heldout", IN_DOMAIN_GROUP):
        available = complete.get(group, [])
        by_domain: dict[str, list] = defaultdict(list)
        for domain, rows in available:
            by_domain[domain].append(rows)
        for domain in by_domain:
            by_domain[domain].sort(key=lambda r: r["dv-en"]["input"])

        counts = {d: len(v) for d, v in by_domain.items()}
        want = min(args.pairs_per_group, sum(counts.values()))
        alloc = allocate(counts, want, MIN_PER_DOMAIN)

        drawn: dict[str, int] = {}
        for domain in sorted(alloc):
            take = min(alloc[domain], counts[domain])
            for rows in rng.sample(by_domain[domain], take):
                for direction in ("dv-en", "en-dv"):
                    selected.append({**rows[direction], "sampleGroup": group})
            drawn[domain] = take

        stats_groups[group] = {
            "pairsAvailable": sum(counts.values()),
            "pairsDrawn": sum(drawn.values()),
            "rowsWritten": sum(drawn.values()) * 2,
            "perDirection": sum(drawn.values()),
            "byDomain": {d: n for d, n in sorted(drawn.items()) if n},
            "holdout": "whole domains excluded from train (R-2.6 / R-8.8)"
            if group == "heldout"
            else "row-level holdout from a register the model trains on; in-domain, "
                 "not comparable to the held-out domains",
        }

    selected.sort(key=lambda r: (r["sampleGroup"], r["direction"], r["input"]))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as handle:
        for row in selected:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    total_pairs = sum(g["pairsDrawn"] for g in stats_groups.values())
    stats = {
        "generatedBy": "tools/sample_test_set.py",
        "source": str(args.test.relative_to(ROOT)),
        "sourceSha256": hashlib.sha256(args.test.read_bytes()).hexdigest(),
        "sourceRows": sum(seen_inputs.values()),
        "seed": SEED,
        "pairedDirections": True,
        "minPerDomain": MIN_PER_DOMAIN,
        "rowsWritten": len(selected),
        "pairsDrawn": total_pairs,
        "groups": stats_groups,
        "excluded": {
            "incompletePairs": dropped_incomplete,
            "duplicateInputs": dropped_duplicate,
            "why": "evaluate.py keys predictions by source string, so a repeated "
                   "input would reuse one prediction against two references",
        },
        "sampleNote": (
            f"a {len(selected):,}-row stratified sample of the {sum(seen_inputs.values()):,}-row "
            "test split, not the full split; both directions are drawn from the same "
            "underlying pairs so the per-direction scores are directly comparable"
        ),
    }
    OUT_STATS.write_text(json.dumps(stats, indent=2) + "\n", encoding="utf-8")

    print(f"wrote {args.out.relative_to(ROOT)}  ({len(selected)} rows, {total_pairs} pairs)")
    for group, info in stats_groups.items():
        print(f"  {group:16s} {info['perDirection']:5d} per direction   {info['byDomain']}")
    print(f"wrote {OUT_STATS.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
