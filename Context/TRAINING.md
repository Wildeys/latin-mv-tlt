# Training

Two small T5-style **sentence-realization** models. Neither is a translator. Neither repairs word-salad glosses.

How the JSONL was built: [DATA.md](DATA.md). How the pipeline uses it: [PROJECT.md](PROJECT.md). Do not increase T5 training until lookup and conversational coverage are in [QUALITY.md](QUALITY.md).

## What the models learn

Latin Dhivehi and English only **inside** the models. Thaana exists at the user edges. Teaching T5 Thaana would add nothing; `latinToThaana` runs after inference. Dhivehi targets stay Latin: `aharen maleah dhaanan`, never Thaana.

| Model | Input | Target |
|---|---|---|
| English realization | English-valued frame string | fluent English |
| Dhivehi Latin realization | Latin-valued frame string | fluent Malé Latin |

```text
INPUT
SUBJECT=I | ACTION=go | LOCATION=Male | TENSE=future | POLARITY=affirmative | REGISTER=spoken

TARGET
I will go to Male.
```

```text
INPUT
SUBJECT=aharen | ACTION=dhaa | LOCATION=male | TENSE=future | POLARITY=affirmative | REGISTER=spoken

TARGET
aharen maleah dhaanan
```

Note `maleah`, not a bare `Male`. `REGISTER` distinguishes written Dhivehi (`eve`) from spoken. The files are **not** `Latin sentence → English sentence`, because the architecture uses frames.

Old APE degrader pairs in `dhivehi-latin-slm/data/ape/` are a supporting ablation only. Do not train the production models on `grammar: I Male go future`.

Current sizes (`data/realize/stats.json`):

```text
en_train.jsonl    14526
en_valid.jsonl     1615
dv_train.jsonl    12843
dv_valid.jsonl     1427
```

The corpus covers about sixty content words (7 subjects, 16 verbs, 12 objects, 5 locations, 7 time words). A checkpoint realizes those slots well and generalises no further than they reach.

## Colab

A laptop CPU is slow. A free Colab **T4 GPU** is the intended path. You are fine-tuning `t5-small` so it turns a **semantic frame** into a sentence — two models, two output folders:

| Run | Upload | Output folder | Used for |
|---|---|---|---|
| English | `en_train.jsonl`, `en_valid.jsonl` | `en_realize` | Dhivehi → English |
| Dhivehi Latin | `dv_train.jsonl`, `dv_valid.jsonl` | `dv_realize` | English → Dhivehi Latin |

A Colab session is temporary. If you close the tab without downloading (or saving to Drive), the work is gone.

### Before you start

- A Google account
- The four JSONL files under `latin-mv-tlt\data\realize\`
- About an hour with the browser tab left open

Do not regenerate the files after you have already uploaded them, or the Colab copy no longer matches disk.

### 1 — Upload the notebook

Upload [`colab_train_realize.ipynb`](../colab_train_realize.ipynb) to Colab (**File → Upload notebook**). It trains both models in one session. The same training loop lives in [`tools/train_t5_realize.py`](../tools/train_t5_realize.py) for a local GPU. Do not paste a second copy of the Trainer into this file.

### 2 — Turn the GPU on

**Runtime → Change runtime type → T4 GPU → Save.** First cell must print `GPU available: True`. Free Colab has a daily quota; if it refuses a T4, wait or use another account.

### 3 — Upload the JSONL

The notebook mounts Drive, then asks for the four files. After upload:

```text
  14526 en_train.jsonl
   1615 en_valid.jsonl
  12843 dv_train.jsonl
   1427 dv_valid.jsonl
```

Each line looks like:

```json
{"input": "SUBJECT=I | ACTION=go | LOCATION=Male | TENSE=future | POLARITY=affirmative | REGISTER=spoken", "target": "I will go to Male.", "direction": "en"}
```

If a line starts with `grammar:`, you uploaded the old APE pairs. Stop.

### 4 — Train

Run the notebook cells. Batch 16, fp16, 3 epochs, `t5-small`, learning rate `5e-5`. If Colab says `CUDA out of memory`, set `BATCH = 8`.

Keep the tab **open and visible**. Idle sessions die after about 90 minutes.

Both training loss and validation loss should fall. Screenshot the table for Chapter 5.

- Validation loss rising while training loss falls → overfitting. Try 2 epochs next time.
- Loss stuck near 0 from the first step → the model is copying. Check that `input` and `target` are different.

A 30-second smoke run (8 train / 2 valid rows, 1 epoch) is only a wiring check. Do not demo or evaluate a smoke checkpoint as if it were the real model.

### 5 — Sanity check

English probe:

```text
SUBJECT=I | ACTION=go | LOCATION=Male | TENSE=future | POLARITY=affirmative | REGISTER=spoken
```

Good sign: `I will go to Male.` Bad sign: the frame printed back unchanged, or empty text.

Dhivehi probe:

```text
SUBJECT=aharen | ACTION=dhaa | LOCATION=male | TENSE=future | POLARITY=affirmative | REGISTER=spoken
```

Good sign: `aharen maleah dhaanan` (or close). Not Thaana. Not a bare `Male`.

### 6 — Download

Zip `en_realize` and `dv_realize` (about 200–250 MB each). Allow pop-ups for `colab.research.google.com`. If the connection is unreliable, copy the zip to Drive first (the notebook already mounts Drive).

Extract on the laptop to:

```text
latin-mv-tlt\models\en_realize\
latin-mv-tlt\models\dv_realize\
```

You should see `model.safetensors`, `config.json`, and tokenizer files. `/models/` at the repo root is gitignored. Do not commit 200 MB PyTorch weights. Browser q8 ONNX files live in `public/models/` and **are** committed.

Record what you actually ran for Chapter 5: `t5-small`, pair counts, epochs, learning rate, batch size, fp16, **T4**.

### 7 — Use it from the website

[`src/core/realization/runner.ts`](../src/core/realization/runner.ts) loads **local** Transformers.js models from `public/models/en-realize` and `public/models/dv-realize` (q8 ONNX). The PyTorch folder `models/en_realize` is for Python checks only; it does not feed the website.

- Realization loads from `/latin-mv-tlt/models/en-realize` and `/latin-mv-tlt/models/dv-realize`
- First page load fetches the ONNX files from the same origin. After the browser cache holds them, realization can run offline.
- Breakdown still shows the frame while the models load.
- Transformers.js requires a file named `decoder_model_merged_quantized.onnx`. That is a copy of the 42 MB `decoder_model`, not the ~159 MB Optimum merge (too large for GitHub and for wasm session create).

No Hugging Face repo IDs and no `VITE_*` model env vars.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `GPU available: False` | Skipped the runtime type step | Runtime → T4 GPU |
| Cannot connect to GPU | Daily quota | Wait, or another account |
| `FileNotFoundError: en_train.jsonl` | Session restarted | Re-upload |
| `unexpected keyword 'processing_class'` | Old transformers | Re-install, then **Runtime → Restart session** |
| `CUDA out of memory` | Batch too big | `BATCH = 8` |
| Disconnected mid-run | Idle timeout | Keep the tab visible; start again from upload |
| Input starts with `grammar:` | Wrong dataset | Use `data/realize/` |
| Output is Thaana | Wrong target language | Dhivehi model targets **Latin** only |
| Fluent output far outside the slot vocabulary | Overclaiming | The corpus covers ~60 content words; say so |
| `REGISTER=` missing from an input | Stale JSONL | Re-run `build_frame_pairs.py` and re-upload |

Do not invent BLEU/chrF on the Benchmarks page until you measure them on this pipeline. Do not send native-speaker Feedback items that were produced by a smoke checkpoint.

## Ablation (later)

Compare frame realization against the old gloss-polish APE. Tokenization-study numbers stay supporting research, not the main claim. Quality cycle (lookup first, then rule realizer vs T5, conversational structures): [QUALITY.md](QUALITY.md).
