#!/usr/bin/env python3
"""Score the model with BLEU and chrF++ (M-10, R-8.4, R-8.6, R-8.8, AC-9).

Replaces the v0.1 stub, which measured nothing — it printed rule-extracted frames
and a line saying "BLEU/chrF: not measured". It also imported from
build_frame_pairs.py, so it would have broken the moment M-8a deleted that file.

    # generate outputs first (needs the exported model)
    node tools/smoke_translate.mjs ... > /dev/null     # sanity
    python tools/evaluate.py --predictions preds.jsonl

    # or score a held-out corpus split directly
    python tools/evaluate.py --test data/parallel/test.jsonl --predictions preds.jsonl

Writes evaluation/scores.json.

Three things this refuses to do quietly:

  - report a single mixed score. Both directions come from one set of weights,
    and a mixed average can look fine while one direction has collapsed.
  - score a test set that is too small. R-8.9 requires ≥500 pairs per direction;
    below that, BLEU differences are not meaningful and the file says so.
  - call chrF "chrF++". R-8.4 requires chrF++ specifically, which is
    sacrebleu.CHRF(word_order=2).
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GOLD = ROOT / "evaluation" / "gold_sentences.json"
OUT = ROOT / "evaluation" / "scores.json"

# R-8.9's floor. Below this, a BLEU difference between two runs is noise.
MIN_PAIRS_PER_DIRECTION = 500

# Malé Latin has no w or x, and uses c only in the digraph ch (Context/DATA.md).
# A generated Latin word containing them is not spellable in Dhivehi regardless
# of what BLEU says about the sentence (R-8.6).
UNSPELLABLE = re.compile(r"[wx]|c(?!h)")


def load_pairs(path: Path, args_block: str = "test") -> list[dict]:
    """Accept either the gold-set JSON or a corpus JSONL split."""
    if not path.exists():
        raise SystemExit(f"not found: {path}")

    if path.suffix == ".jsonl":
        rows = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                rows.append(
                    {
                        "direction": row.get("direction", "unknown"),
                        "source": row["input"],
                        "reference": row["target"],
                    }
                )
        return rows

    data = json.loads(path.read_text(encoding="utf-8"))

    # gold_sentences.json splits `smoke` (the v0.1 slot-vocabulary set, a wiring
    # check only) from `test` (the R-8.9 held-out set). Default to `test`; fall
    # back to `smoke` only if asked, and the caller is told which it got.
    block = data.get(args_block) or {}
    if not block.get("dv_en") and not block.get("en_dv"):
        raise SystemExit(
            f"{path.name}: block '{args_block}' is empty.\n"
            "The held-out test set required by R-8.9 (>=500 pairs per direction from an "
            "excluded domain) has not been built yet - see GAP-9. Pass --block smoke to "
            "run a wiring check, but do not publish those numbers."
        )

    rows = []
    for direction, key in (("dv-en", "dv_en"), ("en-dv", "en_dv")):
        for item in block.get(key, []):
            rows.append(
                {"direction": direction, "source": item["source"], "reference": item["reference"]}
            )
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--test", type=Path, default=GOLD, help="gold JSON or corpus JSONL")
    ap.add_argument("--predictions", type=Path, required=True,
                    help='JSONL of {"source", "prediction"} aligned to --test')
    ap.add_argument("--block", default="test", choices=["test", "smoke"],
                    help="gold_sentences.json block. `smoke` is a wiring check, not a result (R-8.3)")
    ap.add_argument("--spot-check", type=int, default=50, help="R-8.6 spellability sample")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    try:
        import sacrebleu
    except ImportError:
        raise SystemExit("sacrebleu is not installed. pip install -r tools/requirements.txt")

    pairs = load_pairs(args.test, args.block)
    if args.block == "smoke":
        print(
            "NOTE: scoring the `smoke` block. It shares the v0.1 slot vocabulary with the "
            "old training data, so it is not held out and these numbers are not results.",
            file=sys.stderr,
        )
    preds = {}
    for line in args.predictions.read_text(encoding="utf-8").splitlines():
        if line.strip():
            row = json.loads(line)
            preds[row["source"]] = row["prediction"]

    missing = [p for p in pairs if p["source"] not in preds]
    if missing:
        raise SystemExit(
            f"{len(missing)} of {len(pairs)} test items have no prediction. "
            "Scoring a partial set would overstate the result."
        )

    bleu = sacrebleu.BLEU()
    # R-8.4: chrF++ is word_order=2. Bare CHRF() is a different metric.
    chrf = sacrebleu.CHRF(word_order=2)

    scores: dict[str, dict] = {}
    for direction in ("dv-en", "en-dv"):
        subset = [p for p in pairs if p["direction"] == direction]
        if not subset:
            continue
        hyps = [preds[p["source"]] for p in subset]
        refs = [p["reference"] for p in subset]
        scores[direction] = {
            "pairs": len(subset),
            "bleu": round(bleu.corpus_score(hyps, [refs]).score, 4),
            "chrf++": round(chrf.corpus_score(hyps, [refs]).score, 4),
            "meetsSizeFloor": len(subset) >= MIN_PAIRS_PER_DIRECTION,
        }

    # R-8.6: spellability. A model can score a respectable BLEU while emitting
    # Latin that no Dhivehi speaker could write back to Thaana.
    dv_out = [preds[p["source"]] for p in pairs if p["direction"] == "en-dv"]
    sample = random.Random(11).sample(dv_out, min(args.spot_check, len(dv_out))) if dv_out else []
    flagged = [
        {"output": text, "tokens": sorted(set(re.findall(r"\S*(?:[wx]|c(?!h))\S*", text.lower())))}
        for text in sample
        if UNSPELLABLE.search(text.lower())
    ]

    undersized = [d for d, s in scores.items() if not s["meetsSizeFloor"]]

    report = {
        "generatedBy": "tools/evaluate.py",
        "testSet": f"{args.test.relative_to(ROOT)}#{args.block}",
        "isHeldOut": args.block == "test",
        "predictions": str(args.predictions),
        "metrics": {"bleu": "sacrebleu BLEU", "chrf++": "sacrebleu CHRF(word_order=2)"},
        "scores": scores,
        "spellability": {
            "sampled": len(sample),
            "flagged": len(flagged),
            "examples": flagged[:10],
            "rule": "Male Latin has no w or x, and uses c only in the digraph ch",
        },
        "sizeFloor": MIN_PAIRS_PER_DIRECTION,
        "directionsBelowSizeFloor": undersized,
        "reportable": not undersized,
        "note": (
            "Scored per direction, never as one mixed average: both directions come "
            "from one set of weights and a mixed number can hide one that has "
            "collapsed. If directionsBelowSizeFloor is non-empty these scores are "
            "indicative only and must not be published as results (R-8.9, NFR-8)."
        ),
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    for direction, s in scores.items():
        flag = "" if s["meetsSizeFloor"] else f"  <- only {s['pairs']} pairs"
        print(f"{direction}   BLEU {s['bleu']:>7.2f}   chrF++ {s['chrf++']:>7.2f}{flag}")
    print(f"\nspellability  {len(flagged)} of {len(sample)} sampled outputs flagged")
    print(f"wrote {args.out.relative_to(ROOT)}")

    if undersized:
        print(
            f"\nNOT REPORTABLE: {', '.join(undersized)} below {MIN_PAIRS_PER_DIRECTION} pairs "
            "(R-8.9). Extend the gold set before publishing these numbers.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
