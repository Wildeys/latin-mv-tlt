# latin-mv-tlt

Browser-only **Dhivehi–English** translation through a Latin intermediate representation.

A rule-based transliterator converts Thaana to one canonical romanization, and a single small
sequence-to-sequence model translates between that Latin and English in both directions, selected by
a task prefix. The model never sees Thaana. The LLM is optional and never sits on the translation
path. Research notes: [`Context/PROJECT.md`](Context/PROJECT.md), requirements:
[`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md).

```
Dhivehi → English
  Thaana ──[rule-based transliterator]──▶ Latin ──[T5 ONNX q8]──▶ English

English → Dhivehi
  English ──[T5 ONNX q8]──▶ Latin ──[rule-based reverse transliterator]──▶ Thaana
```

> **Status.** v0.2 replaced the v0.1 semantic-frame architecture (two sentence-realization models,
> coverage capped at ~60 content words). The application code is migrated; the translation model
> itself is **not yet trained**, so the Translator reports *Unavailable* rather than inventing a
> sentence. Transliteration, the dictionary breakdown and the IME work with no model at all. See
> [`docs/REQUIREMENTS.md` §9](docs/REQUIREMENTS.md) for the open gaps.

## Run locally

Needs **Node.js 18+** (npm comes with it). If `npm` is missing, install from https://nodejs.org and
reopen the terminal.

```sh
cd latin-mv-tlt
npm install
npm run dev
```

Open **http://localhost:5173/latin-mv-tlt/** — not the site root. `vite.config.ts` sets
`base: '/latin-mv-tlt/'` for GitHub Pages, so the dev server serves the app under that path.

Translator and Breakdown work with the files already in `public/data/`. `npm run dev` and
`npm run build` also vendor the ONNX Runtime WASM into `public/ort/` (~21 MB, gitignored) so no
translation ever depends on a third-party CDN.

## Other commands

```sh
npm test              # unit tests; touches no model and no network
npm run build         # tsc -b && vite build
npm run preview       # serve the production build at the same /latin-mv-tlt/ path
npm run check:models  # enforce the 80 MB runtime model budget
```

## Screens

Translator (main artefact) · Sentence Breakdown (viva) · Dictionary (lexicon browser) · AI Chat (demo) · Feedback · Benchmarks · About

## Deploy

`npm run build` writes static files to `dist/`. GitHub Pages hosts that folder. Pushing to `main`
runs tests, the typecheck and the model-budget gate before deploying.

## Offline pipeline

You do **not** need any of this to run the UI — the dictionary and honorifics already ship in
`public/data/`.

```sh
pip install -r tools/requirements.txt

python tools/build_translation_pairs.py     # M-1  build the parallel corpus
python tools/measure_roundtrip.py           # M-2  transliterator round-trip, gates training
python tools/profile_tokenizer.py           # M-2b tokenizer <unk> rate
#    training and export run on Colab: colab_train_translate_drive.ipynb
node tools/smoke_translate.mjs "aharen maleah dhaanan"   # check an export before the browser

# after a training run: rescue the metrics, score the model, draw the figures
python tools/extract_notebook_metrics.py    # training curve out of the notebook's cell outputs
python tools/compare_tokenizers.py          # what each tokenizer does to Thaana / Latin / English
python tools/sample_test_set.py             # the committed scoring sample
npm run predict -- --in evaluation/test_sample.jsonl --out evaluation/predictions.jsonl
python tools/evaluate.py --test evaluation/test_sample.jsonl \
    --predictions evaluation/predictions.jsonl --domain '!conversational'
python tools/build_acceptance_status.py
python tools/render_figures.py --strict     # needs matplotlib; see tools/requirements-figures.txt
```

The figure set lands in [`docs/figures/`](docs/figures/) — PNG, SVG and a CSV of the exact
plotted numbers per chart. See [`docs/figures/README.md`](docs/figures/README.md) for the full
regeneration sequence, including how to shard the prediction run.

The corpus builder and round-trip tool call the project's **own** TypeScript transliterator through
`tools/transliterate.mjs`, so training-time and inference-time Latin are produced by the same code.
That is also why they run locally rather than on Colab — they need Node.

- Design: [`docs/DESIGN.md`](docs/DESIGN.md)
- Figures: [`docs/figures/README.md`](docs/figures/README.md)
- Dictionary: [`Context/DATA.md`](Context/DATA.md)
- Training: [`Context/TRAINING.md`](Context/TRAINING.md)
- Measured state: [`Context/STATUS.md`](Context/STATUS.md)
- Known issues: [`Context/QUALITY.md`](Context/QUALITY.md)
