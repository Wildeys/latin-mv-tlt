# Training

One small T5 **translation** model, both directions from one set of weights, selected by a task
prefix. It is not two models, and it does not see Thaana.

How the JSONL was built: [DATA.md](DATA.md). How the pipeline uses it: [PROJECT.md](PROJECT.md).
Measured state: [STATUS.md](STATUS.md). Known gaps: [QUALITY.md](QUALITY.md).

> **v0.2.** This replaces the v0.1 semantic-frame architecture — two sentence-realization models,
> coverage capped at about sixty content words. `data/realize/`, `build_frame_pairs.py`,
> `train_t5_realize.py` and `colab_train_realize.ipynb` are gone (M-8a). If a document tells you to
> upload `en_train.jsonl`, it is describing v0.1.

## What the model learns

Latin Dhivehi and English only. Thaana exists at the user edges: the rule-based transliterator runs
before inference on the way in, and `latinToThaana` runs after it on the way out. Dhivehi targets
stay Latin — `aharen maleah dhaanan`, never Thaana. A Thaana character in a model input is an
architecture violation, and the notebook asserts against it.

| Direction | Prefix | Target |
|---|---|---|
| `dv-en` | `translate Dhivehi Latin to English: ` | English |
| `en-dv` | `translate English to Dhivehi Latin: ` | Malé Latin |

Each line of `data/parallel/*.jsonl`:

```json
{"input": "translate Dhivehi Latin to English: aharen maleah dhaanan", "target": "I will go to Male.", "direction": "dv-en", "provenance": {"source": "alakxender/dhivehi-english-translations", "domain": "crime", "synthetic": false}}
```

Every kept pair is written twice, once per direction. If a line starts with `SUBJECT=` or
`grammar:`, you are holding a v0.1 file.

## Corpus

Built by `tools/build_translation_pairs.py` (M-1). Full numbers in
[`data/parallel/corpus_stats.json`](../data/parallel/corpus_stats.json), which **is** committed —
the JSONL is not (R-2.1b, and `train.jsonl` alone is 189 MB).

```text
train.jsonl   480,018 rows
valid.jsonl    49,948 rows
test.jsonl     40,592 rows
```

285,748 pairs kept from 575,892 rows read, over the Stage 2 target of 200k. The splits hold out
**whole domains** (R-2.6, R-8.8), so validation and test scores are out-of-domain:

| Split | Domains |
|---|---|
| train | `crime`, `local news`, `politics`, `other`, the `alakxender/dhivehi-english-parallel` bulk |
| valid | `business`, `international`, `sports` |
| test | `education`, `entertainment`, `environment`, `health`, `law`, `religion`, `society`, `technology`, `tourism` |

The `conversational` group is the exception: it is held out **by row**, so it appears in all three
splits (76,830 / 2,984 / 2,990 rows). Scores on those rows are in-domain and are not comparable to
the news splits. Report them separately or the number is inflated.

## Gates — both already pass

Run before training, not after. Neither needs a GPU; both need Node, because they call the
project's own TypeScript transliterator through `tools/transliterate.mjs` (R-2.2).

| Gate | Command | Threshold | Measured |
|---|---|---|---|
| M-2 round-trip | `python tools/measure_roundtrip.py` | ≥ 98% Latin-stable | **99.8%** ([`roundtrip_stats_corpus.json`](../evaluation/roundtrip_stats_corpus.json)) |
| M-2b tokenizer | `python tools/profile_tokenizer.py` | ≤ 5% `<unk>` | **0.0%**, 5.697 pieces/word ([`tokenizer_profile.json`](../evaluation/tokenizer_profile.json)) |

Round-trip accuracy caps achievable quality — the model cannot beat the Latin it is trained on. Do
not raise training scale to paper over a failing gate.

## Hyperparameters

`tools/train_translate.py` defaults, from R-9.2. Do not pass them again on the command line and do
not drift from them silently.

| | Value | Why |
|---|---|---|
| base model | `t5-small` | 60M; `google/flan-t5-small` via `--model` |
| epochs | 4 | R-9.2 allows 3–5 |
| batch | 32 | t5-small at len 128 fp16 on a T4. 8–16 for `flan-t5-base` |
| learning rate | `1e-4` | not v0.1's `5e-5`. `3e-4` only as a recorded ablation |
| weight decay | `0.01` | v0.1 never set it and silently used the HF default |
| max length | 128 | R-3.5 |
| seed | 11 | same seed as the corpus split |
| fp16 | when CUDA is present | `torch.cuda.is_available()`; CPU runs fp32 |
| beams | 1, greedy | matches inference (R-3.5) |

Two behaviours worth knowing:

- **Best checkpoint, not last.** `load_best_model_at_end=True` on `metric_for_best_model="chrf"`.
  Without it, `save_model()` keeps the final epoch, so an overfitting run ships its worst weights.
- **Metrics per direction.** BLEU and chrF++ are computed for `dv-en` and `en-dv` separately as
  well as overall (R-8.4). One mixed average can look acceptable while a direction has collapsed.
  chrF++ is `sacrebleu.CHRF(word_order=2)` — bare `CHRF()` is chrF, a different metric.

## Where to run it

**Not on the laptop.** The dev machine is a 2016 MacBook Pro: Intel i7-6567U, 2 cores, Iris 550
integrated graphics — no CUDA, and no MPS either. `pip install -r tools/requirements-train.txt`
fails outright, because `torch>=2.4` has no x86_64 macOS wheel (PyTorch stopped shipping Intel Mac
builds after 2.2.2). Even pinned to `torch==2.2.2` it is fp32 on two cores: on the order of 40–80
hours *per epoch*, so one to two weeks for the four. A free Colab **T4** does the same run in about
three hours.

A local smoke run is still worth it before spending a Colab session. Point it at a slice —
`PairDataset` parses all 480k rows before `--smoke` truncates them:

```sh
head -n 2000 data/parallel/train.jsonl > /tmp/train_tiny.jsonl
head -n 200  data/parallel/valid.jsonl > /tmp/valid_tiny.jsonl
python tools/train_translate.py --train /tmp/train_tiny.jsonl --valid /tmp/valid_tiny.jsonl \
    --out /tmp/smoke --smoke
```

R-8.3: a smoke checkpoint is a wiring check. Never demo or evaluate one as a result, and never send
Feedback items produced by one.

## Colab (M-3, M-4)

[`colab_train_translate.ipynb`](../colab_train_translate.ipynb) trains **and** exports in one
session. It clones the repo rather than pasting the trainer inline — a notebook copy is a second
implementation to keep in sync, which is exactly what went wrong in v0.1.

A Colab session is temporary. Nothing survives closing the tab unless it reached Drive or your
disk.

### 1 — GPU

**Runtime → Change runtime type → T4 GPU → Save.** The first cell asserts and prints the device
name. Free Colab has a daily quota; if it refuses a T4, wait or use another account.

### 2 — Get the corpus in

The JSONL is gitignored, so cloning does not bring it. **Upload `train.jsonl` and `valid.jsonl` to
Drive from your browser first** — `files.upload()` stalls or dies at 189 MB — then replace the
upload cell with:

```python
from google.colab import drive; drive.mount('/content/drive')
!cp /content/drive/MyDrive/train.jsonl /content/drive/MyDrive/valid_small.jsonl data/parallel/
```

Do not rebuild the corpus after uploading, or the Colab copy no longer matches disk.

### 3 — Subsample the validation set

`predict_with_generate=True` generates over the whole validation set every epoch. At 49,948 rows
that is 30–50 minutes per epoch on top of training, and the run outlives the session. Cut a seeded
subset locally, keeping both directions, and keep the full file for final scoring:

```sh
python3 - <<'EOF'
import json, random
rows = [json.loads(l) for l in open('data/parallel/valid.jsonl', encoding='utf-8') if l.strip()]
random.Random(11).shuffle(rows)
keep = {'dv-en': [], 'en-dv': []}
for r in rows:
    if len(keep[r['direction']]) < 1000: keep[r['direction']].append(r)
with open('data/parallel/valid_small.jsonl', 'w', encoding='utf-8') as f:
    for r in keep['dv-en'] + keep['en-dv']: f.write(json.dumps(r, ensure_ascii=False) + '\n')
EOF
```

2,000 rows is well clear of the ≥500-per-direction floor `tools/evaluate.py` enforces (R-8.9), so
best-checkpoint selection stays meaningful.

### 4 — Verify before training

The corpus cell asserts *properties*, not hard-coded line counts — the prefix is present, both
directions appear, no Thaana reached a model input, and no validation input also appears in train.
It is the cheapest place to catch a bad upload. Do not skip it.

### 5 — Train

```sh
python tools/train_translate.py \
    --train data/parallel/train.jsonl \
    --valid data/parallel/valid_small.jsonl \
    --out models/dv-en-translate \
    --model t5-small --epochs 4 --batch 32 --lr 1e-4
```

`BATCH = 16` or `8` on `CUDA out of memory`. Keep the tab open and visible; idle sessions die after
about 90 minutes. Roughly 15,000 steps per epoch.

Both losses should fall and chrF++ should rise. Screenshot the per-epoch table — it is the evidence
that the checkpoint was selected on a metric rather than on the last epoch, and it goes in the
write-up along with `t5-small`, the pair counts, epochs, learning rate, batch size, fp16 and **T4**.

- Validation metric peaks early and then decays → overfitting. `--epochs 3`.
- Loss near zero from the first step → the model is copying. Check `input` and `target` differ.
- One direction's chrF++ far below the other → do not report the mixed average alone.

### 6 — Probe

```text
translate Dhivehi Latin to English: aharen maleah dhaanan
translate English to Dhivehi Latin: I will go to Male.
```

Good: fluent English, and Latin Dhivehi carrying the dative — `maleah`, not a bare `male`. Bad: the
prefixed input echoed back, empty output, or Thaana.

### 7 — Export to ONNX INT8 (M-4)

```sh
python tools/export_onnx.py --model models/dv-en-translate --out public/models/dv-en-translate
```

The cell v0.1 never had, which is how 307 MB of hand-made models ended up holding ~162 MB of graphs
the runtime never loads. It asserts at every step and **refuses to write** rather than ship
something that fails in the browser:

- the merged decoder really exposes `use_cache_branch`, which is what makes the old `runBeam`
  monkey-patch unnecessary;
- each quantized graph actually shrank — `quantize_dynamic` skips `If` subgraphs without
  `extra_options={"EnableSubgraph": True}` and leaves the file fp32 inside at ~160 MB;
- the total is inside the **80 MB** budget (R-3.4), scoped to the model directory. The ONNX Runtime
  WASM (~21 MB) is counted separately.

Budget gate fails → the contingency ladder is in the error message and in REQUIREMENTS.md R-3.2.
Vocabulary trimming is the big win and must happen *before* retraining. Do not skip past it.

Runtime files are exactly what transformers.js fetches: `config.json`, tokenizer files,
`encoder_model_quantized.onnx`, `decoder_model_merged_quantized.onnx`. Nothing else ships.

### 8 — Download and verify

Zip to Drive, then to disk. Extract into `public/models/dv-en-translate/`, then:

```sh
node tools/smoke_translate.mjs 'aharen maleah dhaanan'   # the export under Node
npm run check:models                                     # the same 80 MB gate CI runs
npm run dev                                              # the only check that exercises WASM
```

`/models/` at the repo root is gitignored — it holds PyTorch weights for Python checks only and
does not feed the website. `public/models/dv-en-translate` **is** committed. Do not commit 200 MB
safetensors.

Only after the browser check is the v0.2 model verified, and only then does M-8b delete the v0.1
`public/models/{en,dv}-realize` (307 MB). Deleting them earlier leaves the app with no model path
at all.

## Then

M-9 extends the gold set to ≥500 verified pairs per direction from a held-out domain. M-10 scores
it and publishes:

```sh
python tools/evaluate.py --test data/parallel/test.jsonl --predictions preds.jsonl
```

Do not put BLEU or chrF++ on the Benchmarks page until they were measured on this pipeline. Until
then the Translator reports *Unavailable*, and the page says the numbers are unmeasured.

M-11 is Stage 2: back-translation, corpus growth, retrain, compare against this baseline.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `No GPU` assertion | Skipped the runtime type step | Runtime → T4 GPU |
| Cannot connect to a GPU | Daily quota | Wait, or another account |
| `FileNotFoundError: train.jsonl` | Session restarted, or the clone had no JSONL | Re-copy from Drive |
| `unexpected keyword 'processing_class'` | transformers < 4.46 | Re-install, then **Runtime → Restart session** |
| `CUDA out of memory` | Batch too big | `BATCH = 8` |
| Disconnected mid-run | Idle timeout | Keep the tab visible; start again from the copy step |
| `Thaana reached the model input` | Corpus built without the transliterator step | Re-run `build_translation_pairs.py` |
| Input starts with `SUBJECT=` | v0.1 frame pairs | Use `data/parallel/` |
| Output is Thaana | Wrong target language | The Dhivehi side targets **Latin** only |
| `torch` will not install on the Mac | No x86_64 macOS wheel above 2.2.2 | Train on Colab |
| Export writes nothing | 80 MB budget gate | Read the error; trim vocabulary before retraining |
