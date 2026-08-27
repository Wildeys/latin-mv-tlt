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


# Imported later in the run, long after the multi-minute export step. Checked up
# front so a missing one costs a second rather than the whole export.
# Top-level packages only: preflight answers "is it installed", the export step
# answers "does it work". Probing a submodule here would import optimum's chain
# and re-raise its breakage as a traceback, ahead of the code that explains it.
REQUIRED_IMPORTS = [
    ("optimum", "'optimum[onnxruntime]>=1.23'"),
    ("onnx", "'onnx>=1.17'"),
    ("onnxruntime", "'onnxruntime>=1.19'"),
]


def human(n: int) -> str:
    return f"{n / 1e6:.2f} MB"


def preflight() -> None:
    """Refuse to start if the export toolchain is missing from *this* interpreter.

    The failure this replaces was a bare FileNotFoundError on `optimum-cli`,
    which says nothing about the actual cause: %pip installed into the notebook
    kernel, and `!python tools/export_onnx.py` ran a different interpreter.
    """
    import importlib.util

    missing = []
    for module, pin in REQUIRED_IMPORTS:
        try:
            found = importlib.util.find_spec(module) is not None
        except ModuleNotFoundError:
            found = False  # parent package absent
        except Exception:
            # Installed, but its import chain raises. That is a different problem
            # with a far better message downstream — do not report it as missing.
            found = True
        if not found:
            missing.append((module, pin))
    if not missing:
        return

    names = ", ".join(m for m, _ in missing)
    pins = " ".join(pin for _, pin in missing)
    raise SystemExit(
        f"missing export dependencies: {names}\n"
        f"  interpreter: {sys.executable}\n"
        f"\nInstall them into that interpreter and re-run:\n"
        f"  {sys.executable} -m pip install -U {pins}\n"
        "\nIn a notebook, `%pip install` targets the kernel but `!python ...` may "
        "resolve to a different\ninterpreter — launch this as "
        "`!{sys.executable} tools/export_onnx.py ...` instead, and restart the\n"
        "runtime if the install happened in the same session.\n"
        "tools/requirements-train.txt pins the full set."
    )


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


def run_streaming(cmd: list[str]) -> tuple[int, str]:
    """Run `cmd`, echoing output live and keeping a copy to diagnose failures.

    The export is minutes long, so the output has to stream; but its failures are
    100-line import tracebacks whose actual cause is one line near the top, so a
    copy has to be kept for explain_export_failure().
    """
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
    )
    captured: list[str] = []
    assert proc.stdout is not None
    for line in proc.stdout:
        sys.stdout.write(line)
        captured.append(line)
    sys.stdout.flush()
    return proc.wait(), "".join(captured)


def explain_export_failure(log: str) -> str:
    """Turn optimum's import tracebacks back into the one thing to actually do.

    optimum imports `diffusers` behind `is_diffusers_available()`, so a diffusers
    installation that is broken against the installed huggingface_hub takes down
    an export that never touches diffusion at all. Colab ships both preinstalled,
    which makes this the default outcome there, not an edge case.
    """
    hints = []
    if "diffusers" in log and ("huggingface_hub" in log or "Failed to import diffusers" in log):
        hints.append(
            "The blocker is `diffusers`, not this export.\n"
            "  optimum/exporters/utils.py imports it under `if is_diffusers_available():`,\n"
            "  and the installed diffusers is incompatible with the installed\n"
            "  huggingface_hub. Nothing in this project uses diffusion, so the fix is to\n"
            "  take diffusers out of the picture and let that branch go dead:\n"
            f"\n      {sys.executable} -m pip uninstall -y diffusers\n\n"
            "  then re-run this script — no runtime restart needed, the export is a fresh\n"
            "  subprocess. (Upgrading huggingface_hub instead also works, but it moves a\n"
            "  package transformers pins, and that does need a restart.)"
        )
    if "No module named" in log and "optimum.exporters.onnx" in log:
        hints.append(
            "optimum is installed without its ONNX exporter. Since optimum 2.x that lives\n"
            "  in a separate distribution:\n"
            f"\n      {sys.executable} -m pip install -U 'optimum[onnxruntime]>=1.23'"
        )
    if "Multiple distributions found for package optimum" in log:
        hints.append(
            "The `Multiple distributions found for package optimum` line is expected and\n"
            "  harmless: optimum 2.x moved the ONNX exporter into the separate optimum-onnx\n"
            "  distribution, and both share the `optimum` namespace. It is not the failure."
        )
    if not hints:
        hints.append(
            "No known cause matched. The real error is usually the *first* exception in the\n"
            "  trace above, not the last one."
        )
    return "\n\n".join(hints)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", type=Path, required=True, help="trained checkpoint directory")
    ap.add_argument("--out", type=Path, default=ROOT / "public" / "models" / "dv-en-translate")
    ap.add_argument("--work", type=Path, default=ROOT / "data" / "onnx-export")
    ap.add_argument("--opset", type=int, default=14)
    ap.add_argument("--budget", type=int, default=BUDGET_BYTES)
    ap.add_argument("--keep-work", action="store_true", help="keep the fp32 intermediates")
    args = ap.parse_args()

    preflight()

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
    code, log = run_streaming(cmd)
    if code != 0:
        # `-m optimum.commands.optimum_cli` is not runnable in every optimum
        # release, so fall back to the console script — but only as a fallback:
        # if it is not on PATH either, the module invocation's failure is the
        # real one to report. Retrying is pointless when both entry points share
        # the import that just failed, so only retry if the module path itself
        # was what was missing.
        if "No module named" in log and "optimum.commands" in log:
            try:
                code, log = run_streaming(
                    ["optimum-cli", "export", "onnx", "--model", str(args.model),
                     "--task", "text2text-generation-with-past",
                     "--opset", str(args.opset), str(args.work)]
                )
            except FileNotFoundError:
                raise SystemExit(
                    "optimum-cli export failed, and no `optimum-cli` on PATH to retry with.\n"
                    f"  interpreter: {sys.executable}\n"
                    f"  {sys.executable} -m pip install -U 'optimum[onnxruntime]>=1.23'"
                ) from None
        if code != 0:
            raise SystemExit(
                f"\noptimum-cli export failed (exit {code}).\n\n"
                + explain_export_failure(log)
            )

    # ---- 2. assert the merge is real ---------------------------------------
    print("\n2. verify merged decoder")
    merged = args.work / "decoder_model_merged.onnx"
    encoder = args.work / "encoder_model.onnx"
    for path in (merged, encoder):
        if not path.exists():
            produced = sorted(p.name for p in args.work.rglob("*.onnx"))
            raise SystemExit(
                f"expected {path.name} in {args.work}, and the export did not produce it.\n"
                f"  produced: {', '.join(produced) or '(no .onnx files at all)'}\n"
                "If the merged decoder is missing while decoder_model.onnx and\n"
                "decoder_with_past_model.onnx are present, post-processing was skipped —\n"
                "check that --no-post-process was not passed. The runtime needs the merged\n"
                "graph (R-3.13); an unmerged one cannot take a KV cache."
            )
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
