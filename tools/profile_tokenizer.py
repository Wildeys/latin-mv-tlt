#!/usr/bin/env python3
"""Profile the tokenizer on Dhivehi Latin before training (M-2b, R-9.6, AC-12).

T5 uses SentencePiece trained on English-dominated text. Dhivehi Latin is ASCII,
so it *should* subword cleanly rather than falling back to `<unk>` — but "should"
is the reason to check rather than the reason not to. A high `<unk>` rate would
cap quality no matter how good the corpus is, and it is far cheaper to discover
that here than after a training run.

The secondary number matters too: mean subwords per word. Long agglutinated forms
like `bihloorigandu` fragmenting into many pieces is not an error, but it eats the
128-token sequence budget (R-3.5), so it is recorded.

    python tools/profile_tokenizer.py
    python tools/profile_tokenizer.py --model google/flan-t5-small

Writes evaluation/tokenizer_profile.json. Exits non-zero if the `<unk>` rate
exceeds --gate (default 5.0), which is R-9.6's vocabulary-review trigger.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CORPUS = ROOT / "data" / "parallel" / "train.jsonl"
FALLBACK_CORPUS = ROOT / "data" / "dictionary_full.json"
OUT = ROOT / "evaluation" / "tokenizer_profile.json"

WORD_RE = re.compile(r"[a-z']+")


def load_words(corpus: Path, limit: int) -> list[str]:
    """Latin word types from the corpus, or from the dictionary before it exists."""
    words: list[str] = []

    if corpus.suffix == ".jsonl" and corpus.exists():
        for line in corpus.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            # Latin is the target on en→dv and the (prefixed) input on dv→en.
            text = row["target"] if row.get("direction") == "en-dv" else row.get("input", "")
            words.extend(WORD_RE.findall(text.lower()))
            if limit and len(words) >= limit * 20:
                break
    elif FALLBACK_CORPUS.exists():
        print(
            f"{corpus} not found; profiling data/dictionary_full.json instead.\n"
            "Re-run after tools/build_translation_pairs.py for the real distribution.",
            file=sys.stderr,
        )
        for entry in json.loads(FALLBACK_CORPUS.read_text(encoding="utf-8")):
            words.extend(WORD_RE.findall((entry.get("latin") or "").lower()))
    else:
        raise SystemExit(f"no corpus at {corpus} and no dictionary fallback")

    # Types, not tokens: an `<unk>` rate weighted by frequency would be dominated
    # by a handful of common words and hide a broken tail.
    types = sorted(set(words))
    random.Random(11).shuffle(types)
    return types[:limit] if limit else types


def measure_truncation(tok, corpus: Path, max_len: int, sample_size: int = 4000) -> dict:
    """How many corpus rows would be silently truncated at `max_len`?

    R-9.6 asks for the `<unk>` rate, which turns out to be the easy half. The
    number that bites is fragmentation: Dhivehi Latin averages several subwords
    per word under T5's English-trained SentencePiece, so sequences run long and
    the tokenizer quietly drops the tail.
    """
    if not corpus.exists() or corpus.suffix != ".jsonl":
        return {}

    rows = []
    with corpus.open(encoding="utf-8") as handle:
        for i, line in enumerate(handle):
            if i > 200_000:
                break
            if line.strip():
                rows.append(json.loads(line))
    if not rows:
        return {}

    sample = random.Random(11).sample(rows, min(sample_size, len(rows)))
    buckets: dict[str, list[tuple[int, int]]] = {}
    for row in sample:
        lengths = (
            len(tok.encode(row["input"], add_special_tokens=True)),
            len(tok.encode(row["target"], add_special_tokens=True)),
        )
        buckets.setdefault(row.get("direction", "unknown"), []).append(lengths)

    def percentile(values: list[int], p: float) -> int:
        return sorted(values)[min(len(values) - 1, int(len(values) * p))]

    by_direction = {}
    for direction, pairs in buckets.items():
        inputs = [a for a, _ in pairs]
        targets = [b for _, b in pairs]
        over = sum(1 for a, b in pairs if a > max_len or b > max_len)
        by_direction[direction] = {
            "rows": len(pairs),
            "inputMedian": percentile(inputs, 0.5),
            "inputP90": percentile(inputs, 0.9),
            "inputP99": percentile(inputs, 0.99),
            "targetMedian": percentile(targets, 0.5),
            "targetP90": percentile(targets, 0.9),
            "targetP99": percentile(targets, 0.99),
            "overLimit": over,
            "overLimitPercent": round(100 * over / len(pairs), 2),
        }

    return {
        "maxLen": max_len,
        "sampled": len(sample),
        "byDirection": by_direction,
        "note": (
            "A row longer than maxLen is truncated silently at training time, "
            "teaching the model to map a partial source to a complete target. "
            "This is measured before training precisely because nothing reports it "
            "during training."
        ),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="t5-small")
    ap.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    ap.add_argument("--n", type=int, default=2000, help="word types to profile (R-9.6 wants ≥1,000)")
    ap.add_argument("--gate", type=float, default=5.0, help="max %% of words containing <unk>")
    ap.add_argument("--max-len", type=int, default=128, help="R-3.5 sequence limit to check against")
    ap.add_argument("--truncation-gate", type=float, default=2.0,
                    help="max %% of corpus rows allowed to exceed --max-len")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    try:
        from transformers import AutoTokenizer
    except ImportError:
        raise SystemExit("transformers is not installed. pip install -r tools/requirements.txt")

    words = load_words(args.corpus, args.n)
    if len(words) < 1000:
        print(f"warning: {len(words)} word types, below R-9.6's ≥1,000 minimum.", file=sys.stderr)

    tok = AutoTokenizer.from_pretrained(args.model)
    unk = tok.unk_token
    unk_id = tok.unk_token_id

    with_unk: list[str] = []
    pieces_total = 0
    piece_counts: Counter[int] = Counter()
    longest: list[dict] = []

    for word in words:
        ids = tok.encode(word, add_special_tokens=False)
        pieces = tok.convert_ids_to_tokens(ids)
        pieces_total += len(pieces)
        piece_counts[len(pieces)] += 1
        if unk_id in ids:
            if len(with_unk) < 100:
                with_unk.append(word)
        if len(word) >= 12 and len(longest) < 20:
            longest.append({"word": word, "pieces": pieces})

    total = len(words)
    unk_words = sum(1 for w in words if unk_id in tok.encode(w, add_special_tokens=False))
    unk_percent = round(100 * unk_words / total, 3) if total else 0.0

    # Sequence lengths against R-3.5's limit. This is the number the fragmentation
    # rate actually cashes out into: a row longer than max_len is not an error at
    # training time, it is silently truncated — so the model learns to map half a
    # sentence to a whole translation, or to stop early. Nothing surfaces that.
    truncation = measure_truncation(tok, args.corpus, args.max_len)

    profile = {
        "generatedBy": "tools/profile_tokenizer.py",
        "model": args.model,
        "corpus": str(args.corpus.relative_to(ROOT)) if args.corpus.exists() else "data/dictionary_full.json",
        "wordTypes": total,
        "unkToken": unk,
        "wordsContainingUnk": unk_words,
        "unkPercent": unk_percent,
        "gate": args.gate,
        "passes": unk_percent <= args.gate,
        "meanPiecesPerWord": round(pieces_total / total, 3) if total else 0,
        "piecesPerWordHistogram": dict(sorted(piece_counts.items())),
        "examplesWithUnk": with_unk[:20],
        "longFormExamples": longest,
        "sequenceLengths": truncation,
        "note": (
            "Measured over word TYPES, not tokens: a token-weighted rate would be "
            "dominated by common words and could hide a broken tail. Dhivehi Latin "
            "is ASCII so a low rate is expected; the point is to confirm it rather "
            "than assume it (R-9.6)."
        ),
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"model              {args.model}")
    print(f"word types         {total}")
    print(f"contain <unk>      {unk_words}  ({unk_percent:.2f}%)")
    print(f"mean pieces/word   {profile['meanPiecesPerWord']}")
    if truncation:
        print(f"\nsequence lengths vs max_len={args.max_len} (sampled {truncation['sampled']} rows)")
        for direction, d in truncation["byDirection"].items():
            print(
                f"  {direction:<6} input median {d['inputMedian']:>4} p90 {d['inputP90']:>4}"
                f"  | target median {d['targetMedian']:>4} p90 {d['targetP90']:>4}"
                f"  | over limit {d['overLimitPercent']:5.1f}%"
            )
    if longest:
        example = longest[0]
        print(f"e.g. {example['word']} → {' '.join(example['pieces'])}")
    print(f"\nwrote {args.out.relative_to(ROOT)}")

    worst = max((d["overLimitPercent"] for d in truncation["byDirection"].values()), default=0.0)
    if worst > args.truncation_gate:
        print(
            f"\nWARNING: {worst:.1f}% of rows exceed max_len={args.max_len} and would be "
            f"SILENTLY TRUNCATED during training (limit {args.truncation_gate}%).\n"
            "  Dhivehi Latin fragments far more than English under T5's SentencePiece, so the\n"
            "  Dhivehi side dominates the sequence budget. Three ways out, in order:\n"
            "    1. Filter the corpus to rows that fit. Clean, costs those rows.\n"
            "    2. Raise max_len (amends R-3.5). Costs memory and compute quadratically.\n"
            "    3. Trim/retrain the tokenizer. Also the R-3.2 size lever, so it pays twice.\n"
            "  Truncating silently is the one option that is not acceptable.",
            file=sys.stderr,
        )

    if unk_percent > args.gate:
        print(
            f"\nFAIL: {unk_percent:.2f}% exceeds the {args.gate}% gate (R-9.6). "
            "Vocabulary review required before training.",
            file=sys.stderr,
        )
        return 1

    print(f"\nPASS: at or below the {args.gate}% gate (R-9.6).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
