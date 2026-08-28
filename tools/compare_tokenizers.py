#!/usr/bin/env python3
"""Measure what each tokenizer does to Thaana, Malé Latin and English (R-9.6).

`tools/profile_tokenizer.py` answers "does t5-small handle Dhivehi Latin?" — it
does, at 0.0% <unk>. This answers the prior question the whole architecture rests
on: *why romanize at all?* The design's central claim is that a small English
SentencePiece model cannot represent Thaana, and that romanizing first is what
makes a 60M-parameter model usable on Dhivehi. That is a measurable claim, and
until now it was only asserted.

    .venv/bin/python tools/compare_tokenizers.py
    .venv/bin/python tools/compare_tokenizers.py --models t5-small gpt2 --offline

Reads evaluation/script_triples.json — the same sentence in all three scripts, so
a token-count difference is a property of the script rather than of the sentence.
Writes evaluation/tokenizer_comparison.json.

Only tokenizer files are downloaded, never weights: a tokenizer is a few MB where
the checkpoints are 0.2-2.4 GB, and there is no torch on this machine anyway.
Checkpoint sizes are read from the Hub's file metadata instead, which is also how
the footprint figures get their numbers without a download.

The metric that matters is not token count. A tokenizer that turns a sentence
into two <unk> ids has a *wonderful* token count; it has simply thrown the
sentence away. `charsLostToUnkPercent` measures what fraction of the source
characters no longer survive in the encoding, which is the number the
"Latin core, Thaana edges" decision actually turns on.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRIPLES = ROOT / "evaluation" / "script_triples.json"
OUT = ROOT / "evaluation" / "tokenizer_comparison.json"

sys.path.insert(0, str(ROOT / "tools"))
from measure_roundtrip import levenshtein  # noqa: E402  single definition, R-9.1

WORD_RE = re.compile(r"\S+")

# The compact comparison set. Each row answers a different objection to the
# romanize-first design; a longer list would not add an argument.
DEFAULT_MODELS = [
    # The shipped system. Local, so it needs no network and is always available.
    "local:public/models/dv-en-translate",
    # What we fine-tuned from: English-dominated SentencePiece, 32k vocab.
    "t5-small",
    # The honest counterpoint — mC4 includes Dhivehi, so this one *does* cover
    # Thaana. It costs a 250k vocab to do it.
    "google/mt5-small",
    # Byte-level: perfect coverage by construction, and the price is length.
    # Thaana is three UTF-8 bytes per character.
    "google/byt5-small",
    # The only NMT model with an official div_Thaa direction.
    "facebook/nllb-200-distilled-600M",
]

SCRIPTS = ("thaana", "latin", "english")


def load_tokenizer(spec: str, offline: bool):
    """Return (tokenizer, metadata). Local specs never touch the network."""
    from transformers import AutoTokenizer, PreTrainedTokenizerFast

    if spec.startswith("local:"):
        directory = ROOT / spec[len("local:"):]
        # The shipped tokenizer_config declares tokenizer_class "TokenizersBackend",
        # which is what transformers writes for a backend-only tokenizer and which
        # AutoTokenizer cannot resolve by name. The tokenizer.json beside it is a
        # complete definition, so it is loaded directly rather than by class lookup.
        tokenizer = PreTrainedTokenizerFast(
            tokenizer_file=str(directory / "tokenizer.json"),
            unk_token="<unk>",
            pad_token="<pad>",
            eos_token="</s>",
        )
        return tokenizer, {"resolvedFrom": "local", "path": spec[len("local:"):]}

    tokenizer = AutoTokenizer.from_pretrained(spec, local_files_only=offline)
    meta: dict = {"resolvedFrom": "cache" if offline else "hub"}

    if not offline:
        try:
            from huggingface_hub import HfApi

            info = HfApi().model_info(spec, files_metadata=True)
            meta["revision"] = info.sha
            weights = [
                f.size
                for f in (info.siblings or [])
                if f.rfilename.endswith((".safetensors", ".bin"))
                and not f.rfilename.endswith(".index.json")
                and f.size
            ]
            # Prefer safetensors when a repo ships both formats, or the checkpoint
            # is counted twice.
            safe = [
                f.size
                for f in (info.siblings or [])
                if f.rfilename.endswith(".safetensors") and f.size
            ]
            meta["hubCheckpointBytes"] = sum(safe) if safe else (sum(weights) or None)
        except Exception as err:  # network, auth, or a repo without file metadata
            meta["hubMetadataError"] = f"{type(err).__name__}: {err}"

    return tokenizer, meta


def unk_id(tokenizer) -> int | None:
    token = getattr(tokenizer, "unk_token_id", None)
    return token if isinstance(token, int) else None


def measure(tokenizer, texts: list[str], unk: int | None) -> dict:
    """Everything that can be said about one tokenizer on one script."""
    per_sentence, per_char, chars_lost, unk_tokens = [], [], [], 0
    total_tokens = total_chars = 0
    sentences_with_unk = 0
    exact_decodes = 0
    recoveries = []
    pieces_per_word: Counter = Counter()
    offsets_available = bool(getattr(tokenizer, "is_fast", False))

    for text in texts:
        encoding = tokenizer(text, add_special_tokens=False)
        ids = encoding["input_ids"]
        per_sentence.append(len(ids))
        total_tokens += len(ids)
        total_chars += len(text)
        per_char.append(len(ids) / len(text) if text else 0.0)

        if unk is not None and unk in ids:
            sentences_with_unk += 1
            unk_tokens += sum(1 for i in ids if i == unk)

        # How much of the *source* an <unk> swallowed. A tokenizer that maps a
        # 34-character Thaana clause to one <unk> has lost 34 characters, not one
        # token, and only the offsets say so.
        if offsets_available and unk is not None:
            try:
                spans = tokenizer(text, add_special_tokens=False, return_offsets_mapping=True)
                lost = sum(
                    end - start
                    for (start, end), i in zip(spans["offset_mapping"], ids)
                    if i == unk
                )
                chars_lost.append(lost / len(text) if text else 0.0)
            except (NotImplementedError, KeyError, TypeError):
                offsets_available = False

        decoded = tokenizer.decode(ids, skip_special_tokens=True)
        normalise = lambda s: " ".join(s.split())  # noqa: E731
        if normalise(decoded) == normalise(text):
            exact_decodes += 1
        recoveries.append(
            max(0.0, 1.0 - levenshtein(normalise(decoded), normalise(text)) / max(1, len(text)))
        )

        for word in WORD_RE.findall(text):
            pieces_per_word[len(tokenizer(word, add_special_tokens=False)["input_ids"])] += 1

    words = sum(pieces_per_word.values())
    pieces = sum(count * n for count, n in pieces_per_word.items())

    result = {
        "sentences": len(texts),
        "chars": total_chars,
        "tokens": total_tokens,
        "tokensPerChar": round(total_tokens / total_chars, 4) if total_chars else None,
        "tokensPerSentence": {
            "mean": round(statistics.fmean(per_sentence), 2) if per_sentence else None,
            "median": statistics.median(per_sentence) if per_sentence else None,
            "p90": sorted(per_sentence)[int(0.9 * len(per_sentence))] if per_sentence else None,
            "max": max(per_sentence) if per_sentence else None,
        },
        "tokensPerWord": round(pieces / words, 3) if words else None,
        "piecesPerWordHistogram": {str(k): v for k, v in sorted(pieces_per_word.items())},
        "unkSentenceRate": round(100 * sentences_with_unk / len(texts), 3) if texts else None,
        "unkTokenShare": round(100 * unk_tokens / total_tokens, 3) if total_tokens else None,
        "decodeExactRate": round(100 * exact_decodes / len(texts), 2) if texts else None,
        "charRecovery": round(100 * statistics.fmean(recoveries), 2) if recoveries else None,
        "over128Tokens": sum(1 for n in per_sentence if n > 128),
    }
    if chars_lost:
        result["charsLostToUnkPercent"] = round(100 * statistics.fmean(chars_lost), 3)
    else:
        result["charsLostToUnkPercent"] = None
        result["charsLostNote"] = (
            "no offset mapping: this tokenizer is not backed by the tokenizers library"
            if not offsets_available
            else "no <unk> token defined"
        )
    return result


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--models", nargs="*", default=DEFAULT_MODELS)
    ap.add_argument("--triples", type=Path, default=TRIPLES)
    ap.add_argument("--limit", type=int, default=0, help="cap sentences per script")
    ap.add_argument("--offline", action="store_true", help="cache only, no network")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    offline = args.offline or os.environ.get("HF_HUB_OFFLINE") == "1"

    if not args.triples.exists():
        raise SystemExit(f"not found: {args.triples}\nRun tools/build_script_triples.py first.")
    data = json.loads(args.triples.read_text(encoding="utf-8"))
    triples = data["triples"]
    if args.limit:
        triples = triples[: args.limit]
    texts = {script: [t[script] for t in triples] for script in SCRIPTS}
    showcase = data.get("showcase") or {}

    results, failures = {}, {}
    for spec in args.models:
        print(f"{spec} ...", flush=True)
        try:
            tokenizer, meta = load_tokenizer(spec, offline)
        except Exception as err:
            # One unreachable repo must not cost the other four their measurement.
            failures[spec] = f"{type(err).__name__}: {err}"
            print(f"  FAILED  {failures[spec]}", file=sys.stderr)
            continue

        unk = unk_id(tokenizer)
        entry = {
            **meta,
            "tokenizerClass": type(tokenizer).__name__,
            "vocabSize": len(tokenizer),
            "isFast": bool(getattr(tokenizer, "is_fast", False)),
            "unkToken": tokenizer.unk_token if unk is not None else None,
            "byScript": {},
        }
        for script in SCRIPTS:
            entry["byScript"][script] = measure(tokenizer, texts[script], unk)

        if showcase:
            entry["showcase"] = {}
            for script in SCRIPTS:
                ids = tokenizer(showcase[script], add_special_tokens=False)["input_ids"]
                entry["showcase"][script] = {
                    "chars": len(showcase[script]),
                    "ids": len(ids),
                    "unk": sum(1 for i in ids if i == unk) if unk is not None else 0,
                    "pieces": tokenizer.convert_ids_to_tokens(ids)[:40],
                }

        results[spec] = entry
        row = entry["byScript"]
        print(
            f"  vocab {entry['vocabSize']:>7,}   "
            + "   ".join(
                f"{s[:3]} {row[s]['tokensPerChar']:.2f} tok/char, "
                f"{(row[s]['charsLostToUnkPercent'] or 0):.1f}% lost"
                for s in SCRIPTS
            )
        )

    report = {
        "generatedBy": "tools/compare_tokenizers.py",
        "corpus": {
            "source": str(args.triples.relative_to(ROOT)),
            "sentences": len(triples),
            "scripts": list(SCRIPTS),
        },
        "showcase": showcase,
        "metricNotes": {
            "tokensPerChar": "the only fair cross-script length metric; sentences differ in "
                             "character count between scripts even when they are the same sentence",
            "charsLostToUnkPercent": "share of source characters covered by an <unk> id, i.e. "
                                     "not recoverable from the encoding at any model size. This "
                                     "is the number the romanize-first design turns on.",
            "charRecovery": "mean 1 - levenshtein(decode(encode(s)), s) / len(s), whitespace "
                            "normalised. Catches lossy normalisation that leaves no <unk> behind.",
            "tokensPerWord": "counted over every word *token* in running text. "
                             "tools/profile_tokenizer.py counts word *types* from a deduplicated "
                             "sample and reports a higher mean for the same tokenizer (5.697 vs "
                             "~4.75 on Latin) because deduplication strips out the short, frequent "
                             "words. Neither is wrong; they answer different questions - types "
                             "describe the vocabulary, tokens describe what a sentence actually "
                             "costs. Do not quote one as if it were the other.",
            "hubCheckpointBytes": "sum of the repo's safetensors, read from Hub file metadata. "
                                  "No weights were downloaded.",
        },
        "models": results,
        "failures": failures,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nwrote {args.out.relative_to(ROOT)}  ({len(results)} tokenizers, {len(failures)} failed)")
    return 1 if failures and not results else 0


if __name__ == "__main__":
    raise SystemExit(main())
