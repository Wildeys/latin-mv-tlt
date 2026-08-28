# Figures

Every chart here is generated from a committed JSON artefact by
`tools/render_figures.py`. None of them contains a number that is not also in
`evaluation/` or `data/parallel/corpus_stats.json`, so a figure cannot disagree
with the measurement it depicts.

Each figure ships three files:

| file | what it is |
|---|---|
| `<name>.png` | 200 dpi raster, for the write-up |
| `<name>.svg` | vector, for print |
| `<name>.csv` | the exact numbers plotted — the appendix table for that figure |

`figures.json` is the manifest: name, caption, and which artefacts each figure
reads. `architecture.svg` is the exception — it is hand-authored, not rendered,
and `render_figures.py` does not know it exists.

## Regenerating

```bash
# measure (virtualenv: transformers, sacrebleu)
.venv/bin/python tools/extract_notebook_metrics.py     # training curve out of the Colab notebook
.venv/bin/python tools/build_script_triples.py --with-train --n 400
.venv/bin/python tools/compare_tokenizers.py
.venv/bin/python tools/sample_test_set.py --pairs-per-group 500

# predict (node + ONNX Runtime); ~35 min single-process, ~13 min over 3 shards
for i in 0 1 2; do
  node tools/predict_onnx.mjs --in evaluation/test_sample.jsonl \
       --out evaluation/predictions.shard-$i.jsonl --shard $i/3 &
done; wait
node tools/predict_onnx.mjs --merge evaluation/predictions.shard-*.jsonl \
     --out evaluation/predictions.jsonl
node tools/predict_onnx.mjs --in evaluation/test_sample.jsonl \
     --out evaluation/predictions.jsonl --check

# score (virtualenv)
.venv/bin/python tools/evaluate.py --test evaluation/test_sample.jsonl \
  --predictions evaluation/predictions.jsonl --domain '!conversational' \
  --note "stratified 500-pair-per-direction sample of the 40,592-row test split, not the full split" \
  --out evaluation/scores.json
.venv/bin/python tools/evaluate.py --test evaluation/test_sample.jsonl \
  --predictions evaluation/predictions.jsonl --domain conversational \
  --note "row-level holdout from a register the model trains on; in-domain, not comparable to scores.json" \
  --out evaluation/scores_conversational.json
.venv/bin/python tools/build_acceptance_status.py

# render (an interpreter with matplotlib — see tools/requirements-figures.txt)
/usr/local/bin/python3 tools/render_figures.py --strict
```

`--strict` makes a missing artefact an error instead of a skip; use it for the
final pass. Re-rendering with unchanged inputs produces byte-identical files, so
`git status docs/figures/` stays clean unless a measurement actually moved.

## Reading them

**The tokenization gap** — `tokenizer_worked_example`, `tokenizer_information_loss`,
`tokenizer_tokens_per_sentence`, `pieces_per_word`. Why the pipeline romanizes
before it models. Note the hatching in `tokenizer_tokens_per_sentence`: a short
Thaana bar there is not an efficient encoding, it is a discarded sentence.

**The footprint gap** — `model_size_vs_budget`, `vocab_vs_thaana_coverage`. The
tokenizers that keep Thaana intact belong to checkpoints 17-35x past the 80 MB
budget.

**Training and accuracy** — `training_curve`, `training_loss_lr`,
`scores_by_direction`, `heldout_vs_indomain`, `latency_distribution`.
`training_curve` draws the two validation populations as separate series on
purpose; they are not comparable and averaging them would be wrong.

**Against the spec** — `acceptance_criteria`, `budget_vs_actual`.

**Corpus and transliteration** — `corpus_funnel`, `corpus_domains_splits`,
`roundtrip_three_figures`, `roundtrip_failure_classes`.
