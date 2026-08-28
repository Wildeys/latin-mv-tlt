#!/usr/bin/env python3
"""Rescue the training metrics out of the Colab notebook's cell outputs.

The whole metric series for the v0.2 run — every eval row, every logged train
loss, the vocab-trim summary — exists in exactly one place: the stream outputs
of `colab_train_translate_drive.ipynb`, which is untracked. `training_stats.json`
was written to Drive and never came back with the model. Re-running the training
to recover a number that has already been measured is not an option, so this
script parses the outputs into committed JSON and the figures read that instead.

    python tools/extract_notebook_metrics.py
    python tools/extract_notebook_metrics.py --notebook other.ipynb --check

Writes evaluation/training_curve.json, evaluation/training_curve.csv and
evaluation/trim_stats.json. Standard library only, so it runs under either
interpreter (see tools/requirements-figures.txt for why there are two).

Three things this refuses to do quietly:

  - locate cells by index. A single inserted cell would silently shift every
    lookup and the failure would look like clean data. Cells are found by what
    their output contains.
  - merge the two eval populations. Epochs 1-3 were scored on the full 49,948-row
    valid split; the resumed leg was scored on a 2,000-row subsample, which is why
    eval_loss appears to jump at epoch 3.03. Every row carries the row count it
    was actually measured on, derived as runtime x samples_per_second, so a chart
    cannot average across the two without saying so.
  - swallow a parse failure. A dict that does not literal_eval is counted and
    reported, because a silently dropped eval row is a silently wrong curve.
"""

from __future__ import annotations

import argparse
import ast
import csv
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_NOTEBOOK = ROOT / "colab_train_translate_drive.ipynb"
OUT_JSON = ROOT / "evaluation" / "training_curve.json"
OUT_CSV = ROOT / "evaluation" / "training_curve.csv"
OUT_TRIM = ROOT / "evaluation" / "trim_stats.json"

# Colab interleaves tqdm's cursor moves with the trainer's prints, so a dict can
# arrive with an escape run glued to either end.
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
# Every dict the trainer prints is flat and numeric, so a non-greedy brace span
# is enough — and safer than trying to guess which key comes first. Cell 17
# prints them key-sorted (`{'epoch': 1.0, ...}`) while the live trainer prints
# them loss-first, so keying the regex on a leading field would miss half.
FLAT_DICT = re.compile(r"\{'[^{}]*\}")

# Above this, the row was scored on the full valid split; below, on valid_small.
# The two populations differ by a factor of 25, so any threshold in between
# separates them - this is not a tuned constant.
FULL_VALID_MIN_ROWS = 10_000


def notebook_streams(nb: dict) -> list[tuple[int, str]]:
    """(cell index, decoded stream text) for every code cell that produced one."""
    out = []
    for i, cell in enumerate(nb.get("cells", [])):
        if cell.get("cell_type") != "code":
            continue
        text = "".join(
            "".join(o.get("text", []))
            for o in cell.get("outputs", [])
            if o.get("output_type") == "stream"
        )
        if text.strip():
            # \r is a tqdm redraw, not a separator; turning it into a newline
            # keeps a dict from being concatenated onto a progress bar.
            out.append((i, ANSI.sub("", text.replace("\r", "\n"))))
    return out


def parse_dicts(text: str) -> tuple[list[dict], int]:
    rows, failures = [], 0
    for match in FLAT_DICT.finditer(text):
        try:
            value = ast.literal_eval(match.group(0))
        except (ValueError, SyntaxError):
            failures += 1
            continue
        if isinstance(value, dict):
            rows.append(value)
    return rows, failures


def classify(row: dict) -> str | None:
    if "train_runtime" in row:
        return "summary"
    if "eval_loss" in row or "eval_bleu" in row:
        return "eval"
    if "loss" in row and "grad_norm" in row:
        return "train"
    return None


def eval_rows_measured(row: dict) -> int | None:
    """How many rows this eval actually scored.

    The trainer reports runtime and throughput but not the population size, and
    the population changed mid-run. Their product recovers it exactly: 49,948 for
    the full valid split, 2,000 for valid_small. No heuristic, no threshold on
    the metric itself.
    """
    runtime = row.get("eval_runtime")
    rate = row.get("eval_samples_per_second")
    if runtime is None or rate is None:
        return None
    return round(runtime * rate)


def _epoch_precision(row: dict) -> int:
    """Decimal places on `epoch`, used to prefer the unrounded copy of a duplicate."""
    text = repr(row.get("epoch", ""))
    return len(text.partition(".")[2])


def harvest_run_facts(streams: list[tuple[int, str]]) -> dict:
    """The prose lines the trainer prints around the dicts."""
    facts: dict = {}
    joined = "\n".join(text for _, text in streams)

    m = re.search(r"resuming (checkpoint-\d+): step (\d+)/(\d+), epoch ([\d.]+)", joined)
    if m:
        facts["resumedFrom"] = {
            "checkpoint": m.group(1),
            "step": int(m.group(2)),
            "totalSteps": int(m.group(3)),
            "epoch": float(m.group(4)),
        }
    m = re.search(r"best so far: (checkpoint-\d+), chrf\+\+ ([\d.]+)", joined)
    if m:
        facts["bestAtResume"] = {"checkpoint": m.group(1), "chrf++": float(m.group(2))}
    m = re.search(r"best chrf\+\+ ([\d.]+)", joined, re.IGNORECASE)
    if m:
        facts["bestMetric"] = float(m.group(1))

    # The resumed leg inherited the checkpoint's eval cadence rather than the one
    # passed on the command line. That is why the resumed rows are 500 steps
    # apart and the first three are a whole epoch apart.
    if re.search(r"eval_steps: \d+ \(from args\) != \d+ \(from trainer_state", joined):
        m = re.search(
            r"eval_steps: (\d+) \(from args\) != (\d+) \(from trainer_state", joined
        )
        facts["evalCadenceOverride"] = {
            "fromArgs": int(m.group(1)),
            "fromCheckpoint": int(m.group(2)),
            "note": "the checkpoint's trainer_state won, so the resumed leg evaluated "
            "every 500 steps instead of every 5,000",
        }
    return facts


def harvest_hyperparameters(nb: dict) -> dict:
    """Read the launch cell's *source*, so captions cannot drift from the run."""
    for cell in nb.get("cells", []):
        if cell.get("cell_type") != "code":
            continue
        source = "".join(cell.get("source", []))
        if "tools/train_translate.py" not in source:
            continue
        params: dict = {}
        for key, pattern in (
            ("batch", r"BATCH\s*=\s*(\d+)"),
            ("saveSteps", r"SAVE_STEPS\s*=\s*(\d+)"),
        ):
            m = re.search(pattern, source)
            if m:
                params[key] = int(m.group(1))
        m = re.search(r"--model\s+(\S+)\s+--epochs\s+(\d+)", source)
        if m:
            params["baseModel"], params["epochs"] = m.group(1), int(m.group(2))
        m = re.search(r"--lr\s+(\S+)", source)
        if m:
            params["learningRate"] = float(m.group(1))
        m = re.search(r"SMOKE\s*=\s*(True|False)", source)
        if m:
            params["smoke"] = m.group(1) == "True"
        return params
    return {}


def harvest_trim(streams: list[tuple[int, str]]) -> dict | None:
    """Cell 20's vocab-trim summary. These numbers are nowhere else in the repo."""
    for _, text in streams:
        if "slice embedding" not in text or "keep set" not in text:
            continue

        def num(pattern: str, cast=int):
            m = re.search(pattern, text)
            return cast(m.group(1).replace(",", "")) if m else None

        trim = {
            "generatedBy": "tools/trim_vocab.py, transcribed by tools/extract_notebook_metrics.py",
            "tokenizerVocabBefore": num(r"tokenizer vocab\s+([\d,]+)"),
            "embeddingRowsBefore": num(r"embedding rows\s+([\d,]+)"),
            "unreachableRowsDropped": num(r"unreachable rows\s+([\d,]+)"),
            "corpusRowsScanned": num(r"([\d,]+) rows, [\d,]+ texts"),
            "corpusTextsScanned": num(r"[\d,]+ rows, ([\d,]+) texts"),
            "distinctIdsUsed": num(r"([\d,]+) distinct ids used"),
            "keep": {
                "corpus": num(r"corpus\s+([\d,]+)"),
                "specialTokens": num(r"special tokens\s+([\d,]+) more"),
                "asciiSingles": num(r"ascii singles\s+([\d,]+) more"),
                "total": num(r"total kept\s+([\d,]+)"),
                "of": num(r"total kept\s+[\d,]+ of ([\d,]+)"),
                "percent": num(r"total kept\s+[\d,]+ of [\d,]+ \(([\d.]+)%\)", float),
            },
            "vocabAfter": num(r"vocab [\d,]+ -> ([\d,]+)"),
            "dModel": num(r"\(\d+, (\d+)\) ->", int),
            "savedMbPerGraph": num(r"~([\d.]+) MB less per graph", float),
            "savedMbTotal": num(r"~([\d.]+) MB across the two shipped graphs", float),
            "verified": {
                "tokenizationRowsResampled": num(r"verify tokenization on ([\d,]+) sampled rows"),
                "textsIdentical": num(r"ok\s+([\d,]+) texts tokenize identically"),
                "generationProbesIdentical": num(r"ok\s+(\d+) probes generate identical output"),
                "specialIdsUnchanged": "pad=0 eos=1 unk=2" in text,
            },
            "note": "the untrimmed export measured 80.27 MB against an 80.00 MB budget; "
            "the embedding is roughly 42% of the shipped ONNX, so the trim is what "
            "put the model inside AC-10 without retraining.",
        }
        return trim
    return None


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--notebook", type=Path, default=DEFAULT_NOTEBOOK)
    ap.add_argument("--out", type=Path, default=OUT_JSON)
    ap.add_argument("--check", action="store_true", help="print a summary and write nothing")
    args = ap.parse_args()

    if not args.notebook.exists():
        raise SystemExit(
            f"not found: {args.notebook}\n"
            "The notebook is untracked (it carries ~110 KB of cell output). Restore it from "
            "the machine that ran the training, or keep the previously extracted "
            "evaluation/training_curve.json — that file is the committed copy."
        )

    raw = args.notebook.read_bytes()
    nb = json.loads(raw.decode("utf-8"))
    streams = notebook_streams(nb)

    evals: list[dict] = []
    losses: list[dict] = []
    summary: dict | None = None
    failures = 0

    for index, text in streams:
        rows, failed = parse_dicts(text)
        failures += failed
        for row in rows:
            kind = classify(row)
            if kind == "eval":
                evals.append({**row, "sourceCell": index})
            elif kind == "train":
                losses.append({**row, "sourceCell": index})
            elif kind == "summary":
                summary = {**row, "sourceCell": index}

    if failures:
        print(f"WARNING: {failures} brace spans did not parse", file=sys.stderr)

    # The 30 resumed eval rows are printed live by the trainer *and* replayed from
    # training_stats.json in the summary cell, so they arrive twice. They cannot be
    # matched on epoch: the live print rounds it to two decimals (`3.03`) while the
    # stats file keeps full precision (`3.033131124591694`). The metric values are
    # byte-identical in both, so they are the fingerprint - and the full-precision
    # epoch is the copy worth keeping.
    deduped: dict[tuple, dict] = {}
    for row in evals:
        key = (row.get("eval_loss"), row.get("eval_bleu"), row.get("eval_chrf"))
        cell = row.pop("sourceCell")
        candidate = {**row, "sourceCells": [cell]}
        existing = deduped.get(key)
        if existing is None:
            deduped[key] = candidate
            continue
        cells = sorted({*existing["sourceCells"], cell})
        keep = candidate if _epoch_precision(candidate) > _epoch_precision(existing) else existing
        keep["sourceCells"] = cells
        deduped[key] = keep

    eval_rows = sorted(deduped.values(), key=lambda r: r["epoch"])
    for row in eval_rows:
        measured = eval_rows_measured(row)
        row["evalRows"] = measured
        row["evalSet"] = (
            None
            if measured is None
            else ("valid-full" if measured > FULL_VALID_MIN_ROWS else "valid-small")
        )

    losses.sort(key=lambda r: r["epoch"])

    sets = {}
    for row in eval_rows:
        name = row["evalSet"]
        entry = sets.setdefault(name, {"rows": [], "evalCount": 0})
        entry["rows"].append(row["evalRows"])
        entry["evalCount"] += 1
    eval_sets = {
        name: {
            "measuredRows": sorted(set(entry["rows"])),
            "evaluations": entry["evalCount"],
        }
        for name, entry in sets.items()
    }

    report = {
        "generatedBy": "tools/extract_notebook_metrics.py",
        "notebook": args.notebook.name,
        "notebookSha256": hashlib.sha256(raw).hexdigest(),
        "hyperparameters": harvest_hyperparameters(nb),
        "run": harvest_run_facts(streams),
        "trainSummary": summary,
        "evalSets": {
            **eval_sets,
            "note": "valid-full is the 49,948-row valid split; valid-small is the 2,000-row "
            "subsample the resumed leg used because a full pass costs 35-45 minutes. "
            "The two are different populations: eval_loss rises at epoch 3.03 because the "
            "set changed, not because the model got worse. Never plot them as one series.",
        },
        "lossCoverage": {
            "epochStart": round(losses[0]["epoch"], 4) if losses else None,
            "epochEnd": round(losses[-1]["epoch"], 4) if losses else None,
            "rows": len(losses),
            "note": "the pre-resume Colab session's stream output is gone, so the logged "
            "train loss begins where the run was resumed. The gap is missing data, "
            "not a flat region.",
        },
        "evals": eval_rows,
        "trainLoss": losses,
    }

    if args.check:
        print(json.dumps({k: v for k, v in report.items() if k not in ("evals", "trainLoss")}, indent=2))
        print(f"\nevals {len(eval_rows)}  trainLoss {len(losses)}  parseFailures {failures}")
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {args.out.relative_to(ROOT)}  ({len(eval_rows)} evals, {len(losses)} loss rows)")

    with OUT_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["epoch", "series", "value", "evalSet", "evalRows"])
        for row in eval_rows:
            for key in sorted(k for k in row if k.startswith("eval_") and isinstance(row[k], (int, float))):
                writer.writerow([row["epoch"], key, row[key], row["evalSet"], row["evalRows"]])
        for row in losses:
            for key in ("loss", "grad_norm", "learning_rate"):
                if key in row:
                    writer.writerow([row["epoch"], f"train_{key}", row[key], "", ""])
    print(f"wrote {OUT_CSV.relative_to(ROOT)}")

    trim = harvest_trim(streams)
    if trim:
        OUT_TRIM.write_text(json.dumps(trim, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {OUT_TRIM.relative_to(ROOT)}")
    else:
        print("no vocab-trim output found; evaluation/trim_stats.json not written", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
