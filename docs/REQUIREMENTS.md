# latin-mv-tlt — Project Requirements Specification

**Version 0.2.3** · Status: draft · Supersedes v0.1 · Applies to repository version `0.2.0`

> **Revision 0.2.1 (2026-08-26).** Incorporates the external review in
> [`docs/v2_review.md`](v2_review.md). Changes: the training learning rate is
> lowered (R-9.2), the corpus is staged with an explicit Stage 2 target
> (R-2.1b, R-2.10), NLLB adoption must estimate size before training (R-3.3),
> the T5-small size estimate is corrected upward (R-3.2), round-trip accuracy
> and held-out test-set size are given concrete metric definitions (R-1.8,
> R-8.9), and four requirements are added for tokenizer profiling (R-9.6),
> script-aware segmentation (R-5.7), and a low-confidence indicator (R-6.11).

> **Revision 0.2.2 (2026-08-26).** Amendments forced by implementing the §8
> migration. Each is a case where the spec as written was unachievable, factually
> wrong about the runtime, or ambiguous enough that two readings produce
> different code. They are listed with their evidence at **§11**.

> **Revision 0.2.3 (2026-08-27).** Adds **R-5.8**, a single-definition rule for
> word tokenization, after a defect sweep found three divergent tokenizers in the
> codebase. Unlike the 0.2.2 amendments, this is a genuinely *new* requirement
> rather than a correction to an existing one: nothing in the spec had ever said
> where a word begins, so no implementation was in breach and no test could fail.
> Recorded at **§11.1**.

> **Change of architecture.** v0.1 specified translation through a semantic
> frame with two sentence-realization models. v0.2 replaces that with a single
> direct **Dhivehi Latin ↔ English** seq2seq model, keeping the rule-based
> transliterator as the pivot into and out of Thaana. The rationale, and the
> full v0.1 frame requirements, are retained in **Appendix A** — the approach is
> superseded, not erased, and remains defensible as prior work.

Every requirement here is traceable to a module, a data artefact, or a test.
Requirements marked **Planned** are not yet satisfied and are stated as such
rather than presented as done. Requirements marked **Retired** describe
behaviour being removed under this revision.

---

## 1. Purpose and scope

### 1.1 Problem statement

Dhivehi is a low-resource language. General-purpose models tokenize Thaana
poorly or treat it as unknown, and a translator that assumes a cloud LLM cannot
be relied on offline. This project tests whether **a consistent Latin
intermediate representation makes a small browser-sized model viable for
Dhivehi↔English translation** — by removing Thaana Unicode and its segmentation
from the model's problem entirely, and handing the model ASCII, space-delimited
text in one canonical romanization.

The Latin-IR hypothesis is unchanged from v0.1. What changes is what consumes
the Latin: a direct translation model rather than a frame extractor plus two
realization models.

### 1.2 Product scope

`latin-mv-tlt` is a **browser-only, static** Dhivehi↔English translator. It must
run from a static file host with no application server and no mandatory network
call at translation time. An external LLM is an **optional** demonstration and
must never sit on the required translation path.

### 1.3 Out of scope

- Server-side APIs, accounts, or a hosted database.
- Speech, OCR, or document translation.
- Training in the browser — training is offline (Colab / local GPU).
- Neural transliteration. Thaana↔Latin stays rule-based (see §3.1, R-1).
- Full honorific *generation* — honorifics are recognised and may tag output.
- Long-form text; the unit of translation remains the sentence.

### 1.4 Stakeholders

| Stakeholder | Interest |
|---|---|
| Project author | Deliver and defend a working research artefact (viva) |
| Examiner / supervisor | Inspect method and measured evidence, not just output |
| Dhivehi-speaking evaluators | Rate adequacy and fluency; check Latin is spellable |
| End user (demo) | Translate a sentence, optionally see how it was derived |

---

## 2. System overview

```
Dhivehi → English
  Thaana ──[rule-based transliterator]──▶ Latin ──[T5 ONNX q8]──▶ English
                                            │
                                            └──[dictionary + morphology]──▶ word glosses (Breakdown)

English → Dhivehi
  English ──[T5 ONNX q8]──▶ Latin ──[rule-based reverse transliterator]──▶ Thaana
```

One neural model, two task prefixes, both directions. The transliterator is
deterministic and runs with zero model download; it is also the tool that
normalises the **training corpus**, so training-time and inference-time Latin
are produced by the same code path (R-2.2).

### 2.1 Architectural decision record

| | v0.1 (superseded) | v0.2 (current) |
|---|---|---|
| Neural components | 2 (`en-realize`, `dv-realize`) | 1 (`dv-en-translate`) |
| Coverage | ~60 slot-vocabulary content words | Open-domain, corpus-limited |
| Training data | ~16k/14k synthetic combinatorial pairs | ~92k real parallel pairs (Stage 1); ≥200k target (Stage 2) |
| Runtime download | ~148 MB (both directions) | ≤80 MB target |
| Repo weight | 307 MB tracked ONNX | ≤80 MB tracked ONNX |
| Failure mode | Out-of-vocabulary → unavailable | Out-of-domain → degraded quality |

**Decision:** the frame pipeline is a controlled-language demonstration. Its
slot vocabulary (7 subjects, 16 verbs, 12 objects, 5 locations, 7 times) means
any sentence outside that inventory cannot be translated at all. A direct model
trained on real parallel text generalises, is smaller, and is simpler to
maintain. Recorded 2026-08-25 following the review in `docs/Sakana.md`.

**Accepted cost:** the frame representation was the project's distinctive
research contribution. v0.2 trades it for coverage. Appendix A preserves it so
the trade-off can be argued rather than hidden.

---

## 3. Functional requirements

### 3.1 Transliteration — now the system's backbone (`src/core/transliterator/`)

| ID | Requirement | Priority |
|---|---|---|
| R-1.1 | Thaana→Latin and Latin→Thaana shall remain **rule-based, deterministic, synchronous, and dependency-free**. No neural transliteration model shall be introduced. | Must |
| R-1.2 | The system shall define **exactly one** canonical romanization convention. Alternative spellings of the same Thaana sequence shall not exist in any artefact the model sees. | Must |
| R-1.3 | Latin→Thaana shall report which input segments were **preserved** (passed through unconverted) rather than dropping them silently. | Must |
| R-1.4 | Transliteration shall work before any model has loaded, so the Latin view is available even when the translator is unavailable. | Must |
| R-1.5 | **Loanword policy:** the transliterator shall emit consistent *phonetic* Latin (`އިންސްޓަގްރާމް` → `instagraam`), not English orthography. Consistency at training time takes precedence over prettiness. | Must |
| R-1.6 | **Planned** — An optional display-layer loanword dictionary may prettify Latin shown to users (`instagraam` → `Instagram`). It shall apply only at the UI layer and shall never touch model input or training data. | Could |
| R-1.7 | A Thaana IME shall let a user type Latin keys and receive Thaana in place, with correct caret handling and backspace over a composing sequence. | Must |
| R-1.8 | Round-trip stability shall be measured on a held-out sample of ≥1,000 Thaana words or sentences, reporting **three** figures with the failing classes listed: (a) **exact** Thaana match; (b) **exact after folding** the ten many-to-one Arabic-derived letters; (c) **Latin-stable** — whether the round-tripped Thaana reads out to the *same Latin*. Levenshtein distance is secondary. **(c) is the gated figure, at ≥98%**, because the model only ever sees the Latin, so Latin stability is what actually bounds training quality (§6.8). Falling short is a transliterator defect to fix before corpus construction, not an accepted baseline. | Must |

Traceability: `mappings.ts`, `thaanaToLatin.ts`, `latinToThaana.ts`,
`useThaanaIme.ts`; tests `transliterator.test.ts`, `useThaanaIme.test.ts`.

> R-1.5 is counter-intuitive and deliberate. If the corpus is normalised with
> the same rules used at inference, `instagraam` is a stable token the model can
> learn to map to `Instagram`. Emitting "correct" English spellings for some
> loanwords and phonetic Latin for others reintroduces exactly the spelling
> inconsistency R-1.2 exists to eliminate.

### 3.2 Corpus construction (`tools/`, `data/`)

| ID | Requirement | Priority |
|---|---|---|
| R-2.1 | **Planned** — Training data shall be built from existing Dhivehi–English parallel corpora, at minimum `alakxender/dhivehi-english-translations` (~92k news pairs), optionally `alakxender/dhivehi-english-parallel`. | Must |
| R-2.1b | **Planned** — **Corpus staging.** Stage 1 shall use the available ~90k real parallel pairs as a **baseline**, not as the final corpus. Stage 2 shall target **≥200k total pairs** through back-translation (R-2.10) or domain-specific mining, with the augmentation strategy, the real/synthetic ratio, and the resulting counts recorded in the stats file (R-2.7). | Must |
| R-2.2 | **Planned** — All Thaana in the corpus shall be converted to Latin using **the project's own transliterator**, not a third-party romanizer, so training and inference Latin are byte-identical in convention. | Must |
| R-2.3 | **Planned** — Pairs shall be deduplicated (exact and near-duplicate) before splitting. | Must |
| R-2.4 | **Planned** — Pairs with extreme source/target length ratios shall be filtered out as probable alignment errors. Starting threshold: ratios outside **[0.4, 2.5]** shall be flagged, with the final threshold fixed and recorded after corpus analysis. The threshold and the number dropped shall be recorded. | Must |
| R-2.5 | **Planned** — Both directions shall be emitted with explicit T5 task prefixes, pinned to the exact literals **`translate Dhivehi Latin to English: `** and **`translate English to Dhivehi Latin: `** — the trailing `": "` is part of the prefix. Direction shall never be left implicit. The literals shall have a **single definition** (`src/core/translate/prefixes.ts`), read by both the app and the corpus builder rather than restated in each. | Must |
| R-2.6 | **Planned** — Splits shall be **by domain or source**, not random, so evaluation measures generalisation rather than memorisation. | Must |
| R-2.7 | **Planned** — The build script shall record corpus provenance, filter counts, split sizes, and vocabulary statistics to a committed stats file, as `tools/clean_dictionary.py` does for the dictionary. | Must |
| R-2.8 | Untrustworthy rows shall be quarantined to a file, not deleted. | Must |
| R-2.9 | The application shall run without regenerating any data; shipped artefacts in `public/data/` are sufficient to start the UI. | Must |
| R-2.10 | **Planned** — **Back-translation.** A back-translation pipeline shall augment the corpus toward the R-2.1b target using a larger pre-trained model (e.g. NLLB-200 or MADLAD-400) over monolingual Dhivehi and English text. Synthetic pairs shall be labelled with **provenance** so they are separable from real pairs, filtered for length-ratio quality (R-2.4) before inclusion, and **excluded from the held-out test set** (R-8.8, R-8.9). | Should |

Retired: the combinatorial frame-pair generator (`tools/build_frame_pairs.py`)
and `data/realize/*.jsonl`. See Appendix A.

Dictionary cleaning (R-2.7's precedent) is already met: 16,014 raw rows →
**15,302** exported entries, 585 inverted entries flipped, 403 mirror glosses
fixed, 26 quarantined (`public/data/dictionary_stats.json`).

### 3.3 Translation model (`src/core/translate/` — **Planned**)

| ID | Requirement | Priority |
|---|---|---|
| R-3.1 | **Planned** — A single seq2seq model shall handle both directions, selected by task prefix. Two separate models shall not be shipped. | Must |
| R-3.2 | **Planned** — Baseline architecture shall be `t5-small` (or `google/flan-t5-small`), INT8-quantized ONNX. Realistic size estimate: encoder ~35 MB + merged decoder ~42 MB + tokenizer ~2.4 MB ≈ **80 MB** — at, not under, the R-3.4 budget. The earlier ~60 MB figure was optimistic. | Must |
| R-3.3 | **Planned** — `facebook/nllb-200-distilled-600M` shall be evaluated as an alternative, since NLLB includes Dhivehi. The evaluation shall begin with a **preliminary exported-size estimate, before any training run**. At 600M parameters, INT8 encoder + merged decoder is expected to land at **~120–150 MB minimum**, before tokenizer and config — so it very likely breaks R-3.4. Adoption therefore requires either a measured export meeting R-3.4, or an explicit recorded decision that **NFR-13 and AC-10 are forfeited**. Deferring the size question to "we will quantize it later" is not an acceptable path. | Should |
| R-3.4 | **Planned** — **Size budget: ≤80 MB total INT8** for the model directory `public/models/dv-en-translate/**`, across both directions. The ONNX Runtime WASM (~21 MB) and the application bundle sit **outside** this budget and are reported as separate measured line items. The scoping is load-bearing: read as "everything fetched at runtime", the budget is unachievable at *any* model size, because the runtime alone is 21 MB. | Must |
| R-3.5 | **Planned** — Max sequence length 128; inference shall use greedy decoding or beam ≤2. | Must |
| R-3.6 | Models shall load **locally only** — `allowLocalModels` true, `allowRemoteModels` false. No third-party model fetch at runtime. | Must |
| R-3.7 | Each model shall load at most once; concurrent requests shall share one in-flight promise. | Must |
| R-3.8 | Status shall be exposed as `not_loaded` / `loading` / `ready` / `error`, with the underlying error message surfaced on failure. | Must |
| R-3.9 | When the model is not ready the system shall report output **unavailable** and shall not emit a fabricated or rule-generated sentence in its place. | Must |
| R-3.10 | Under `MODE === 'test'` the translator shall short-circuit so unit tests never load ONNX or touch the network. | Must |
| R-3.11 | ONNX shall run single-threaded with the WASM proxy disabled, so the app works on pages without `SharedArrayBuffer`. | Must |
| R-3.12 | **Planned** — Weights shall be cached in the browser (the **Cache Storage API** via Transformers.js — *not* IndexedDB; verify under Application → Cache Storage) so only the first load pays the download. | Must |
| R-3.13 | **Planned** — The ONNX export shall ship only the graphs actually loaded at runtime. Unused variants shall not be committed. | Must |

Traceability: `src/core/realization/runner.ts` is the reference implementation
for R-3.6–R-3.11 and shall be renamed/refactored, not rewritten from zero — its
loader, status machine, and single-thread WASM handling carry over unchanged.

> **R-3.13 is the largest single win available.** `public/models/` is currently
> **307 MB tracked in git** (153 MB per direction). Of the four ONNX graphs per
> model, `decoder_with_past_model_quantized.onnx` (37 MB) is never loaded — the
> shipped decoder has no `use_cache_branch` — and `decoder_model_quantized.onnx`
> (40 MB) duplicates the file served as `decoder_model_merged_quantized.onnx`.
> Roughly 150 MB of the 307 MB is dead weight today.

### 3.4 Lexicon and morphology — retained (`src/core/dictionary/`, `src/core/morphology/`)

These survive the pivot. They no longer feed a frame extractor; they power
word-level analysis in the Breakdown screen and register tagging.

| ID | Requirement | Priority |
|---|---|---|
| R-4.1 | The dictionary shall load from `public/data/dictionary.json` at startup; translation UI shall be gated on it. | Must |
| R-4.2 | Lookup shall work in both directions and return a structured `WordTranslation` including the stem and transliteration used. | Must |
| R-4.3 | Dhivehi suffixes shall be stripped to recover a stem before lookup, with the parsed suffixes exposed for display. | Must |
| R-4.4 | **Register** (`spoken` / `written`) shall be detected from honorific and morphological evidence loaded from `public/data/honorifics.json`. | Must |
| R-4.5 | Honorifics failing to load shall degrade register detection only, never prevent startup. | Must |
| R-4.6 | Closed-class words shall be handled separately from open-class entries. | Should |
| R-4.7 | **Planned** — Detected register may be surfaced as a tag on output. It is no longer a model input, so it shall not silently alter generated text. | Could |

Traceability: `lookup.ts`, `closedClass.ts`, `suffixParser.ts`, `stemWord.ts`,
`honorifics.ts`; `App.tsx:22-28` implements R-4.5.

### 3.5 Translation pipeline (`src/core/pipeline/`)

| ID | Requirement | Priority |
|---|---|---|
| R-5.1 | Input shall be segmented into sentences and each sentence translated independently. | Must |
| R-5.2 | Every translation shall produce a trace recording: input, Latin form, Thaana form, preserved segments, prefixed model input, raw model output, dictionary glosses, register, and per-stage state. | Must |
| R-5.3 | Stage state shall be one of `done` / `empty` / `not_loaded` / `unavailable` / **`error`**, over the stages: original, transliteration, **dictionary**, translation, back-transliteration, final. `error` is required because R-3.8 obliges the system to surface a load failure, and without it a failed ONNX load renders identically to "never requested". `dictionary` is required because R-5.2 puts the glosses on the trace and R-6.2 renders them. | Must |
| R-5.4 | A multi-sentence result shall be available only if **every** sentence produced output. Empty input shall report unavailable, never empty success. | Must |
| R-5.5 | Input shall be normalised once and the transliterated form computed once and reused. | Must |
| R-5.6 | Dictionary glossing shall run **beside** translation, not as an input to it. A gloss failure shall not fail the translation. | Must |
| R-5.7 | **Planned** — Sentence segmentation (R-5.1) shall be **script-aware and deterministic**, treating Latin full stops, Dhivehi punctuation (e.g. `۔`), and line breaks as sentence boundaries. Dhivehi punctuation conventions differ from English; segmentation shall not assume ASCII terminators alone. | Must |
| R-5.8 | Word tokenization shall have a **single definition**, shared by every consumer. `tokenizeWords` shall define the token classes and `extractWordsOnly` shall filter them to words; no pipeline direction, screen or tool shall define its own word boundary. A number written with a decimal point or thousands separator (`3.14`, `1,000`) shall be **one** token, and contractions and hyphenated forms (`don't`, `well-known`) shall be retained as words rather than discarded. | Must |

Traceability: `dvToEn.ts`, `enToDv.ts`, `types.ts`; tests `pipeline.test.ts`,
`enToDv.output.test.ts`. R-5.4 is enforced by `traces.length > 0 &&
traces.every(...)` — a regression guard, since `[].every()` is vacuously true
and previously reported empty input as a successful translation. **This guard
must survive the refactor.**

R-5.8 exists because the system had **three** word definitions: `tokenizeWords`,
`extractWordsOnly`, and a private regex inside `enToDv.ts`. The visible
consequence was that the Breakdown's dictionary panel (R-6.2) could list
different words than the pipeline had analysed, for the same sentence, with no
error at any layer. The two secondary clauses are the defects that divergence
concealed: `tokenizeWords('3.14')` returned `['3', '.', '14']`, putting a bare
`.` into the word list and making the number unrecoverable; and
`extractWordsOnly`'s `/^[a-zA-Z]+$/` filter silently discarded every contraction
and hyphenated form before it could reach the lexicon. Segmentation (R-5.7) and
tokenization are separate rules over the same text, so they are separate
requirements. Traceability: `core/segmenter/textProcessor.ts`,
`core/pipeline/enToDv.ts`; tests `segmentSentences.test.ts`.

`PipelineTrace` changes under v0.2: `englishFrame`, `latinFrame`, `frameString`,
`latinFrameString`, and `realization` are removed; `modelInput`, `modelOutput`,
and `translation` replace them. `dictionary`, `latin`, `thaana`,
`thaanaPreserved`, `register`, and `stages` are unchanged.

### 3.6 User interface (`src/ui/`)

| ID | Requirement | Priority |
|---|---|---|
| R-6.1 | **Translator** — the main artefact. Accept Dhivehi or English, auto-detect script, translate both directions, route into the breakdown. | Must |
| R-6.2 | **Breakdown** — redefined for v0.2: show source, Latin transliteration, word-by-word dictionary glosses with parsed suffixes, the prefixed model input, and the raw model output. Frame stages are removed. This remains a first-class deliverable, not a debug view. | Must |
| R-6.3 | **Chat** — optional LLM interop: inbound Dhivehi → English, **English only** to the LLM, reply translated back. The LLM shall never receive Thaana. | Should |
| R-6.4 | **Feedback** — collect meaning (1–5), naturalness (1–5), optional corrected translation; export CSV. | Must |
| R-6.5 | **Benchmarks** — display measured metrics from `public/data/benchmarks.json`, and display unmeasured metrics honestly as unmeasured. | Must |
| R-6.6 | **About** — problem, method, architecture, goals, limitations. Shall be updated to describe the v0.2 architecture and to state the frame approach as prior work. | Must |
| R-6.7 | Responsive: sidebar on desktop, mobile nav on small screens. | Must |
| R-6.8 | Light/dark themes with a persisted user toggle. | Should |
| R-6.9 | Show a loading state while the dictionary loads; on failure show the error and withhold translation screens. About shall stay reachable. | Must |
| R-6.10 | **Planned** — First model download shall show progress, since it is tens of MB. A silent multi-second stall is a defect. | Must |
| R-6.11 | **Planned** — The UI **may** display a low-confidence warning when model output contains tokens unseen in training, or when output length is an extreme outlier relative to the input. This is an advisory indicator only; it shall not suppress or alter the output (R-3.9). | Could |

Traceability: `App.tsx`, `ui/screens/*`, `ui/components/*`, `lib/theme.ts`.
R-6.2 requires rewriting `TraceView.tsx` and `Breakdown.tsx`.

### 3.7 Optional LLM (`src/llm/`)

| ID | Requirement | Priority |
|---|---|---|
| R-7.1 | Support OpenAI-compatible `api` and local `ollama` providers via `/chat/completions`. | Should |
| R-7.2 | The `browser` provider is declared but unconfigured in this build and shall fail with a clear message, never silently. | Should |
| R-7.3 | LLM settings shall be user-editable and stored locally only. The API key shall persist only when the user opts in via `remember`. | Must |
| R-7.4 | LLM failure shall be reported and shall not break the translator. | Must |
| R-7.5 | No API key shall be committed or required to build. | Must |

Traceability: `adapter.ts`, `storage.ts`, `types.ts`, `.env.example`.

### 3.8 Evaluation and feedback

| ID | Requirement | Priority |
|---|---|---|
| R-8.1 | Ratings shall persist in `localStorage` under `latin-mv-tlt:feedback` with id, ISO timestamp, direction, source, generated text, both scores, and correction. | Must |
| R-8.2 | CSV export shall quote and escape free-text fields correctly. | Must |
| R-8.3 | Ratings collected against an unloaded or smoke-test model shall not be reported as final results. | Must |
| R-8.4 | **Planned** — Both **BLEU and chrF++** shall be reported. chrF++ is required, not optional: BLEU is tokenization-sensitive and unreliable for Dhivehi's suffix-heavy morphology. | Must |
| R-8.5 | **Planned** — Validation metrics shall be tracked **during training**, per epoch, with best-checkpoint selection on the metric. Training without a validation metric is not acceptable. | Must |
| R-8.6 | **Planned** — A manual spot-check of ≥50 random test outputs shall verify the generated Latin is **spellable in Dhivehi**. Impossible consonant clusters indicate failure regardless of BLEU. | Must |
| R-8.7 | The gold set shall cover both directions, Latin-only, and the two directions shall deliberately not be mirrors of each other. | Must |
| R-8.8 | **Planned** — Held-out evaluation data shall come from a source or domain excluded from training (per R-2.6). | Must |
| R-8.9 | **Planned** — **Test-set size.** The held-out test set shall contain **≥500 sentence pairs per direction**, drawn from a domain or source not represented in training, and shall be manually verified for alignment quality before use. The current gold set holds **20 pairs per direction** — far too few for BLEU differences to be meaningful. 500 is the floor at which score differences begin to be somewhat reliable. | Must |

Traceability: `lib/feedback.ts`, `evaluation/gold_sentences.json`,
`evaluation/HUMAN_EVAL.md`, `tools/evaluate.py`.

### 3.9 Training (`tools/train_*.py`)

| ID | Requirement | Priority |
|---|---|---|
| R-9.1 | **Planned** — Training shall run on Colab or a local GPU and shall be rerunnable from committed scripts. | Must |
| R-9.2 | **Planned** — Config shall follow the low-resource profile: **LR 1e-4**, 3–5 epochs, batch 32, weight decay 0.01, `predict_with_generate`, `load_best_model_at_end` with `metric_for_best_model` set. Raise to 3e-4 only as a recorded ablation if validation loss plateaus within the first two epochs. Batch 32 assumes **T5-small** at sequence length 128 in fp16 on a T4; `flan-t5-base` (250M) shall use **batch 8–16**. | Should |
| R-9.3 | **Planned** — Export shall use `optimum-cli` to ONNX, then INT8 quantization, producing only the graphs required by R-3.13. | Must |
| R-9.4 | The site shall consume the quantized ONNX export, never a PyTorch checkpoint folder. | Must |
| R-9.5 | `*.safetensors`, `*.pt`, and `/models/` shall stay gitignored. | Must |
| R-9.6 | **Planned** — **Tokenizer profiling.** Before training, the SentencePiece tokenizer shall be profiled on a sample of ≥1,000 Dhivehi Latin words to verify unknown forms are **subworded rather than mapped to `<unk>`**. A `<unk>` rate above 5% shall trigger a vocabulary review. Dhivehi Latin is ASCII so this should pass easily, but long forms such as `bihloorigandu` may split unpredictably and the split behaviour shall be recorded. | Should |

Retired: `colab_train_realize.ipynb` and `tools/train_t5_realize.py` in their
frame→sentence form. The `FrameDataset` loader generalises to prefixed
translation pairs and should be adapted rather than discarded.

---

## 4. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | **Static hosting.** Build output shall be static files deployable to GitHub Pages with `base: '/latin-mv-tlt/'`. No server runtime. |
| NFR-2 | **Offline after first load.** Once weights are cached (R-3.12), translation shall require no network. |
| NFR-3 | **Privacy.** Input shall not leave the device unless the user explicitly uses the optional LLM chat. Feedback and settings stay in `localStorage`. |
| NFR-4 | **Type safety.** Strict `tsc -b` shall pass as part of `npm run build`. |
| NFR-5 | **Tested core.** Transliterator, dictionary, morphology, segmenter, pipeline, translation runner and IME shall each have unit tests; `npm test` shall pass. **9 test files, 70 tests** under v0.2 (4 frame test files deleted, 2 rewritten, 3 added). CI runs them; before v0.2 it did not. |
| NFR-6 | **Tests do not touch models or network.** |
| NFR-7 | **Determinism.** Transliteration, lookup, and morphology shall stay deterministic and side-effect free. Only the translation model is stochastic, and with greedy decoding (R-3.5) it should be reproducible too. |
| NFR-8 | **Honest reporting.** Any metric not measured on this pipeline shall be labelled unmeasured. Results from other repos shall never be presented as this system's. |
| NFR-9 | **Load tolerance.** First load may be slow; the UI shall communicate loading and error states rather than appearing frozen (see R-6.10). |
| NFR-10 | **Script rendering.** A Thaana font shall be bundled so Thaana renders without a system font. |
| NFR-11 | **Portability.** Current Chromium/Firefox/Safari, including pages without `SharedArrayBuffer` (R-3.11). |
| NFR-12 | **Reproducible deploy.** Push to `main` shall build and publish via GitHub Actions with `npm ci`. |
| NFR-13 | **Repository weight.** Tracked model weights shall stay within the R-3.4 budget. GitHub Pages must serve the build; a 307 MB model directory is not acceptable. |

### 4.1 Environment

- Node.js 18+ (CI uses Node 22), npm.
- React 19, Vite 8, TypeScript 5.8, Tailwind 3.4, Vitest 4.
- `@huggingface/transformers` ^3.8.1 for in-browser ONNX seq2seq. v0.1 used the
  legacy `@xenova/transformers` 2.17; the successor is the maintained line and
  its `dtype` option removes the need for v0.1's duplicate-decoder file hack.
  A move to the 4.x line is deferred until there is a trained model to
  regression-test the upgrade against.
- ONNX Runtime WASM is **vendored** into `public/ort/` at build time
  (`scripts/copy-ort.mjs`). The library otherwise defaults `wasmPaths` to a
  jsDelivr CDN, which would put a third-party network call on the translation
  path in breach of §1.2, NFR-2 and NFR-3.
- Python 3; dependencies pinned in **`tools/requirements.txt`** (PyTorch,
  Transformers ≥4.46, Optimum, `sacrebleu`). R-9.1 requires the offline pipeline
  be rerunnable from committed scripts, which a prose list does not satisfy.
- **Node.js is required for the offline pipeline too.** `build_translation_pairs.py`
  and `measure_roundtrip.py` call the project's own transliterator through
  `tools/transliterate.mjs` (R-2.2), which is why the corpus is built locally
  rather than on Colab.

---

## 5. Data requirements

| Artefact | Location | Ships in repo | Status |
|---|---|---|---|
| Dictionary | `public/data/dictionary.json` | Yes | Retained |
| Dictionary stats | `public/data/dictionary_stats.json` | Yes | Retained |
| Honorifics | `public/data/honorifics.json` | Yes | Retained |
| Benchmarks | `public/data/benchmarks.json` | Yes | Retained; metrics reset for v0.2 |
| Gold set | `evaluation/gold_sentences.json` | Yes | Retained; **20 pairs/direction today — extend to ≥500 per R-8.9** |
| Quarantine | `data/quarantine.json` | Yes | Retained |
| Round-trip stats | `evaluation/roundtrip_stats.json` | Yes | **New — measured** |
| Tokenizer profile | `evaluation/tokenizer_profile.json` | Yes | **Planned** (M-2b) |
| Corpus stats | `data/parallel/corpus_stats.json` | Yes | **Planned** (M-1) |
| Export stats | `public/models/dv-en-translate/export_stats.json` | Yes | **Planned** (M-4) |
| ONNX Runtime WASM | `public/ort/` | No (gitignore) | Vendored at build time |
| Translation model | `public/models/dv-en-translate` | **Planned** | New, ≤80 MB |
| Parallel corpus | `data/parallel/*.jsonl` | No (gitignore) | **Planned** — Stage 1 ~90k pairs, Stage 2 ≥200k (R-2.1b) |
| Back-translated pairs | `data/parallel/synthetic/*.jsonl` | No (gitignore) | **Planned** — provenance-labelled (R-2.10) |
| Realization models | `public/models/{en,dv}-realize` | Yes (307 MB) | **Retired — delete** |
| Frame pairs | `data/realize/*.jsonl` | No | **Retired** |

Quantity targets are requirements, not aspirations: R-2.1b fixes the corpus
target and R-8.9 fixes the test-set floor. A corpus or test set below those
numbers shall be reported as such rather than silently accepted.

---

## 6. Constraints and assumptions

1. **Browser-only.** No backend may be introduced; it breaks NFR-1–3.
2. **Model-only translation.** Fluent output comes from the model or not at all
   (R-3.9). "Unavailable" is a correct result, not a bug. This principle is
   carried over intact from v0.1.
3. **One romanization.** R-1.2 is load-bearing; violating it silently degrades
   every downstream metric and is the failure mode hardest to diagnose.
4. **Corpus-limited coverage.** A news-trained model will be weakest on
   conversational and social-media Dhivehi. This is a known, stated limit.
   ~90k pairs is a Stage 1 baseline, not a sufficient corpus (R-2.1b).
5. **The LLM is a demo.** Removing it must not affect translation.
6. **Quality is not guaranteed to beat v0.1 on in-vocabulary sentences.** The
   frame pipeline, within its ~60-word slot inventory, may produce cleaner
   output. v0.2 trades peak in-domain quality for coverage; §7 AC-9 tests this
   explicitly rather than assuming it.
7. **The 80 MB budget is tight, not comfortable.** T5-small INT8 lands at
   roughly 80 MB (R-3.2), so there is no headroom for a larger backbone without
   an explicit, recorded budget decision (R-3.3).
8. **Transliterator accuracy caps translation quality.** Every training pair
   passes through the transliterator, so its round-trip error rate (R-1.8) is a
   ceiling on everything measured downstream. It is measured before training,
   not after.

---

## 7. Acceptance criteria

- **AC-1** `npm ci && npm run build` succeeds; `npm test` passes with no network
  or model access.
- **AC-2** `npm run dev` serves at `/latin-mv-tlt/`; the Translator produces
  output for a Dhivehi sentence and an English sentence with the model present.
- **AC-3** With the model removed, the Translator reports `not_loaded` /
  `unavailable` and emits no fabricated sentence.
- **AC-4** The Breakdown screen shows source, Latin, word glosses with suffixes,
  prefixed model input, and raw model output.
- **AC-5** Feedback ratings persist across reload and export as valid CSV.
- **AC-6** Benchmarks shows no unmeasured metric as if it were measured.
- **AC-7** Chat sends English only to the LLM and fails clearly with no key.
- **AC-8** A push to `main` deploys to GitHub Pages.
- **AC-9** BLEU and chrF++ are measured on a domain-held-out test set of
  **≥500 sentence pairs per direction** (R-8.9) and published, together with a
  ≥50-sentence spellability spot-check.
- **AC-10** `public/models/dv-en-translate/**` is ≤80 MB, verified three ways:
  `tools/export_onnx.py` refuses to write over budget, `npm run check:models`
  blocks the deploy, and a devtools check on a cold cache confirms it — then a
  hard reload fetches no weights (Application → **Cache Storage**, not IndexedDB).
  The ONNX Runtime WASM (~21.6 MB) is reported separately.
- **AC-11** Round-trip Thaana → Latin → Thaana is measured over ≥1,000 held-out
  samples and published as all three figures of R-1.8, with failing classes
  listed. **Met**: 99.28% Latin-stable over 15,201 entries
  (`evaluation/roundtrip_stats.json`); re-run on the news corpus after M-1.
- **AC-12** The tokenizer profile (R-9.6) is run and its `<unk>` rate published
  before the training run it gates.
- **AC-13** The corpus stats file records Stage 1 and, if reached, Stage 2
  counts with the real/synthetic split (R-2.1b, R-2.10).

---

## 8. Migration plan (v0.1 → v0.2)

Ordered so the app stays runnable throughout.

| Step | Action | Unblocks |
|---|---|---|
| M-1 | Write the corpus builder: download HF datasets, normalise Thaana→Latin with the project transliterator, dedup, length-filter, prefix, domain-split, emit stats. | R-2.x |
| M-2 | Measure round-trip transliteration accuracy on the corpus **before** training — it caps achievable quality. Exact-match over ≥1,000 samples; fix the rules if below 98%. | R-1.8, AC-11 |
| M-2b | Profile the tokenizer on ≥1,000 Latin words and record the `<unk>` rate before committing to the backbone. | R-9.6, AC-12 |
| M-3 | Adapt `train_t5_realize.py` to prefixed pairs; add BLEU/chrF++ per epoch and best-checkpoint selection. | R-9.x, R-8.5 |
| M-4 | Train, export ONNX INT8, ship only required graphs into `public/models/dv-en-translate`. **Measure the exported size against the 80 MB budget here**, not after integration. | R-3.x, AC-10 |
| M-5 | Add `src/core/translate/` reusing the loader and status machine from `realization/runner.ts`. | R-3.6–3.12 |
| M-6 | Rewrite `PipelineTrace` and both pipeline entry points; keep the `traces.length > 0` guard and its test. | R-5.x |
| M-7 | Rewrite `Breakdown.tsx` / `TraceView.tsx` for the new trace; update `About.tsx`. | R-6.2, R-6.6 |
| M-8a | Delete `src/core/frames/`, `src/core/realization/`, `data/realize/`, `tools/build_frame_pairs.py`, `colab_train_realize.ipynb`, `evaluation/en_frames.python.json`, and the frame tests. Code only, no size impact — runs early so `tsc -b` catches stragglers. | R-5.x |
| M-8b | Delete `public/models/{en,dv}-realize` (307 MB). **Last**, only once the v0.2 model is verified in a browser, so the app is never left with no model path at all. | NFR-13 |
| M-9 | Extend the gold set to ≥500 verified pairs per direction from a held-out domain, before any score is published. | R-8.9, AC-9 |
| M-10 | Reset `benchmarks.json` for v0.2 metrics; re-run evaluation and publish. | AC-6, AC-9 |
| M-11 | **Stage 2** — build the back-translation pipeline and grow the corpus toward ≥200k pairs; retrain and compare against the Stage 1 baseline. | R-2.1b, R-2.10 |

M-1 through M-10 deliver the Stage 1 baseline model. M-11 is Stage 2 and is
sequenced last deliberately: a back-translation pipeline is only worth building
once there is a measured Stage 1 score to compare it against.

**M-8 caveat:** deleting 307 MB from the working tree does not shrink the git
history — the blobs remain in every clone. If repository size matters, history
rewrite (`git filter-repo`) is a separate, destructive decision requiring a
force-push, and is **not** authorised by this document.

---

## 9. Known gaps

| ID | Gap | Blocking |
|---|---|---|
| GAP-1 | ~~Round-trip transliteration accuracy unmeasured.~~ **Measured** over 15,201 dictionary entries: **99.28% Latin-stable** (gate ≥98%), 88.07% exact Thaana. `evaluation/roundtrip_stats.json`. Re-run on the news corpus once M-1 has produced it. | Closed for now |
| GAP-2 | BLEU / chrF++ unmeasured; no domain-held-out test set yet. | AC-9 |
| GAP-3 | No human ratings collected (meaning / fluency). | R-8.3 |
| GAP-4 | The direct translation model does not exist yet — no corpus, no checkpoint, no export. | AC-2, AC-9, AC-10 |
| GAP-5 | `public/models/` is 307 MB tracked, ~150 MB of it never loaded at runtime. | NFR-13, AC-10 |
| GAP-6 | ~~README links to a missing `Context/` folder.~~ **Resolved** — `Context/` is present with `PROJECT.md`, `DATA.md`, `TRAINING.md`, `STATUS.md`, `QUALITY.md`. | Closed |
| GAP-7 | README quickstart hardcodes a Windows path (`C:\Users\Moham\...`). | Documentation |
| GAP-8 | README, About, and `benchmarks.json` still describe the v0.1 frame architecture. | R-6.6, AC-6 |
| GAP-9 | Gold set holds 20 pairs per direction against a ≥500 requirement, and is not domain-held-out. | R-8.9, AC-9 |
| GAP-10 | Corpus is Stage 1 only; no back-translation pipeline exists. | R-2.1b, R-2.10 |
| GAP-11 | Tokenizer `<unk>` behaviour on Dhivehi Latin is unprofiled. | R-9.6, AC-12 |
| GAP-12 | ~~Sentence segmentation is not script-aware.~~ **Closed** — `۔`, `؟` and line breaks are boundaries, terminator runs collapse, and letterless fragments are never emitted. `segmentSentences.test.ts`. | Closed |
| GAP-13 | The ten Arabic-derived Thaana letters cannot round-trip exactly, and coda `h` (`ށް` vs `އް`) is resolved by frequency, not evidence. Both are declared, measured classes rather than defects. | Accepted; R-1.8 |
| GAP-14 | `SUBJECT_LATIN`, `LOCATION_LATIN` and `PARTICLE_LATIN` in `closedClass.ts` lost their only consumers when `frames/` was deleted. Harmless, but dead. | Cleanup |

---

## 11. Amendment log

### 11.1 v0.2.2 → v0.2.3

| # | Change | Why it was necessary |
|---|---|---|
| 1 | **R-5.8** — one definition of a word, shared by every consumer | The spec constrained sentence segmentation (R-5.7) and required the Breakdown to render dictionary glosses (R-5.2, R-6.2), but never said what a *word* was. Three definitions had accumulated — `tokenizeWords`, `extractWordsOnly`, and a private regex in `enToDv.ts` — so the Breakdown's word list could disagree with the pipeline's for the same sentence. That is a user-visible inconsistency that no requirement forbade and no test could catch. The two secondary clauses pin the defects the divergence hid: decimals shredded into three tokens, and contractions discarded by a letters-only filter. |

### 11.2 v0.2.1 → v0.2.2

Raised while implementing §8. Each was a place where following the spec
literally would have produced something that could not work, or could not be
verified.

| # | Change | Why it was necessary |
|---|---|---|
| 1 | **R-1.8** — gate on Latin-stability, report exact and folded beside it | The ≥98% *exact* gate contradicted R-1.2. One canonical romanization forces Thaana→Latin to be many-to-one for ten Arabic-derived letters, so exact match cannot reach 100% however correct the rules are. Measured: 88.07% exact vs **99.28% Latin-stable**. The model only sees Latin, so the second figure is the one §6.8 is actually about. |
| 2 | **R-3.4 / AC-10** — scope the 80 MB to the model directory | Read as "everything fetched at runtime" it includes the ONNX Runtime WASM, measured at **21.6 MB**, making AC-10 unachievable at any model size. |
| 3 | **R-3.12** — Cache Storage API, not IndexedDB | Factually wrong as written. Transformers.js caches in Cache Storage; an examiner following the spec would look in the wrong devtools panel and conclude caching was broken. |
| 4 | **R-2.5** — pin the exact prefix literals, single definition | The spec omitted the T5 `": "` separator. Two characters of drift between corpus and runtime degrade the model with no error at any layer, so the literal is pinned and shared rather than restated. |
| 5 | **R-5.3** — add `dictionary` and `error` | `error` was absent, so a failed ONNX load rendered identically to "never requested", contradicting R-3.8. `dictionary` was absent though R-5.2 and R-6.2 both require the glosses. |
| 6 | **§4.1** — `@huggingface/transformers` ^3.8.1; vendor the ORT WASM | The successor package is maintained and its `dtype` option retires v0.1's duplicate-decoder hack. Vendoring is not optional: the library defaults `wasmPaths` to a jsDelivr CDN, which put a third-party fetch on the translation path in breach of §1.2, NFR-2 and NFR-3. |
| 7 | **§4.1** — pin Python deps; note Node is needed offline too | R-9.1 requires the pipeline be rerunnable from committed scripts. There was no `requirements.txt` anywhere in the repo. |
| 8 | **§8 M-8** — split into M-8a (code, early) and M-8b (307 MB, last) | Deleting the models before the new one exists would leave no model path at all. Splitting keeps the app runnable throughout, as §8 intends. |
| 9 | **R-9.3** — noted as newly implemented | There was no ONNX export script in the repo at all, and the Colab notebook had no export cell, so the requirement had never been met. `tools/export_onnx.py` now asserts the merged decoder exposes `use_cache_branch`, that each graph actually shrank under quantization, and that the total is within budget — refusing to write otherwise. |

---

## 10. Traceability summary

| Area | Requirements | Code | Tests |
|---|---|---|---|
| Transliteration | R-1.x | `core/transliterator/`, `ui/hooks/useThaanaIme.ts` | `transliterator.test.ts`, `useThaanaIme.test.ts` |
| Corpus | R-2.x | `tools/build_translation_pairs.py`, `tools/transliterate.mjs`, `tools/_transliterate_bridge.py` | `data/parallel/corpus_stats.json` |
| Translation model | R-3.x | `core/translate/{runner,types,prefixes}.ts` | `translate.test.ts`, `scripts/check-models.mjs` |
| Lexicon & morphology | R-4.x | `core/dictionary/`, `core/morphology/` | `lookup.test.ts`, `stemWord.test.ts`, `suffixParser.test.ts` |
| Pipeline | R-5.x | `core/pipeline/` | `pipeline.test.ts`, `enToDv.output.test.ts` |
| Segmentation & tokenization | R-5.7, R-5.8 | `core/segmenter/textProcessor.ts`, `core/pipeline/enToDv.ts` | `segmentSentences.test.ts` |
| UI | R-6.x | `App.tsx`, `ui/` | manual / AC-2–AC-7 |
| LLM | R-7.x | `llm/` | manual |
| Evaluation | R-8.x | `lib/feedback.ts`, `evaluation/`, `tools/evaluate.py`, `tools/measure_roundtrip.py` | `roundtrip_stats.json`, `scores.json` |
| Training | R-9.x | `tools/train_translate.py`, `tools/export_onnx.py`, `tools/profile_tokenizer.py`, `colab_train_translate.ipynb` | `training_stats.json`, `export_stats.json`, `tokenizer_profile.json` |

---

## Appendix A — Superseded: the semantic frame architecture (v0.1)

Retained as prior work. This is defensible research, not a mistake: it was a
genuine attempt at interpretable, controllable translation, and it produced the
transliterator, dictionary, and morphology modules that v0.2 still depends on.

### A.1 What it did

```
Thaana → Latin → dictionary + morphology → semantic frame → en-realize (T5) → English
English → sentence analysis → semantic frame → slot mapping → dv-realize (T5) → Latin → Thaana
```

The frame (`src/core/frames/types.ts`) was the contract between halves:
`subject, action, object, location, time, manner, reason, tense, polarity,
register, residue`.

### A.2 Its requirements, as specified in v0.1

- Extract a `SemanticFrame` from Dhivehi Latin tokens and from English sentences.
- Retain unclassifiable tokens in `residue` and display them — lossy extraction
  had to be **visible**, never silent.
- Carry `register` as a first-class slot, because written Dhivehi past-tense
  clauses end in `eve` and spoken ones do not; without the slot, one frame
  string mapped to two valid sentences and the model could not learn which to
  emit.
- Serialize the frame to one canonical string as model input.
- Map English frame slots onto Dhivehi Latin surface forms before realization.
- Produce fluent output only from `en-realize` / `dv-realize`, with no
  rule-based fallback sentence.

### A.3 Why it was superseded

Training pairs were combinatorial over a curated slot vocabulary: **7 subjects,
16 verbs, 12 objects, 5 locations, 7 times** — roughly sixty content words,
expanded to 16,141 English and 14,270 Dhivehi synthetic pairs. Coverage was
therefore bounded by that inventory. A sentence such as *"The parliament passed
the amendment yesterday"* could not be translated at all, because the nouns and
verb were not slots. The apparent scale of the training set measured
combinatorial expansion, not linguistic coverage.

Cost was also inverted against benefit: two models totalling 307 MB tracked
(~148 MB fetched) for less coverage than one ~80 MB model trained on real
parallel text.

### A.4 What survived

The transliterator, dictionary lookup, suffix parser, honorific/register
detection, React UI, Pages deployment, the stage-state trace concept, the
"model or nothing" output principle, and the empty-input regression guard —
every one of these is a v0.2 requirement.

### A.5 If it is ever revived

The frame layer would be most defensible as an **interpretability overlay** on
top of a direct model — showing predicted structure for a translation the neural
model produced — rather than as the translation mechanism itself. That preserves
the Breakdown screen's teaching value without capping coverage at sixty words.
