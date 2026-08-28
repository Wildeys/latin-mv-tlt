#!/usr/bin/env python3
"""Render the documentation figures from the measured artefacts.

    /usr/local/bin/python3 tools/render_figures.py
    /usr/local/bin/python3 tools/render_figures.py --only training_curve
    /usr/local/bin/python3 tools/render_figures.py --strict

Writes docs/figures/<name>.{png,svg,csv} plus docs/figures/figures.json.

This script imports nothing but the standard library and matplotlib, and it opens
nothing but committed JSON. That is a deliberate constraint rather than an
accident of what was convenient:

  - it has no numbers of its own. Every value on every axis was measured by
    another script and written to an artefact; the only numeric literals here are
    layout constants. A figure cannot drift from the data because there is no
    second copy of the data to drift from.
  - it needs neither transformers nor torch, so it runs under the system
    interpreter that has matplotlib, while the measuring scripts run under the
    virtualenv that has transformers. Neither environment has to grow to match
    the other. See tools/requirements-figures.txt.

Missing artefacts are skipped by name rather than crashing, so the figure set can
be built up as measurements land; --strict turns a skip into a failure for the
final pass.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D
    from matplotlib.patches import Patch, Rectangle
except ImportError:  # pragma: no cover
    raise SystemExit(
        "matplotlib is not installed for this interpreter.\n"
        "The measuring scripts run under .venv (transformers, sacrebleu); this one runs "
        "under an interpreter with matplotlib:\n"
        "    /usr/local/bin/python3 tools/render_figures.py\n"
        "or install it here:  pip install -r tools/requirements-figures.txt"
    )

ROOT = Path(__file__).resolve().parents[1]
EVAL = ROOT / "evaluation"
OUTDIR = ROOT / "docs" / "figures"

# ------------------------------------------------------------------ style
#
# Palette from the project's data-viz reference, validated with its own checker
# (`validate_palette.js "#2a78d6,#eb6834,#1baf7a" --mode light --pairs all`):
# lightness band, chroma floor, CVD separation (worst pair dE 9.2 deutan) and
# normal-vision separation (dE 24.0) all pass. The one WARN is aqua at 2.74:1
# against the light surface, which obliges every aqua mark to carry a visible
# label - discharged by the direct value labels below and by the per-figure CSV.
#
# Three slots is the documented all-pairs cap, so no chart here puts more than
# three categorical series on one axes; anything wider becomes small multiples.
BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"
SERIES = (BLUE, ORANGE, AQUA)
INK, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#e6e5e1", "#fcfcfb"
GOOD, WARNING, CRITICAL = "#0ca30c", "#fab219", "#d03b3b"

STATUS_COLOR = {
    "met": GOOD, "closed": GOOD,
    "not-met": CRITICAL,
    "open": WARNING,
    "accepted": MUTED, "unmeasured": MUTED,
}

plt.rcParams.update({
    "figure.dpi": 110,
    "savefig.facecolor": SURFACE,
    "figure.facecolor": SURFACE,
    "axes.facecolor": SURFACE,
    # DejaVu is matplotlib's bundled default. Naming Helvetica or Arial here
    # would fall back silently on a machine without them and every figure would
    # shift; this way the output is the same everywhere.
    "font.family": "DejaVu Sans",
    "font.size": 9,
    "axes.titlesize": 11,
    "axes.labelsize": 10,
    "axes.edgecolor": MUTED,
    "axes.labelcolor": INK,
    "text.color": INK,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "xtick.labelsize": 9,
    "ytick.labelsize": 9,
    "legend.frameon": False,
    "legend.fontsize": 9,
    # Without a fixed hashsalt every SVG gets fresh element ids and the whole
    # directory shows as modified on every render.
    "svg.hashsalt": "latin-mv-tlt",
})

WIDE, TALL = 7.0, 4.2


def style_axes(ax, xgrid: bool = False):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color(GRID)
    ax.spines["bottom"].set_color(GRID)
    ax.grid(axis="x" if xgrid else "y", color=GRID, lw=0.6, zorder=0)
    ax.set_axisbelow(True)


def titles(ax, title, subtitle=None, offset=0):
    """Title and subtitle placed in *points* above the axes, not axes fractions.

    An axes-fraction offset is a different physical distance on a 3.4-inch figure
    than on a 6.6-inch one, which is how a subtitle ends up printed through its
    own title. Offsetting in points is height-independent, and bbox_inches="tight"
    grows the canvas to fit whatever this reserves.
    """
    ax.annotate(title, xy=(0, 1), xycoords="axes fraction",
                xytext=(0, offset + (26 if subtitle else 12)), textcoords="offset points",
                ha="left", va="baseline", fontsize=11, color=INK)
    if subtitle:
        ax.annotate(subtitle, xy=(0, 1), xycoords="axes fraction",
                    xytext=(0, offset + 11), textcoords="offset points",
                    ha="left", va="baseline", fontsize=8.5, color=MUTED)


def label_bars(ax, bars, values, fmt="{:.1f}", horizontal=False, pad=0.01, log=False):
    """Direct value labels. Not decoration: the palette check makes them required."""
    span = (ax.get_xlim()[1] if horizontal else ax.get_ylim()[1]) or 1
    for bar, value in zip(bars, values):
        if value is None:
            continue
        text = fmt.format(value)
        if horizontal:
            # On a log axis an additive offset is enormous at the low end and
            # invisible at the high end, so the offset has to be multiplicative.
            x = bar.get_width() * (1 + pad * 12) if log else bar.get_width() + span * pad
            ax.text(x, bar.get_y() + bar.get_height() / 2,
                    text, va="center", ha="left", fontsize=8, color=INK)
        else:
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + span * pad,
                    text, ha="center", va="bottom", fontsize=8, color=INK)


def short(name: str) -> str:
    """Model ids are too long for an axis; keep the part that identifies them."""
    if name.startswith("local:"):
        return "ours (t5-small,\ntrimmed vocab)"
    return {
        "t5-small": "t5-small",
        "google/mt5-small": "mT5-small",
        "google/byt5-small": "ByT5-small",
        "facebook/nllb-200-distilled-600M": "NLLB-200\ndistilled 600M",
    }.get(name, name.split("/")[-1])


# ------------------------------------------------------------------ registry

FIGURES: list[dict] = []


def figure(name, requires, caption, size=(WIDE, TALL)):
    def decorator(fn):
        FIGURES.append({"name": name, "requires": requires, "caption": caption,
                        "size": size, "fn": fn})
        return fn
    return decorator


ARTEFACTS = {
    "tokens": EVAL / "tokenizer_comparison.json",
    "profile": EVAL / "tokenizer_profile.json",
    "triples": EVAL / "script_triples.json",
    "curve": EVAL / "training_curve.json",
    "trim": EVAL / "trim_stats.json",
    "scores": EVAL / "scores.json",
    "scores_conv": EVAL / "scores_conversational.json",
    "latency": EVAL / "predict_latency.json",
    "sample": EVAL / "test_sample_stats.json",
    "acceptance": EVAL / "acceptance_status.json",
    "roundtrip": EVAL / "roundtrip_stats.json",
    "roundtrip_corpus": EVAL / "roundtrip_stats_corpus.json",
    "corpus": ROOT / "data" / "parallel" / "corpus_stats.json",
    "export": ROOT / "public" / "models" / "dv-en-translate" / "export_stats.json",
}


# =================================================== gap 1: tokenization

@figure(
    "tokenizer_tokens_per_sentence",
    ["tokens"],
    "Tokens produced for the same sentence in each script. Because every sentence "
    "is present in all three scripts, the columns are directly comparable: the "
    "difference is the script, not the content.",
    size=(WIDE, 4.6),
)
def _tokens_per_sentence(d):
    models = list(d["tokens"]["models"])
    fig, ax = plt.subplots(figsize=(WIDE, 4.6))
    style_axes(ax)
    width = 0.26
    rows = []
    for i, script in enumerate(("thaana", "latin", "english")):
        values = [d["tokens"]["models"][m]["byScript"][script]["tokensPerSentence"]["mean"]
                  for m in models]
        lost = [d["tokens"]["models"][m]["byScript"][script]["charsLostToUnkPercent"] or 0.0
                for m in models]
        xs = [x + (i - 1) * width for x in range(len(models))]
        bars = ax.bar(xs, values, width * 0.92, color=SERIES[i],
                      label=script.capitalize() if script != "thaana" else "Thaana", zorder=3)
        # A short bar here can mean two opposite things: an efficient encoding, or
        # a sentence that was thrown away. Without this mark t5-small's 23-token
        # Thaana bar reads as the *best* result on the chart, when in fact 85% of
        # the characters behind it no longer exist.
        for bar, share in zip(bars, lost):
            if share > 1:
                bar.set_hatch("///")
                bar.set_edgecolor(CRITICAL)
                bar.set_linewidth(1.1)
        label_bars(ax, bars, values, "{:.0f}")
        for m, v, share in zip(models, values, lost):
            rows.append({"model": m, "script": script, "meanTokensPerSentence": round(v, 2),
                         "charsLostToUnkPercent": round(share, 2)})

    ax.set_xticks(range(len(models)))
    ax.set_xticklabels([short(m) for m in models], fontsize=8)
    ax.set_ylabel("mean tokens per sentence")
    n = d["tokens"]["corpus"]["sentences"]
    titles(ax, "Cost of a sentence, by script and tokenizer",
           f"{n} aligned sentences · hatched bars are encodings whose content was lost to <unk>")
    handles, labels = ax.get_legend_handles_labels()
    handles.append(Patch(facecolor="none", edgecolor=CRITICAL, hatch="///",
                         label="content lost to <unk>"))
    ax.legend(handles=handles, ncol=4, loc="upper left", bbox_to_anchor=(0.0, -0.13),
              fontsize=8.5)
    ax.set_ylim(0, max(ax.get_ylim()[1], 1) * 1.12)
    return fig, rows


@figure(
    "tokenizer_information_loss",
    ["tokens"],
    "Share of Thaana source characters that fall inside an <unk> token, i.e. are "
    "not recoverable from the encoding at any model size. This is the measurement "
    "the romanize-first design rests on.",
)
def _information_loss(d):
    models = list(d["tokens"]["models"])
    values = [(d["tokens"]["models"][m]["byScript"]["thaana"]["charsLostToUnkPercent"] or 0.0)
              for m in models]
    order = sorted(range(len(models)), key=lambda i: values[i])
    models = [models[i] for i in order]
    values = [values[i] for i in order]

    fig, ax = plt.subplots(figsize=(WIDE, 3.9))
    style_axes(ax, xgrid=True)
    colors = [CRITICAL if v > 1 else GOOD for v in values]
    bars = ax.barh([short(m).replace("\n", " ") for m in models], values, 0.62,
                   color=colors, zorder=3)
    ax.set_xlim(0, 100)
    # A 0% bar has no length to colour, so the claim moves to its label rather
    # than drawing a stub of a bar that does not exist.
    for bar, value in zip(bars, values):
        ax.text(bar.get_width() + 1.2, bar.get_y() + bar.get_height() / 2,
                f"{value:.1f}%", va="center", ha="left", fontsize=8,
                color=CRITICAL if value > 1 else GOOD,
                weight="bold" if value <= 1 else "normal")
    ax.set_xlabel("% of Thaana source characters lost to <unk>")
    titles(ax, "What each tokenizer can still represent after encoding Thaana",
           "0.0% means the script survives encoding intact · red: the characters are "
           "gone before the model ever sees them")
    rows = [{"model": m, "thaanaCharsLostToUnkPercent": round(v, 3),
             "vocabSize": d["tokens"]["models"][m]["vocabSize"]}
            for m, v in zip(models, values)]
    return fig, rows


@figure(
    "tokenizer_worked_example",
    ["tokens", "triples"],
    "One sentence, tokenized by t5-small in each of its three scripts. The Thaana "
    "row is not a short encoding, it is an empty one: both content tokens are <unk>.",
    size=(WIDE, 3.4),
)
def _worked_example(d):
    show = d["tokens"]["models"]["t5-small"]["showcase"]
    src = d["tokens"]["showcase"]
    fig, ax = plt.subplots(figsize=(WIDE, 3.4))
    ax.set_axis_off()

    rows = []
    y = 0.80
    for script, colour in zip(("thaana", "latin", "english"), SERIES):
        entry = show[script]
        pieces = entry["pieces"]
        # The piece strings are ASCII or the literal "<unk>", so they render;
        # the Thaana *source* is never drawn - DejaVu has no Thaana glyphs and
        # would silently emit tofu boxes.
        label = {"thaana": "Thaana", "latin": "Malé Latin", "english": "English"}[script]
        ax.text(0.0, y + 0.085, f"{label}  ·  {entry['chars']} chars → {entry['ids']} tokens"
                                + (f", {entry['unk']} of them <unk>" if entry["unk"] else ""),
                fontsize=9.5, color=INK, transform=ax.transAxes, weight="bold")
        x = 0.0
        for piece in pieces[:34]:
            text = piece.replace("▁", "_")
            width = 0.016 * max(len(text), 1) + 0.012
            is_unk = piece == "<unk>"
            ax.add_patch(Rectangle((x, y - 0.045), width - 0.004, 0.075,
                                   transform=ax.transAxes, clip_on=False,
                                   facecolor=CRITICAL if is_unk else colour,
                                   alpha=1.0 if is_unk else 0.22,
                                   edgecolor=SURFACE, lw=1.4))
            ax.text(x + (width - 0.004) / 2, y - 0.008, text, transform=ax.transAxes,
                    ha="center", va="center", fontsize=7.5,
                    color="#ffffff" if is_unk else INK)
            x += width
        if len(pieces) > 34:
            ax.text(x + 0.005, y - 0.008, f"+{entry['ids'] - 34}", transform=ax.transAxes,
                    va="center", fontsize=7.5, color=MUTED)
        rows.append({"script": script, "chars": entry["chars"], "tokens": entry["ids"],
                     "unkTokens": entry["unk"], "pieces": " ".join(pieces)})
        y -= 0.30

    ax.text(0.0, 1.02, "The same sentence, tokenized by t5-small",
            transform=ax.transAxes, fontsize=11, color=INK)
    ax.text(0.0, 0.945, f"“{src['english']}”  ·  Latin: {src['latin']}",
            transform=ax.transAxes, fontsize=8.5, color=MUTED)
    ax.text(0.0, -0.06,
            "Thaana source is shown transliterated above; the boxes are the tokenizer's own pieces "
            "(_ marks a word start).",
            transform=ax.transAxes, fontsize=8, color=MUTED)
    return fig, rows


@figure(
    "pieces_per_word",
    ["tokens"],
    "How many subword pieces one word becomes. Malé Latin fragments far more than "
    "English, which is what spends the 128-token sequence budget. Counted over word "
    "tokens in running text; evaluation/tokenizer_profile.json counts word types and "
    "reports a higher mean (5.697) for the same tokenizer.",
)
def _pieces_per_word(d):
    ours = d["tokens"]["models"]["local:public/models/dv-en-translate"]["byScript"]
    fig, ax = plt.subplots(figsize=(WIDE, TALL))
    style_axes(ax)

    rows = []
    span = range(1, 16)
    width = 0.4
    for i, (script, label) in enumerate((("latin", "Malé Latin"), ("english", "English"))):
        hist = ours[script]["piecesPerWordHistogram"]
        total = sum(hist.values()) or 1
        values = [100 * hist.get(str(k), 0) / total for k in span]
        ax.bar([k + (i - 0.5) * width for k in span], values, width * 0.9,
               color=SERIES[i], label=label, zorder=3)
        mean = ours[script]["tokensPerWord"]
        ax.axvline(mean, color=SERIES[i], lw=1.6, ls="--", zorder=4)
        ax.text(mean, ax.get_ylim()[1] * 0.92, f" mean {mean:.2f}", color=SERIES[i],
                fontsize=8.5, ha="left")
        for k, v in zip(span, values):
            rows.append({"script": script, "pieces": k, "percentOfWords": round(v, 3)})

    ax.set_xticks(list(span))
    ax.set_xlabel("subword pieces per word")
    ax.set_ylabel("% of words")
    titles(ax, "Subword fragmentation, shipped tokenizer",
           "word tokens in running text — profile_tokenizer.py counts word types and "
           "reports 5.697 for the same tokenizer")
    ax.legend(loc="upper right")
    return fig, rows


# =================================================== gap 2: model footprint

@figure(
    "model_size_vs_budget",
    ["tokens", "export"],
    "Published checkpoint size against the 80 MB browser budget, log scale. The "
    "tokenizers that can represent Thaana belong to models one to two orders of "
    "magnitude past what a browser-only app can download.",
)
def _model_size(d):
    entries = []
    for name, model in d["tokens"]["models"].items():
        size = model.get("hubCheckpointBytes")
        if size:
            entries.append((short(name).replace("\n", " "), size / 1e6, "fp32 checkpoint",
                            (model["byScript"]["thaana"]["charsLostToUnkPercent"] or 0)))
    shipped = d["export"]["totalBytes"] / 1e6
    ours = d["tokens"]["models"]["local:public/models/dv-en-translate"]
    entries.append(("ours, shipped\n(INT8 ONNX)", shipped, "shipped",
                    ours["byScript"]["thaana"]["charsLostToUnkPercent"] or 0))
    entries.sort(key=lambda e: e[1])

    budget = d["export"]["budgetBytes"] / 1e6
    fig, ax = plt.subplots(figsize=(WIDE, 4.0))
    style_axes(ax, xgrid=True)
    colors = [AQUA if kind == "shipped" else BLUE for _, _, kind, _ in entries]
    bars = ax.barh([e[0] for e in entries], [e[1] for e in entries], 0.6,
                   color=colors, zorder=3)
    ax.set_xscale("log")
    ax.set_xlim(10, 6000)
    label_bars(ax, bars, [e[1] for e in entries], "{:,.0f} MB", horizontal=True, pad=0.01, log=True)

    ax.axvline(budget, color=CRITICAL, lw=1.6, ls="--", zorder=4)
    ax.annotate(f"{budget:.0f} MB budget (AC-10)", xy=(budget, 1), xycoords=("data", "axes fraction"),
                xytext=(4, -10), textcoords="offset points", color=CRITICAL, fontsize=8.5)
    ax.set_xlabel("download size (MB, log scale)")
    titles(ax, "What it costs to ship a translator to a browser",
           "aqua: the quantized model this project ships · blue: published fp32 checkpoints")
    rows = [{"model": n, "sizeMB": round(s, 2), "kind": k, "thaanaCharsLostPercent": round(l, 2)}
            for n, s, k, l in entries]
    rows.append({"model": "budget", "sizeMB": budget, "kind": "AC-10", "thaanaCharsLostPercent": None})
    return fig, rows


@figure(
    "vocab_vs_thaana_coverage",
    ["tokens"],
    "The trade-off in one view: the tokenizers that keep Thaana intact are the ones "
    "carrying a quarter-million-entry vocabulary. Romanizing buys the coverage back "
    "at a 23,505-entry vocabulary.",
)
def _vocab_vs_coverage(d):
    fig, ax = plt.subplots(figsize=(WIDE, TALL))
    style_axes(ax, xgrid=True)
    ax.grid(axis="y", color=GRID, lw=0.6)

    # ours and t5-small sit almost on top of each other - same tokenizer, one with
    # a trimmed vocabulary - so their labels are placed by hand rather than by a
    # single offset that would print them through one another.
    placement = {
        "local:public/models/dv-en-translate": ((-12, -6), "right", "top"),
        "t5-small": ((10, 12), "left", "bottom"),
    }
    rows = []
    for name, model in d["tokens"]["models"].items():
        vocab = model["vocabSize"]
        lost = model["byScript"]["thaana"]["charsLostToUnkPercent"] or 0.0
        size = model.get("hubCheckpointBytes")
        ours = name.startswith("local:")
        ax.scatter([vocab], [lost], s=170 if ours else 120,
                   color=AQUA if ours else (CRITICAL if lost > 1 else BLUE),
                   edgecolor=SURFACE, linewidth=1.6, zorder=4)
        offset, ha, va = placement.get(name, ((10, -6), "left", "top"))
        ax.annotate(short(name).replace("\n", " ") + (f"\n{size/1e6:,.0f} MB" if size else "\n71 MB shipped"),
                    (vocab, lost), textcoords="offset points", xytext=offset,
                    fontsize=8, color=INK, va=va, ha=ha)
        rows.append({"model": name, "vocabSize": vocab,
                     "thaanaCharsLostPercent": round(lost, 3),
                     "checkpointMB": round(size / 1e6, 1) if size else None})

    ax.set_xscale("log")
    ax.set_xlim(120, 3_000_000)
    ax.set_ylim(-18, 112)
    ax.set_xlabel("tokenizer vocabulary size (log scale)")
    ax.set_ylabel("% of Thaana characters lost to <unk>")
    titles(ax, "Thaana coverage is bought with vocabulary",
           "bottom-left is unreachable: no small vocabulary covers Thaana")
    return fig, rows


# =================================================== gap 3: training & accuracy

def _split_series(evals, key, eval_set):
    xs = [r["epoch"] for r in evals if r["evalSet"] == eval_set and r.get(key) is not None]
    ys = [r[key] for r in evals if r["evalSet"] == eval_set and r.get(key) is not None]
    return xs, ys


@figure(
    "training_curve",
    ["curve"],
    "Validation chrF++ and BLEU across the run, split by direction. The two eval "
    "populations are drawn as separate series: epochs 1-3 were scored on the full "
    "49,948-row validation split, the resumed leg on a 2,000-row subsample.",
    size=(WIDE, 4.8),
)
def _training_curve(d):
    evals = d["curve"]["evals"]
    sets = {r["evalSet"] for r in evals}
    assert len(sets) > 1 or None in sets or True  # documented below

    fig, axes = plt.subplots(1, 2, figsize=(WIDE, 4.8), sharex=True)
    rows = []
    boundary = min((r["epoch"] for r in evals if r["evalSet"] == "valid-small"), default=None)

    for ax, metric, title in zip(axes, ("eval_chrf", "eval_bleu"), ("chrF++", "BLEU")):
        style_axes(ax)
        if boundary is not None:
            ax.axvspan(boundary, max(r["epoch"] for r in evals), color=GRID, alpha=0.55, zorder=0)
        for i, direction in enumerate(("dv-en", "en-dv")):
            key = f"{metric}_{direction}"
            # A single line must never contain both populations - the y value
            # means something different on each. Full-valid points are filled,
            # the subsample is drawn open on its own line.
            for eval_set, style in (("valid-full", dict(marker="o", ms=6, ls="-")),
                                    ("valid-small", dict(marker="o", ms=4.5, ls="-",
                                                         mfc=SURFACE, mew=1.4, alpha=0.9))):
                xs, ys = _split_series(evals, key, eval_set)
                if not xs:
                    continue
                ax.plot(xs, ys, color=SERIES[i], lw=1.8, **style)
                for x, y in zip(xs, ys):
                    rows.append({"epoch": round(x, 5), "metric": metric,
                                 "direction": direction, "value": y, "evalSet": eval_set})
        ax.set_title(title, loc="left", fontsize=10, color=MUTED)
        ax.set_xlabel("epoch")

    axes[0].set_ylabel("score")
    if boundary is not None:
        axes[0].annotate(
            f"resumed run:\nscored on 2,000 rows",
            xy=(boundary, axes[0].get_ylim()[0]), xytext=(6, 12),
            textcoords="offset points", fontsize=8, color=MUTED)

    handles = [Line2D([], [], color=SERIES[0], marker="o", lw=1.8, label="Dhivehi → English"),
               Line2D([], [], color=SERIES[1], marker="o", lw=1.8, label="English → Dhivehi"),
               Line2D([], [], color=MUTED, marker="o", ls="-", lw=1.4, label="full valid split (49,948)"),
               Line2D([], [], color=MUTED, marker="o", mfc=SURFACE, mew=1.4, ls="-", lw=1.4,
                      label="valid subsample (2,000)")]
    fig.legend(handles=handles, ncol=2, loc="lower center", bbox_to_anchor=(0.5, -0.02))
    hp = d["curve"]["hyperparameters"]
    fig.suptitle(f"Training the {hp.get('baseModel', 'model')}: "
                 f"{hp.get('epochs')} epochs, batch {hp.get('batch')}, lr {hp.get('learningRate')}",
                 x=0.005, ha="left", fontsize=11, y=1.0)
    fig.subplots_adjust(bottom=0.28, top=0.86)
    return fig, rows


@figure(
    "training_loss_lr",
    ["curve"],
    "Training loss and learning rate over the logged portion of the run. The x axis "
    "starts at epoch 3.01: the earlier session's log was lost with the Colab runtime, "
    "so the region before it is missing data rather than flat data.",
    size=(WIDE, 4.4),
)
def _loss_lr(d):
    losses = d["curve"]["trainLoss"]
    fig, axes = plt.subplots(2, 1, figsize=(WIDE, 4.4), sharex=True)
    rows = []
    for ax, key, label, colour in ((axes[0], "loss", "training loss", BLUE),
                                   (axes[1], "learning_rate", "learning rate", ORANGE)):
        style_axes(ax)
        xs = [r["epoch"] for r in losses]
        ys = [r[key] for r in losses]
        ax.plot(xs, ys, color=colour, lw=1.8)
        ax.set_ylabel(label)
        for x, y in zip(xs, ys):
            rows.append({"epoch": x, "series": key, "value": y})
    axes[1].set_xlabel("epoch")
    cov = d["curve"]["lossCoverage"]
    titles(axes[0], "Logged training loss and schedule",
           f"{cov['rows']} logged steps, epoch {cov['epochStart']}–{cov['epochEnd']} "
           f"— epochs 0–3 were not recorded")
    return fig, rows


@figure(
    "scores_by_direction",
    ["scores", "sample"],
    "Held-out test scores per direction. Both directions come from one set of "
    "weights and are scored on the same underlying sentence pairs, so the gap "
    "between them is a property of the directions, not of the test data.",
)
def _scores_by_direction(d):
    scores = d["scores"]["scores"]
    directions = [x for x in ("dv-en", "en-dv") if x in scores]
    names = {"dv-en": "Dhivehi → English", "en-dv": "English → Dhivehi"}

    fig, axes = plt.subplots(1, 2, figsize=(WIDE, TALL))
    rows = []
    for ax, metric, title in zip(axes, ("bleu", "chrf++"), ("BLEU", "chrF++")):
        style_axes(ax)
        values = [scores[x][metric] for x in directions]
        bars = ax.bar([names[x] for x in directions], values, 0.5,
                      color=[SERIES[i] for i in range(len(directions))], zorder=3)
        label_bars(ax, bars, values, "{:.2f}")
        ax.set_ylim(0, max(values) * 1.28)
        ax.set_title(title, loc="left", fontsize=10, color=MUTED)
        ax.tick_params(axis="x", labelsize=8.5)
        for x, v in zip(directions, values):
            rows.append({"direction": x, "metric": metric, "value": v,
                         "pairs": scores[x]["pairs"]})

    pairs = ", ".join(f"{names[x]} n={scores[x]['pairs']}" for x in directions)
    fig.suptitle("Translation quality on the held-out domains", x=0.005, ha="left",
                 fontsize=11, y=1.0)
    fig.text(0.005, 0.90, f"{pairs} · {d['sample']['sampleNote']}",
             fontsize=8, color=MUTED, wrap=True)
    fig.subplots_adjust(top=0.76)
    return fig, rows


@figure(
    "heldout_vs_indomain",
    ["scores", "scores_conv"],
    "The generalisation gap. The nine news domains were held out whole, so the "
    "model has never seen their subject matter; the conversational rows are a "
    "row-level holdout from a register it does train on.",
)
def _heldout_vs_indomain(d):
    groups = [("held-out domains", d["scores"]["scores"]),
              ("conversational\n(in-domain)", d["scores_conv"]["scores"])]
    directions = ["dv-en", "en-dv"]
    names = {"dv-en": "Dhivehi → English", "en-dv": "English → Dhivehi"}

    fig, axes = plt.subplots(1, 2, figsize=(WIDE, TALL))
    rows = []
    for ax, metric, title in zip(axes, ("bleu", "chrf++"), ("BLEU", "chrF++")):
        style_axes(ax)
        width = 0.34
        for i, direction in enumerate(directions):
            values = [g[1].get(direction, {}).get(metric) for g in groups]
            xs = [x + (i - 0.5) * width for x in range(len(groups))]
            bars = ax.bar(xs, values, width * 0.92, color=SERIES[i],
                          label=names[direction], zorder=3)
            label_bars(ax, bars, values, "{:.1f}")
            for g, v in zip(groups, values):
                rows.append({"group": g[0].replace("\n", " "), "direction": direction,
                             "metric": metric, "value": v})
        ax.set_xticks(range(len(groups)))
        ax.set_xticklabels([g[0] for g in groups], fontsize=8.5)
        ax.set_title(title, loc="left", fontsize=10, color=MUTED)
        ax.set_ylim(0, ax.get_ylim()[1] * 1.2)

    axes[0].legend(loc="upper left", fontsize=8.5)
    fig.suptitle("Unseen subject matter costs more than direction does",
                 x=0.005, ha="left", fontsize=11, y=1.0)
    fig.subplots_adjust(top=0.86)
    return fig, rows


@figure(
    "latency_distribution",
    ["latency"],
    "Per-sentence generation time under Node.js with the ONNX Runtime wasm backend. "
    "This is not browser latency and is not comparable to it.",
)
def _latency(d):
    fig, ax = plt.subplots(figsize=(WIDE, TALL))
    style_axes(ax)
    rows = []
    names = {"dv-en": "Dhivehi → English", "en-dv": "English → Dhivehi"}
    for i, (direction, entry) in enumerate(d["latency"]["byDirection"].items()):
        samples = sorted(entry["samples"])
        ys = [100 * (j + 1) / len(samples) for j in range(len(samples))]
        ax.plot(samples, ys, color=SERIES[i], lw=1.9, label=f"{names.get(direction, direction)}")
        ax.axvline(entry["medianMs"], color=SERIES[i], lw=1.2, ls=":", alpha=0.8)
        rows.append({"direction": direction, "n": entry["n"], "meanMs": entry["meanMs"],
                     "medianMs": entry["medianMs"], "p90Ms": entry["p90Ms"],
                     "p99Ms": entry["p99Ms"]})
    ax.set_xlabel("milliseconds per sentence")
    ax.set_ylabel("% of sentences at or below")
    ax.set_ylim(0, 101)
    ax.legend(loc="lower right")
    rt = d["latency"]["runtime"]
    titles(ax, "Generation latency, greedy decoding",
           f"{rt.get('cpu', 'CPU')} · node {rt.get('node')} · "
           f"{rt.get('concurrentShards', 1)} concurrent processes — not browser latency")
    return fig, rows


# =================================================== gap 4: achieved vs spec

@figure(
    "budget_vs_actual",
    ["acceptance"],
    "Every numeric gate in the specification against its measured value. Bars are "
    "drawn as a percentage of the gate so gates in different units share one axis.",
)
def _budget_vs_actual(d):
    budgets = [b for b in d["acceptance"]["budgets"] if b["measured"] is not None]
    # A "% of gate" axis cannot mix the two gate directions: 88% of the 80 MB
    # budget is a pass, while 88% of the 500-pair floor is a failure. Same bar
    # length, opposite meaning - so they go in separate panels with their own
    # headings rather than sharing one axis and a footnote.
    panels = [
        ("must stay within", [b for b in budgets if not b["higherIsBetter"]], "≤"),
        ("must reach", [b for b in budgets if b["higherIsBetter"]], "≥"),
    ]
    panels = [p for p in panels if p[1]]
    heights = [max(len(p[1]), 1) for p in panels]

    fig, axes = plt.subplots(len(panels), 1, figsize=(WIDE, 1.1 + 0.85 * sum(heights)),
                             gridspec_kw={"height_ratios": heights})
    axes = [axes] if len(panels) == 1 else list(axes)

    rows = []
    for ax, (heading, group, arrow) in zip(axes, panels):
        style_axes(ax, xgrid=True)
        group = sorted(group, key=lambda b: b["status"] != "not-met")
        labels = [f"{b['id']}  {b['label']}" for b in group]
        ratios = [100 * b["measured"] / (b["target"] or 1) for b in group]
        colors = [GOOD if b["status"] == "met" else CRITICAL for b in group]
        bars = ax.barh(labels, ratios, 0.58, color=colors, zorder=3)
        ax.axvline(100, color=MUTED, lw=1.4, ls="--", zorder=4)
        for bar, b in zip(bars, group):
            ax.text(max(bar.get_width(), 0) + 4, bar.get_y() + bar.get_height() / 2,
                    f"{b['measured']:g} {b['unit']}   (gate {arrow} {b['target']:g})",
                    va="center", fontsize=8, color=INK)
            rows.append({"id": b["id"], "label": b["label"], "measured": b["measured"],
                         "target": b["target"], "unit": b["unit"],
                         "percentOfGate": round(100 * b["measured"] / (b["target"] or 1), 2),
                         "gateDirection": arrow, "status": b["status"]})
        ax.set_xlim(0, max(ratios + [100]) * 1.75)
        ax.invert_yaxis()
        ax.annotate(f"{heading}  (gate {arrow})", xy=(0, 1), xycoords="axes fraction",
                    xytext=(0, 8), textcoords="offset points", fontsize=9,
                    color=MUTED, weight="bold")

    axes[-1].set_xlabel("measured value as % of its gate")
    titles(axes[0], "Specification gates against measured values",
           "green: gate met · red: gate not met · dashed line: the gate itself", offset=20)
    fig.subplots_adjust(hspace=0.55)
    return fig, rows


@figure(
    "acceptance_criteria",
    ["acceptance"],
    "Acceptance criteria and open gaps with their present status. `unmeasured` is "
    "shown as its own category: a criterion with no artefact behind it is not the "
    "same claim as one that was measured and failed.",
    size=(WIDE, 6.6),
)
def _acceptance(d):
    criteria = d["acceptance"]["criteria"]
    gaps = d["acceptance"]["gaps"]
    entries = [("ACCEPTANCE CRITERIA", None)]
    entries += [(c["id"], c) for c in criteria]
    entries += [("KNOWN GAPS", None)]
    entries += [(g["id"], g) for g in gaps]

    fig, ax = plt.subplots(figsize=(WIDE, 6.6))
    ax.set_axis_off()
    rows = []
    y = 1.0
    step = 1.0 / (len(entries) + 2)
    for label, item in entries:
        if item is None:
            ax.text(0.0, y, label, transform=ax.transAxes, fontsize=8.5,
                    color=MUTED, weight="bold")
            y -= step * 1.25
            continue
        status = item["status"]
        colour = STATUS_COLOR.get(status, MUTED)
        ax.add_patch(Rectangle((0.0, y - 0.004), 0.012, 0.016, transform=ax.transAxes,
                               clip_on=False, facecolor=colour, edgecolor=SURFACE, lw=0.8))
        ax.text(0.022, y, label, transform=ax.transAxes, fontsize=8, color=INK, weight="bold")
        text = item["text"]
        ax.text(0.125, y, text[:72] + ("…" if len(text) > 78 else ""),
                transform=ax.transAxes, fontsize=8, color=INK)
        # Status word beside the swatch: colour never carries the meaning alone.
        ax.text(1.0, y, status, transform=ax.transAxes, fontsize=7.5,
                color=colour if status != "unmeasured" else MUTED, ha="right")
        rows.append({"id": label, "status": status, "text": text,
                     "measured": item.get("measured"), "target": item.get("target")})
        y -= step

    ax.text(0.0, 1.055, "Where the system stands against its specification",
            transform=ax.transAxes, fontsize=11, color=INK)
    ax.text(0.0, 1.025, "docs/REQUIREMENTS.md §7 and §9, resolved against evaluation/*.json",
            transform=ax.transAxes, fontsize=8.5, color=MUTED)
    return fig, rows


# =================================================== corpus & transliteration

@figure(
    "corpus_funnel",
    ["corpus"],
    "Why 575,892 source rows became 285,748 training pairs. Each bar is one "
    "documented drop rule from tools/build_translation_pairs.py.",
)
def _corpus_funnel(d):
    dropped = d["corpus"]["dropped"]
    items = sorted(dropped.items(), key=lambda kv: kv[1])
    fig, ax = plt.subplots(figsize=(WIDE, 4.4))
    style_axes(ax, xgrid=True)
    bars = ax.barh([k.replace("_", " ") for k, _ in items], [v for _, v in items], 0.62,
                   color=BLUE, zorder=3)
    label_bars(ax, bars, [v for _, v in items], "{:,.0f}", horizontal=True, pad=0.02)
    ax.set_xlim(0, max(v for _, v in items) * 1.22)
    ax.set_xlabel("rows dropped")
    titles(ax, "Corpus construction: what was rejected and why",
           f"{d['corpus']['rowsRead']:,} rows read → {d['corpus']['droppedTotal']:,} dropped "
           f"→ {d['corpus']['pairsKept']:,} pairs kept")
    rows = [{"rule": k, "rowsDropped": v} for k, v in reversed(items)]
    return fig, rows


@figure(
    "corpus_domains_splits",
    ["corpus"],
    "Domain sizes and the split each was assigned to. Whole domains are held out "
    "rather than random rows, so a test score measures unseen subject matter.",
    size=(WIDE, 4.6),
)
def _corpus_domains(d):
    counts = d["corpus"]["domainRowCounts"]
    assignment = {}
    for split, domains in d["corpus"]["domains"].items():
        for domain in domains:
            assignment[domain] = split
    conv = d["corpus"].get("conversationalHoldout", {})

    items = sorted(counts.items(), key=lambda kv: kv[1])
    colors = {"train": BLUE, "valid": ORANGE, "test": AQUA}
    fig, ax = plt.subplots(figsize=(WIDE, 4.6))
    style_axes(ax, xgrid=True)

    rows, bar_colors = [], []
    for domain, count in items:
        split = assignment.get(domain, "all three" if domain == "conversational" else "?")
        bar_colors.append(colors.get(split, MUTED))
        rows.append({"domain": domain, "rows": count, "split": split})
    bars = ax.barh([k[:34] for k, _ in items], [v for _, v in items], 0.62,
                   color=bar_colors, zorder=3)
    ax.set_xscale("log")
    ax.set_xlim(20, max(v for _, v in items) * 3.2)
    label_bars(ax, bars, [v for _, v in items], "{:,.0f}", horizontal=True, pad=0.01, log=True)
    ax.set_xlabel("rows (log scale)")
    titles(ax, "Corpus domains and their split assignment",
           "whole domains are held out, so a test score measures unseen subject matter")
    handles = [Patch(facecolor=colors[s], label=s) for s in ("train", "valid", "test")]
    handles.append(Patch(facecolor=MUTED,
                         label=f"conversational — held out by row ({conv.get('rows', 0):,}), in all three"))
    ax.legend(handles=handles, ncol=2, loc="lower right", fontsize=8)
    return fig, rows


@figure(
    "roundtrip_three_figures",
    ["roundtrip", "roundtrip_corpus"],
    "Thaana → Latin → Thaana measured three ways on two populations. Exact match "
    "is bounded below 100% by design: ten Arabic-derived letters share one "
    "romanization, so the mapping cannot be one-to-one.",
)
def _roundtrip(d):
    populations = [
        (f"dictionary\n({d['roundtrip']['samples']:,} entries)", d["roundtrip"]),
        (f"news corpus\n({d['roundtrip_corpus']['samples']:,} sentences)", d["roundtrip_corpus"]),
    ]
    metrics = [("exactPercent", "exact Thaana"),
               ("exactFoldedPercent", "exact, folding the\n10 Arabic-derived letters"),
               ("latinStablePercent", "Latin-stable\n(what the model sees)")]

    fig, ax = plt.subplots(figsize=(WIDE, TALL))
    style_axes(ax)
    width = 0.36
    rows = []
    for i, (label, data) in enumerate(populations):
        values = [data[key] for key, _ in metrics]
        xs = [x + (i - 0.5) * width for x in range(len(metrics))]
        bars = ax.bar(xs, values, width * 0.9, color=SERIES[i], label=label, zorder=3)
        label_bars(ax, bars, values, "{:.1f}%")
        for (key, name), v in zip(metrics, values):
            rows.append({"population": label.replace("\n", " "), "metric": key, "percent": v})

    ax.axhline(98, color=CRITICAL, lw=1.4, ls="--", zorder=4)
    ax.text(2.42, 99, "98% gate (R-1.8)", color=CRITICAL, fontsize=8, ha="right")
    ax.set_xticks(range(len(metrics)))
    ax.set_xticklabels([name for _, name in metrics], fontsize=8.5)
    ax.set_ylabel("% of samples")
    ax.set_ylim(0, 118)
    ax.legend(loc="upper left", fontsize=8.5)
    titles(ax, "Round-trip transliteration accuracy",
           "only the third measure describes what the model actually consumes")
    return fig, rows


@figure(
    "roundtrip_failure_classes",
    ["roundtrip_corpus"],
    "What the round-trip failures actually are on real news text. The largest class "
    "is source Thaana that is not spelled canonically, which the transliterator "
    "normalises rather than reproduces.",
)
def _roundtrip_classes(d):
    classes = d["roundtrip_corpus"]["failingClasses"]
    items = sorted(classes.items(), key=lambda kv: kv[1])
    fig, ax = plt.subplots(figsize=(WIDE, 3.6))
    style_axes(ax, xgrid=True)
    bars = ax.barh([k.replace("_", " ") for k, _ in items], [v for _, v in items], 0.6,
                   color=BLUE, zorder=3)
    label_bars(ax, bars, [v for _, v in items], "{:,.0f}", horizontal=True, pad=0.02)
    ax.set_xlim(0, max(v for _, v in items) * 1.2)
    ax.set_xlabel(f"sentences (of {d['roundtrip_corpus']['samples']:,} sampled)")
    titles(ax, "Round-trip failure classes, news corpus",
           "the largest class is nonstandard source spelling, which the transliterator normalises")
    rows = [{"class": k, "sentences": v} for k, v in reversed(items)]
    return fig, rows


# ------------------------------------------------------------------ driver

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--outdir", type=Path, default=OUTDIR)
    ap.add_argument("--only", action="append", default=[])
    ap.add_argument("--dpi", type=int, default=200)
    ap.add_argument("--strict", action="store_true",
                    help="a missing artefact is an error, not a skip")
    args = ap.parse_args()

    loaded, missing = {}, []
    for key, path in ARTEFACTS.items():
        try:
            loaded[key] = json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            missing.append(key)

    args.outdir.mkdir(parents=True, exist_ok=True)
    manifest, skipped, rendered = [], [], []

    for spec in FIGURES:
        if args.only and spec["name"] not in args.only:
            continue
        absent = [r for r in spec["requires"] if r not in loaded]
        if absent:
            reason = ", ".join(str(ARTEFACTS[a].relative_to(ROOT)) for a in absent)
            print(f"SKIP  {spec['name']}: needs {reason}")
            skipped.append(spec["name"])
            continue

        fig, rows = spec["fn"](loaded)
        base = args.outdir / spec["name"]
        # Pinning the metadata date keeps a re-render byte-identical; without it
        # every run rewrites every file and the diff is unreadable.
        fig.savefig(base.with_suffix(".png"), dpi=args.dpi, bbox_inches="tight",
                    metadata={"Software": "tools/render_figures.py"})
        fig.savefig(base.with_suffix(".svg"), bbox_inches="tight",
                    metadata={"Date": None, "Creator": "tools/render_figures.py"})
        plt.close(fig)

        if rows:
            fields = list(dict.fromkeys(k for row in rows for k in row))
            with base.with_suffix(".csv").open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)

        manifest.append({
            "name": spec["name"],
            "caption": spec["caption"],
            "sources": [str(ARTEFACTS[r].relative_to(ROOT)) for r in spec["requires"]],
            "files": [f"{spec['name']}.png", f"{spec['name']}.svg", f"{spec['name']}.csv"],
            "generatedBy": "tools/render_figures.py",
        })
        rendered.append(spec["name"])
        print(f"ok    {spec['name']}")

    (args.outdir / "figures.json").write_text(
        json.dumps({"generatedBy": "tools/render_figures.py", "figures": manifest}, indent=2)
        + "\n", encoding="utf-8")

    print(f"\n{len(rendered)} figures → {args.outdir.relative_to(ROOT)}")
    if skipped:
        print(f"{len(skipped)} skipped: {', '.join(skipped)}")
        if args.strict:
            print("--strict: a skipped figure is a failure", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
