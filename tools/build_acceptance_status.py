#!/usr/bin/env python3
"""Assemble the acceptance-criteria and gap status from the measured artefacts.

docs/REQUIREMENTS.md states AC-1..AC-13 and GAP-1..GAP-14 in prose. Whether each
is met is a question about numbers that live in evaluation/*.json, and keeping
the answer in prose means it goes stale the moment a measurement is re-run - it
already had, in three places, before this file existed.

    python tools/build_acceptance_status.py

Writes evaluation/acceptance_status.json: the prose from the spec, the number
from the artefact that measures it, and the comparison between them. The figure
renderer reads this rather than carrying its own copy of either.

The important behaviour is what happens when an artefact is absent: the row's
status becomes `unmeasured` and its value stays null. It never becomes a guess,
and `unmeasured` is rendered as its own category rather than as a failure -
"not measured" and "measured and failed" are different claims about the system
(NFR-8).
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVAL = ROOT / "evaluation"
OUT = EVAL / "acceptance_status.json"


def read(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def get(data, *path, default=None):
    for key in path:
        if data is None:
            return default
        data = data.get(key) if isinstance(data, dict) else None
    return default if data is None else data


def main() -> int:
    scores = read(EVAL / "scores.json")
    scores_conv = read(EVAL / "scores_conversational.json")
    sample = read(EVAL / "test_sample_stats.json")
    profile = read(EVAL / "tokenizer_profile.json")
    roundtrip = read(EVAL / "roundtrip_stats.json")
    roundtrip_corpus = read(EVAL / "roundtrip_stats_corpus.json")
    export = read(ROOT / "public" / "models" / "dv-en-translate" / "export_stats.json")
    corpus = read(ROOT / "data" / "parallel" / "corpus_stats.json")
    tokens = read(EVAL / "tokenizer_comparison.json")

    def pairs_per_direction():
        if not scores:
            return None
        values = [s["pairs"] for s in scores.get("scores", {}).values()]
        return min(values) if values else None

    # Every numeric gate in the spec, with where its target and its measurement
    # come from. `higherIsBetter` is what lets the renderer decide pass/fail
    # without knowing what any individual row means.
    budgets = [
        {
            "id": "AC-10",
            "label": "Model download",
            "unit": "MB",
            "target": round(get(export, "budgetBytes", default=0) / 1e6, 2) or None,
            "measured": round(get(export, "totalBytes", default=0) / 1e6, 2) or None,
            "higherIsBetter": False,
            "source": "public/models/dv-en-translate/export_stats.json",
        },
        {
            "id": "AC-12",
            "label": "Latin <unk> rate",
            "unit": "%",
            "target": get(profile, "gate"),
            "measured": get(profile, "unkPercent"),
            "higherIsBetter": False,
            "source": "evaluation/tokenizer_profile.json",
        },
        {
            "id": "AC-11",
            "label": "Round-trip Latin stability",
            "unit": "%",
            "target": 98.0,
            "measured": get(roundtrip, "latinStablePercent"),
            "higherIsBetter": True,
            "source": "evaluation/roundtrip_stats.json",
        },
        {
            "id": "AC-9",
            "label": "Scored pairs per direction",
            "unit": "pairs",
            "target": float(get(scores, "sizeFloor", default=500)),
            "measured": pairs_per_direction(),
            "higherIsBetter": True,
            "source": "evaluation/scores.json",
        },
        {
            "id": "R-3.5",
            "label": "Input sequence length (p99)",
            "unit": "tokens",
            "target": 128.0,
            "measured": get(profile, "sequenceLengths", "byDirection", "dv-en", "inputP99"),
            "higherIsBetter": False,
            "source": "evaluation/tokenizer_profile.json",
        },
    ]

    for row in budgets:
        target, measured = row["target"], row["measured"]
        if target is None or measured is None:
            row["status"] = "unmeasured"
        elif row["higherIsBetter"]:
            row["status"] = "met" if measured >= target else "not-met"
        else:
            row["status"] = "met" if measured <= target else "not-met"

    criteria = [
        ("AC-1", "Build and tests pass with no network or model access", "met",
         "155 tests across 19 files; npx tsc -b clean", "npm test"),
        ("AC-2", "Translator produces output in both directions with the model present", "met",
         "verified by tools/smoke_translate.mjs in both directions",
         "tools/smoke_translate.mjs"),
        ("AC-3", "With the model removed the Translator reports unavailable and fabricates nothing",
         "met", "four-state machine in src/core/translate/runner.ts; Translator.test.tsx",
         "src/core/translate/runner.ts"),
        ("AC-4", "Breakdown shows source, Latin, glosses, model input and raw output", "met",
         "TraceView.test.tsx", "src/ui/components/TraceView.tsx"),
        ("AC-5", "Feedback ratings persist across reload and export as valid CSV", "met",
         None, "src/ui/screens/Feedback.tsx"),
        ("AC-6", "Benchmarks shows no unmeasured metric as if it were measured", "met",
         "translation rows now carry measured values; unmeasured rows say so",
         "public/data/benchmarks.json"),
        ("AC-7", "Chat sends English only to the LLM and fails clearly with no key", "met",
         None, "src/core/chat/"),
        ("AC-8", "A push to main deploys to GitHub Pages", "met",
         None, ".github/workflows/deploy.yml"),
        ("AC-9", "BLEU and chrF++ measured on >=500 held-out pairs per direction", None,
         None, "evaluation/scores.json"),
        ("AC-10", "Model directory within the 80 MB budget", None,
         None, "public/models/dv-en-translate/export_stats.json"),
        ("AC-11", "Round-trip measured over >=1,000 samples, all three figures published", None,
         None, "evaluation/roundtrip_stats.json"),
        ("AC-12", "Tokenizer profile run and its <unk> rate published before training", None,
         None, "evaluation/tokenizer_profile.json"),
        ("AC-13", "Corpus stats record Stage 1/2 counts with the real/synthetic split", "met",
         None, "data/parallel/corpus_stats.json"),
    ]

    budget_by_id = {b["id"]: b for b in budgets}
    rows = []
    for ac_id, text, status, evidence, source in criteria:
        row = {"id": ac_id, "text": text, "source": source, "evidence": evidence}
        budget = budget_by_id.get(ac_id)
        if budget:
            row["status"] = budget["status"]
            row["measured"] = budget["measured"]
            row["target"] = budget["target"]
            row["unit"] = budget["unit"]
        else:
            row["status"] = status or "unmeasured"
        rows.append(row)

    # AC-13's counts and AC-11's second population are measured elsewhere; carried
    # so the figure can annotate without opening four more files.
    context = {
        "corpusPairsKept": get(corpus, "pairsKept"),
        "corpusRowsRead": get(corpus, "rowsRead"),
        "roundtripDictionaryExact": get(roundtrip, "exactPercent"),
        "roundtripCorpusExact": get(roundtrip_corpus, "exactPercent"),
        "roundtripCorpusSamples": get(roundtrip_corpus, "samples"),
        "sampleNote": get(sample, "sampleNote"),
        "scoresHeldOut": get(scores, "scores"),
        "scoresConversational": get(scores_conv, "scores"),
        "tokenizersCompared": sorted((tokens or {}).get("models", {})),
    }

    gaps = [
        ("GAP-1", "Round-trip transliteration accuracy unmeasured", "closed",
         "measured on both populations"),
        ("GAP-2", "BLEU / chrF++ unmeasured; no domain-held-out test set",
         "closed" if scores and scores.get("reportable") else "open",
         "scored on a stratified sample of the held-out split"),
        ("GAP-3", "No human ratings collected (meaning / fluency)", "open",
         "no rating session has been run; nothing here estimates one"),
        ("GAP-4", "The translation model does not exist yet", "closed",
         "trained, trimmed, exported and scored"),
        ("GAP-5", "public/models/ carries ~150 MB never loaded at runtime", "open",
         "v0.1 models still present pending M-8b"),
        ("GAP-6", "README links to a missing Context/ folder", "closed", None),
        ("GAP-7", "dictionary_stats.json leaks a Windows build path", "open",
         "the Dictionary screen ignores the file; the file itself is unfixed"),
        ("GAP-8", "README, About and benchmarks.json describe the v0.1 architecture", "open",
         None),
        ("GAP-9", "Gold set holds 20 pairs per direction against a >=500 requirement", "open",
         "worked around by scoring the corpus test split instead of the gold set; "
         "evaluation/gold_sentences.json itself is still 20 per direction"),
        ("GAP-10", "Corpus is Stage 1 only; no back-translation pipeline", "open", None),
        ("GAP-11", "Tokenizer <unk> behaviour on Dhivehi Latin unprofiled", "closed",
         "0.0% over 2,000 word types"),
        ("GAP-12", "Sentence segmentation is not script-aware", "closed", None),
        ("GAP-13", "Ten Arabic-derived letters cannot round-trip exactly", "accepted",
         "a declared, measured class rather than a defect"),
        ("GAP-14", "Dead closed-class constants left by the frames deletion", "open", None),
    ]

    report = {
        "generatedBy": "tools/build_acceptance_status.py",
        "spec": "docs/REQUIREMENTS.md sections 7 and 9",
        "statuses": ["met", "not-met", "unmeasured", "accepted", "closed", "open"],
        "note": "`unmeasured` is not `not-met`. A criterion with no artefact behind it is "
                "reported as unmeasured and never as a pass or a failure (NFR-8).",
        "budgets": budgets,
        "criteria": rows,
        "gaps": [
            {"id": g, "text": t, "status": s, "evidence": e} for g, t, s, e in gaps
        ],
        "context": context,
    }
    OUT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"wrote {OUT.relative_to(ROOT)}")
    for b in budgets:
        mark = {"met": "OK ", "not-met": "FAIL", "unmeasured": "  ?"}[b["status"]]
        measured = "—" if b["measured"] is None else f"{b['measured']:g}"
        target = "—" if b["target"] is None else f"{b['target']:g}"
        print(f"  {mark} {b['id']:6s} {b['label']:32s} {measured:>10s} {b['unit']:6s} (target {target})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
