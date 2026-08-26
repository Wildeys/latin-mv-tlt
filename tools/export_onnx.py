#!/usr/bin/env python3
"""Export the trained model to INT8 ONNX for the browser (M-4, R-9.3, R-3.13, R-3.4).

R-9.3 was entirely unimplemented in v0.1: no export script existed anywhere in the
repo, and the Colab notebook had no export cell. The 307 MB in public/models/ was
produced by hand, which is how it ended up containing ~162 MB of graphs the
runtime never loads.

    python tools/export_onnx.py --model models/dv-en-translate \\
        --out public/models/dv-en-translate

Every step asserts. The script refuses to write rather than emit a model that
would fail in the browser or blow the budget — the same posture as
clean_dictionary.py's "no key disappears without a recorded rewrite".

Two traps this exists to avoid, both of which bit v0.1:

  Merging after quantization instead of before.
      The fp32 merged decoder is ~159 MB, so v0.1 gave up on it and shipped a
      *copy* of the unmerged decoder under the merged filename. That graph has no
      `use_cache_branch`, which forced a monkey-patch on the library's generation
      loop. Quantizing the merge instead of avoiding it gives ~42 MB and no patch.

  quantize_dynamic silently skipping `If` subgraphs.
      The merged decoder wraps both cache branches in ONNX `If` nodes.
      `quantize_dynamic` does not descend into subgraphs unless
      `extra_options={"EnableSubgraph": True}` is passed, so without it you get a
      file that is nominally quantized and still fp32 inside — at ~160 MB. That is
      almost certainly what produced v0.1's "too large for GitHub" number. The
      shrink assertion below catches it either way.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# R-3.4, scoped to the model directory. The ONNX Runtime WASM (~21 MB) and the
# app bundle are reported separately — see REQUIREMENTS.md R-3.4.
BUDGET_BYTES = 80_000_000

# R-3.13: exactly the files transformers.js fetches at runtime, and no others.
RUNTIME_FILES = [
    "config.json",
    "generation_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
]
RUNTIME_ONNX = [
    "encoder_model_quantized.onnx",
    "decoder_model_merged_quantized.onnx",
]

# A quantized graph that did not shrink past this fraction of its fp32 source is
# not really quantized. INT8 should be near 0.25; 0.6 is a loose alarm, not a target.
MAX_SHRINK_RATIO = 0.6


def human(n: int) -> str:
    return f"{n / 1e6:.2f} MB"


def assert_merged_has_cache_branch(path: Path) -> None:
    """The assertion that makes deleting the runtime monkey-patch safe.

    If `use_cache_branch` is missing, the graph cannot take a KV cache, and
    transformers.js will feed it one anyway — producing wrong output from the
    second token with no error. Better to fail here than to ship that.
    """
    import onnx

    model = onnx.load(str(path), load_external_data=False)
    names = {i.name for i in model.graph.input}
    if "use_cache_branch" not in names:
        raise SystemExit(
            f"{path.name} has no `use_cache_branch` input.\n"
            f"  graph inputs: {sorted(names)}\n"
            "This is not a real merged decoder. Re-export with\n"
            "  --task text2text-generation-with-past\n"
            "Shipping it would require the runBeam monkey-patch that v0.2 removed, "
            "and that hook no longer exists in transformers.js v3."
        )
    print(f"  ok  {path.name} exposes use_cache_branch")


def quantize(src: Path, dst: Path) -> None:
    from onnxruntime.quantization import QuantType, quantize_dynamic

    before = src.stat().st_size
    quantize_dynamic(
        model_input=str(src),
        model_output=str(dst),
        weight_type=QuantType.QInt8,
        per_channel=False,
        reduce_range=True,
        # Without this, nodes inside the merged decoder's `If` subgraphs are left
        # in fp32 and the "quantized" file stays enormous. See module docstring.
        extra_options={"EnableSubgraph": True},
    )
    after = dst.stat().st_size
    ratio = after / before
    print(f"  {src.name}: {human(before)} → {human(after)}  ({ratio:.0%})")
    if ratio > MAX_SHRINK_RATIO:
        raise SystemExit(
            f"{dst.name} is {ratio:.0%} of its fp32 size — quantization did not take effect.\n"
            "The usual cause is `If` subgraph nodes being skipped. Confirm "
            "extra_options={'EnableSubgraph': True} reached quantize_dynamic."
        )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", type=Path, required=True, help="trained checkpoint directory")
    ap.add_argument("--out", type=Path, default=ROOT / "public" / "models" / "dv-en-translate")
    ap.add_argument("--work", type=Path, default=ROOT / "data" / "onnx-export")
    ap.add_argument("--opset", type=int, default=14)
    ap.add_argument("--budget", type=int, default=BUDGET_BYTES)
    ap.add_argument("--keep-work", action="store_true", help="keep the fp32 intermediates")
    args = ap.parse_args()

    if not args.model.exists():
        raise SystemExit(f"no checkpoint at {args.model}")

    args.work.mkdir(parents=True, exist_ok=True)

    # ---- 1. export fp32 ONNX with the cache branch -------------------------
    print("1. optimum-cli export")
    cmd = [
        sys.executable, "-m", "optimum.commands.optimum_cli",
        "export", "onnx",
        "--model", str(args.model),
        "--task", "text2text-generation-with-past",
        "--opset", str(args.opset),
        str(args.work),
    ]
    result = subprocess.run(cmd)
    if result.returncode != 0:
        # Fall back to the plain console script if the module path is unavailable.
        result = subprocess.run(
            ["optimum-cli", "export", "onnx", "--model", str(args.model),
             "--task", "text2text-generation-with-past", "--opset", str(args.opset), str(args.work)]
        )
        if result.returncode != 0:
            raise SystemExit("optimum-cli export failed")

    # ---- 2. assert the merge is real ---------------------------------------
    print("\n2. verify merged decoder")
    merged = args.work / "decoder_model_merged.onnx"
    encoder = args.work / "encoder_model.onnx"
    for path in (merged, encoder):
        if not path.exists():
            raise SystemExit(f"expected {path.name} in {args.work}; export layout changed")
    assert_merged_has_cache_branch(merged)

    # ---- 3. quantize -------------------------------------------------------
    print("\n3. INT8 quantization")
    quantize(encoder, args.work / "encoder_model_quantized.onnx")
    quantize(merged, args.work / "decoder_model_merged_quantized.onnx")

    # ---- 4. stage only the runtime files (R-3.13) --------------------------
    print("\n4. stage runtime files")
    staged = args.work / "_staged"
    if staged.exists():
        shutil.rmtree(staged)
    (staged / "onnx").mkdir(parents=True)

    per_file: dict[str, int] = {}
    for name in RUNTIME_FILES:
        src = args.work / name
        if not src.exists():
            src = args.model / name
        if not src.exists():
            if name == "special_tokens_map.json":
                continue  # optional
            raise SystemExit(f"missing {name}")
        shutil.copy2(src, staged / name)
        per_file[name] = (staged / name).stat().st_size

    for name in RUNTIME_ONNX:
        shutil.copy2(args.work / name, staged / "onnx" / name)
        per_file[f"onnx/{name}"] = (staged / "onnx" / name).stat().st_size
        print(f"  {name}  {human(per_file[f'onnx/{name}'])}")

    skipped = sorted(
        p.name for p in args.work.glob("*.onnx") if p.name not in RUNTIME_ONNX
    )
    if skipped:
        # Named explicitly, because silently dropping files is how you end up not
        # knowing what is in your model directory.
        print(f"  not shipped (R-3.13): {', '.join(skipped)}")

    # ---- 5. budget gate (R-3.4) --------------------------------------------
    total = sum(per_file.values())
    print(f"\n5. budget\n  total {human(total)} of {human(args.budget)}")
    if total > args.budget:
        raise SystemExit(
            f"\nREFUSING TO WRITE: {human(total)} exceeds the {human(args.budget)} budget "
            f"by {human(total - args.budget)} (R-3.4, NFR-13, AC-10).\n"
            "Contingency ladder, in order of preference (REQUIREMENTS.md R-3.2):\n"
            "  1. Trim the vocabulary to the tokens the corpus actually uses and retrain.\n"
            "     t5-small's embedding is 32,128 x 512 and appears three times across\n"
            "     the two graphs; both languages are ASCII, so this is the big win.\n"
            "  2. Export the decoder at q4 instead of q8, and MEASURE the chrF++ cost.\n"
            "  3. Record an explicit decision to raise the budget, forfeiting AC-10."
        )

    # ---- 6. publish --------------------------------------------------------
    if args.out.exists():
        shutil.rmtree(args.out)
    shutil.copytree(staged, args.out)

    stats = {
        "generatedBy": "tools/export_onnx.py",
        "sourceCheckpoint": str(args.model),
        "opset": args.opset,
        "quantization": {
            "weightType": "QInt8",
            "perChannel": False,
            "reduceRange": True,
            "enableSubgraph": True,
        },
        "mergedDecoderHasCacheBranch": True,
        "files": per_file,
        "totalBytes": total,
        "budgetBytes": args.budget,
        "withinBudget": total <= args.budget,
        "notShipped": skipped,
        "note": (
            "Only the graphs transformers.js loads are shipped (R-3.13). v0.1 also "
            "carried decoder_with_past (never loaded) and an unmerged decoder that "
            "was byte-identical to the file served as the merged one — together "
            "~162 MB of the 307 MB."
        ),
    }
    (args.out / "export_stats.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")

    if not args.keep_work:
        shutil.rmtree(args.work, ignore_errors=True)

    print(f"\nwrote {args.out}")
    print("\nNext:")
    print("  node tools/smoke_translate.mjs 'aharen maleah dhaanan'   # check it runs")
    print("  npm run check:models                                     # same gate, in CI")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
