#!/usr/bin/env python3
"""Build the v0.2 parallel corpus (M-1, R-2.1 .. R-2.8).

Replaces tools/build_frame_pairs.py. That script generated sentences
combinatorially from a ~60-word slot vocabulary; this one normalises *real*
parallel text, which is the whole point of the v0.2 architecture change.

    python tools/build_translation_pairs.py
    python tools/build_translation_pairs.py --limit 5000     # quick trial run

Outputs, following tools/clean_dictionary.py's three-file convention:

    data/parallel/train.jsonl        {input, target, direction, provenance}
    data/parallel/valid.jsonl
    data/parallel/test.jsonl
    data/parallel/quarantine.jsonl   rejected rows, kept not deleted (R-2.8)
    data/parallel/corpus_stats.json  every counter, committed

The JSONL is gitignored; the stats file is committed, so the numbers behind any
published result stay checkable.

Three things here are load-bearing and easy to get wrong:

1. **Thaana is romanised only through tools/transliterate.mjs**, which wraps the
   app's own transliterator (R-2.2). A Python reimplementation would drift, and
   the drift would be invisible until BLEU came back low.

2. **Splits are by source document, not by row** (R-2.6). Slicing a shuffled row
   list lets two sentences from the same article land on both sides of the cut,
   and the model then scores well by having memorised the article's phrasing.
   build_frame_pairs.py learned this the hard way — its docstring records 21
   inputs that straddled the cut — so the grouping discipline carries over with
   the key changed from frame string to document id.

3. **The script refuses to write** if an invariant breaks, rather than emitting a
   corpus that looks fine. Same posture as clean_dictionary.py.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _transliterate_bridge import Transliterator, load_prefixes  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "parallel"

# R-2.1. The first is the ~92k news corpus; the second is optional and merged
# when available.
SOURCES = [
    {"id": "alakxender/dhivehi-english-translations", "required": True},
    {"id": "alakxender/dhivehi-english-parallel", "required": False},
]

THAANA_RE = re.compile(r"[ހ-޿]")

# R-2.4. Starting thresholds; the final values are whatever this file records.
LEN_RATIO_MIN = 0.4
LEN_RATIO_MAX = 2.5
MIN_CHARS = 2
MAX_CHARS = 600

SPLIT_SEED = 11
VALID_FRACTION = 0.05
TEST_FRACTION = 0.05


def normalise(text: str) -> str:
    """Match src/core/normalize.ts: NFC, strip zero-widths, NBSP → space."""
    text = unicodedata.normalize("NFC", text)
    text = re.sub(r"[​‌‍﻿]", "", text)
    return text.replace(" ", " ").strip()


def load_rows(limit: int) -> list[dict]:
    """Pull the HF datasets. Each row keeps the source it came from (R-2.7)."""
    try:
        from datasets import load_dataset
    except ImportError:
        raise SystemExit(
            "datasets is not installed. pip install -r tools/requirements.txt"
        )

    rows: list[dict] = []
    for source in SOURCES:
        try:
            data = load_dataset(source["id"], split="train")
        except Exception as exc:  # noqa: BLE001
            if source["required"]:
                raise SystemExit(f"could not load required dataset {source['id']}: {exc}")
            print(f"skipping optional dataset {source['id']}: {exc}", file=sys.stderr)
            continue

        columns = set(data.column_names)
        dv_col = next((c for c in ("dv", "dhivehi", "source", "thaana") if c in columns), None)
        en_col = next((c for c in ("en", "english", "target") if c in columns), None)
        if not dv_col or not en_col:
            raise SystemExit(
                f"{source['id']}: could not find Dhivehi/English columns in {sorted(columns)}"
            )

        # A document id if the dataset has one, else the row index — see the
        # split note in the module docstring.
        doc_col = next((c for c in ("doc_id", "article_id", "url", "id", "title") if c in columns), None)

        for i, row in enumerate(data):
            rows.append(
                {
                    "dv": row[dv_col] or "",
                    "en": row[en_col] or "",
                    "source": source["id"],
                    "doc": str(row[doc_col]) if doc_col else f"{source['id']}#{i}",
                }
            )
            if limit and len(rows) >= limit:
                return rows
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--limit", type=int, default=0, help="cap rows read (0 = all)")
    ap.add_argument("--ratio-min", type=float, default=LEN_RATIO_MIN)
    ap.add_argument("--ratio-max", type=float, default=LEN_RATIO_MAX)
    args = ap.parse_args()

    prefixes = load_prefixes()
    rows = load_rows(args.limit)
    if not rows:
        raise SystemExit("no rows loaded")

    dropped: Counter[str] = Counter()
    quarantine: list[dict] = []

    def reject(reason: str, row: dict) -> None:
        dropped[reason] += 1
        # R-2.8: quarantined, not deleted. Capped so a systematic failure does
        # not write a multi-gigabyte file.
        if len(quarantine) < 5000:
            quarantine.append({**row, "reason": reason})

    # ---- clean ------------------------------------------------------------
    kept: list[dict] = []
    for row in rows:
        dv = normalise(row["dv"])
        en = normalise(row["en"])

        if not dv or not en:
            reject("empty_side", row)
            continue
        if not THAANA_RE.search(dv):
            reject("no_thaana_in_source", row)
            continue
        if THAANA_RE.search(en):
            reject("thaana_in_english", row)
            continue
        if not (MIN_CHARS <= len(dv) <= MAX_CHARS and MIN_CHARS <= len(en) <= MAX_CHARS):
            reject("length_bounds", row)
            continue
        kept.append({**row, "dv": dv, "en": en})

    # ---- romanise (R-2.2) -------------------------------------------------
    with Transliterator() as tr:
        sha = tr.sha256
        latins = tr.thaana_to_latin_many([r["dv"] for r in kept])
    for row, latin in zip(kept, latins):
        row["latin"] = latin

    # ---- length-ratio filter (R-2.4) --------------------------------------
    ratio_kept: list[dict] = []
    for row in kept:
        if not row["latin"]:
            reject("empty_after_transliteration", row)
            continue
        ratio = len(row["latin"]) / max(1, len(row["en"]))
        if not (args.ratio_min <= ratio <= args.ratio_max):
            reject("length_ratio", {**row, "ratio": round(ratio, 3)})
            continue
        ratio_kept.append(row)

    # ---- dedup (R-2.3) ----------------------------------------------------
    # Exact on the pair, then near-duplicate on a case- and space-folded key, so
    # the same sentence reprinted with different spacing counts once.
    seen_exact: set[tuple[str, str]] = set()
    seen_near: set[tuple[str, str]] = set()
    deduped: list[dict] = []
    for row in ratio_kept:
        exact = (row["latin"], row["en"])
        if exact in seen_exact:
            reject("duplicate_exact", row)
            continue
        near = (
            re.sub(r"\s+", " ", row["latin"].lower()),
            re.sub(r"[^a-z0-9 ]+", "", re.sub(r"\s+", " ", row["en"].lower())),
        )
        if near in seen_near:
            reject("duplicate_near", row)
            continue
        seen_exact.add(exact)
        seen_near.add(near)
        deduped.append(row)

    if not deduped:
        raise SystemExit("every row was filtered out; refusing to write an empty corpus")

    # ---- split by document (R-2.6) ----------------------------------------
    groups: dict[str, list[dict]] = {}
    for row in deduped:
        groups.setdefault(row["doc"], []).append(row)
    keys = sorted(groups)
    random.Random(SPLIT_SEED).shuffle(keys)

    n = len(keys)
    n_test = max(1, int(n * TEST_FRACTION))
    n_valid = max(1, int(n * VALID_FRACTION))
    test_keys = keys[:n_test]
    valid_keys = keys[n_test : n_test + n_valid]
    train_keys = keys[n_test + n_valid :]

    if not train_keys:
        raise SystemExit(
            f"only {n} document groups; not enough to split. "
            "Use a larger --limit, or check that the dataset exposes a document id."
        )

    def emit(keys_subset: list[str]) -> list[dict]:
        out: list[dict] = []
        for key in keys_subset:
            for row in groups[key]:
                # R-2.5: both directions, prefix explicit, never implicit.
                provenance = {"source": row["source"], "doc": row["doc"], "synthetic": False}
                out.append(
                    {
                        "input": prefixes["dv-en"] + row["latin"],
                        "target": row["en"],
                        "direction": "dv-en",
                        "provenance": provenance,
                    }
                )
                out.append(
                    {
                        "input": prefixes["en-dv"] + row["en"],
                        "target": row["latin"],
                        "direction": "en-dv",
                        "provenance": provenance,
                    }
                )
        return out

    splits = {"train": emit(train_keys), "valid": emit(valid_keys), "test": emit(test_keys)}

    # ---- invariants: refuse to write rather than emit a bad corpus ---------
    train_docs = {k for k in train_keys}
    for name in ("valid", "test"):
        held = set(valid_keys if name == "valid" else test_keys)
        overlap = train_docs & held
        if overlap:
            raise SystemExit(f"{len(overlap)} documents in both train and {name}; refusing to write")

    train_inputs = {row["input"] for row in splits["train"]}
    for name in ("valid", "test"):
        leaked = sum(1 for row in splits[name] if row["input"] in train_inputs)
        if leaked:
            raise SystemExit(f"{leaked} inputs appear in both train and {name}; refusing to write")

    # ---- write ------------------------------------------------------------
    args.out.mkdir(parents=True, exist_ok=True)
    for name, rows_out in splits.items():
        (args.out / f"{name}.jsonl").write_text(
            "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows_out),
            encoding="utf-8",
        )
    (args.out / "quarantine.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in quarantine),
        encoding="utf-8",
    )

    real_pairs = len(deduped)
    stats = {
        "generatedBy": "tools/build_translation_pairs.py",
        "sources": [s["id"] for s in SOURCES],
        "transliteratorSha256": sha,
        "prefixes": prefixes,
        "rowsRead": len(rows),
        "pairsKept": real_pairs,
        "dropped": dict(dropped.most_common()),
        "droppedTotal": sum(dropped.values()),
        "quarantined": len(quarantine),
        "lengthRatioBounds": [args.ratio_min, args.ratio_max],
        "splitSeed": SPLIT_SEED,
        "splitBy": "document",
        "documentGroups": n,
        "rows": {name: len(rows_out) for name, rows_out in splits.items()},
        "documents": {"train": len(train_keys), "valid": len(valid_keys), "test": len(test_keys)},
        # R-2.1b / AC-13. Stage 1 is the real pairs; Stage 2 adds back-translated
        # ones (R-2.10), which is why `provenance.synthetic` exists from the start.
        "stage": 1,
        "stage1Target": 90_000,
        "stage2Target": 200_000,
        "syntheticPairs": 0,
        "realPairs": real_pairs,
        "meetsStage2Target": real_pairs >= 200_000,
    }
    (args.out / "corpus_stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"rows read            {stats['rowsRead']}")
    print(f"pairs kept           {real_pairs}")
    print(f"dropped              {stats['droppedTotal']}")
    for reason, count in dropped.most_common():
        print(f"  {reason:<28} {count}")
    print(f"document groups      {n}")
    for name in ("train", "valid", "test"):
        print(f"  {name:<6} {len(splits[name]):>8} rows  {stats['documents'][name]:>6} docs")
    print(f"\ntransliterator       {sha[:16]}…")
    print(f"wrote                {args.out.relative_to(ROOT)}/")

    if real_pairs < 200_000:
        print(
            f"\nStage 1 corpus: {real_pairs} pairs. R-2.1b targets ≥200,000 for Stage 2 — "
            "see tools/backtranslate.py (R-2.10).",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
