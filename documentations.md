# Dissertation Writing Outline — latin-mv-tlt

Key points per section, each tagged with the evidence that backs it. Expand the
bullets into prose; do not re-derive the numbers.

**How to read the tags**

| Tag | Meaning |
|---|---|
| `[R-1.8]`, `[NFR-5]`, `[AC-9]` | Requirement / non-functional requirement / acceptance criterion in `docs/REQUIREMENTS.md` v0.2.2 |
| `[M-3]`, `[GAP-2]` | Migration step (§8) or known gap (§9) of the same document |
| `[file.json]` | The artefact that printed the figure — cite the file, not the memory |
| `⟨fill after M-3/M-4⟩` | Not measured yet. Leave the placeholder in your draft until the checkpoint exists. Never estimate. `[NFR-8]` |

**State of the work at the time of writing (2026-08-26)**

- Done and measured: corpus build `[M-1]`, round-trip gate `[M-2]`, tokenizer
  profile `[M-2b]`, the whole v0.2 application code path `[M-5…M-8a]`.
- Not run: training `[M-3]` and ONNX export `[M-4]`. `public/models/` still holds
  only the v0.1 `en-realize` / `dv-realize` directories. Therefore **no BLEU,
  chrF++ or human rating exists yet** `[GAP-2, GAP-3, GAP-4]`.

**Stale artefacts — fix before you cite them against each other**

*(`public/data/benchmarks.json` and `Context/STATUS.md` were corrected on
2026-08-27 — round-trip now reads 99.35% / 99.80% straight from the JSON, and
the corpus and tokenizer rows carry their measured values. Both are safe to
cite. The three below are still outstanding.)*

1. `Context/PROJECT.md` still describes the v0.1 semantic-frame pipeline as the
   live architecture. It is prior work now; `docs/REQUIREMENTS.md` §2 is current.
2. `docs/REQUIREMENTS.md` GAP-10 says "Stage 1 only, ≥200k not reached".
   `corpus_stats.json` reports `realPairs: 285748` and `meetsStage2Target: true`
   from real parallel data alone — the Stage 2 volume target was met without
   back-translation. Restate GAP-10 as *back-translation pipeline not built*,
   not *corpus too small*.
3. `public/data/dictionary_stats.json` `source` field leaks a Windows path
   (`C:\Users\Moham\...`). Do not screenshot it. `[GAP-7]`

---

# Chapter 1: Introduction

## 1.1 Context and Background

- Dhivehi: ~340k speakers, official language of the Maldives, written in
  **Thaana** — right-to-left, 24 base consonants plus obligatory *fili* vowel
  diacritics, so a "character" in Unicode is not a grapheme a reader sees.
- Ten Thaana letters are Arabic-derived (`ޙ ޝ ޱ ޢ ޛ ޘ ޞ ޟ ޡ ޠ`) and are
  pronounced identically to a native counterpart — a many-to-one mapping that
  becomes load-bearing later. `[evaluation/roundtrip_stats.json → variantCollisions]`
- Why general-purpose MT under-serves Dhivehi: subword vocabularies are trained
  on web-scale corpora where Thaana is a rounding error, so Thaana fragments into
  long byte-level piece sequences, inflating sequence length and starving the
  model of signal per token. This is the *tokenization* half of the problem.
- The *resource* half: little aligned Dhivehi–English text, no standardised
  romanization, no morphological analyser, no treebank.
- Dhivehi is morphologically rich and suffix-heavy (`-ge`, `-ah`, `-gai`, `-eve`,
  `-un`, `-gen`, `-fai`, `-nee`), so word-level metrics such as BLEU behave badly
  and character-level metrics are required. `[R-8.4]`
- Frame the deployment context too: browser-only, no server, no account — which
  is a design commitment, not an afterthought. `[§1.2, NFR-1…3]`

## 1.2 Motivation

- Personal/practical: Dhivehi speakers have no offline, private translation tool;
  every existing option ships text to a third-party server.
- Technical: the observation that **Latin is already the working script for
  Dhivehi in practice** — Malé Latin is what people type on QWERTY keyboards —
  so a Latin intermediate representation is not an artificial construct.
- Research: a testable hypothesis rather than a product build — *does removing
  Thaana from the model's problem make a browser-sized model viable?* `[§1.1]`
- Privacy and offline capability as first-class motivations, not features:
  nothing leaves the device unless the user opts into the optional LLM chat.
  `[NFR-2, NFR-3]`
- Honest reporting as a stated value — the system says "Unavailable" rather than
  inventing a sentence, and the Benchmarks screen labels unmeasured numbers as
  unmeasured. `[R-3.9, R-6.5, NFR-8]`

## 1.3 Research Problem

- Statement to defend: **general-purpose MT tokenizes Thaana badly, and models
  large enough to compensate are too large to run in a browser.**
- Sub-problem 1 — *representation*: no single canonical romanization exists, so
  the same Thaana word appears in several Latin spellings across any naïve
  corpus, and the model must waste capacity learning spelling variance. `[R-1.2]`
- Sub-problem 2 — *resources*: parallel Dhivehi–English data is scarce, noisy and
  news-skewed; the dictionary sources available are Radheef-style monolingual
  definitions, not translation glosses. `[Context/DATA.md → "Still wrong, known"]`
- Sub-problem 3 — *deployment*: a browser budget of ≤80 MB INT8 for the model
  directory, with ONNX Runtime WASM (~21.6 MB) counted separately. `[R-3.4, AC-10]`
- Sub-problem 4 — *evidence*: prior Dhivehi work reports numbers from other
  repositories or none at all; this project must measure on its own pipeline.

## 1.4 Aim and Objectives

### 1.4.1 Aim

- One sentence, quotable: *to determine whether a canonical Latin intermediate
  representation makes a small, browser-deployable seq2seq model viable for
  Dhivehi↔English translation, by removing Thaana Unicode and its segmentation
  from the model's problem entirely.* `[§1.1 of docs/REQUIREMENTS.md]`

### 1.4.2 Objectives

Write these as measurable and map each to a migration step and an acceptance
criterion — the mapping is your Chapter 7 skeleton.

| # | Objective | Verified by |
|---|---|---|
| O1 | Build a deterministic, dependency-free Thaana↔Latin transliterator with exactly one romanization convention | `[R-1.1, R-1.2]`, `transliterator.test.ts` |
| O2 | Measure round-trip stability ≥98% Latin-stable before any training | `[R-1.8, M-2, AC-11]` |
| O3 | Construct a de-duplicated, length-filtered, domain-split parallel corpus normalised by that same transliterator | `[R-2.x, M-1]` |
| O4 | Profile the tokenizer for `<unk>` behaviour before committing to the backbone | `[R-9.6, M-2b, AC-12]` |
| O5 | Train one prefix-selected seq2seq model covering both directions | `[R-3.1, R-9.2, M-3]` |
| O6 | Export to INT8 ONNX inside an 80 MB budget, shipping only graphs the runtime loads | `[R-3.4, R-3.13, M-4, AC-10]` |
| O7 | Deliver a browser-only application with a fully inspectable per-stage trace | `[R-5.2, R-6.2, AC-4]` |
| O8 | Evaluate with BLEU **and** chrF++ per direction on a domain-held-out test set, plus human adequacy/fluency ratings | `[R-8.4, R-8.9, AC-9]` |

## 1.5 Significance and Justification

- First (as far as the review found) Dhivehi MT system that runs entirely
  client-side with no server and no third-party fetch on the translation path.
- Method is transferable: any low-resource language with a non-Latin script and
  an established informal romanization can reuse the pivot design.
- Beneficiaries: Dhivehi speakers needing private/offline translation; NLP
  researchers working on Thaana; the transliterator, cleaned 15,302-entry lexicon
  and morphology modules are reusable artefacts in their own right.
- Methodological contribution: the *gates-before-training* discipline —
  round-trip stability and tokenizer profiling are measured **before** a GPU hour
  is spent, because the transliterator's error rate is a hard ceiling on
  everything downstream. `[§6 constraint 8]`
- Pedagogical contribution: the Breakdown screen makes every intermediate visible
  (source → Latin → glosses → prefixed model input → raw model output), so the
  system is inspectable rather than a black box. `[R-6.2]`

## 1.6 Scope and Limitations

### 1.6.1 Scope

- Dhivehi↔English **sentence-level** translation, both directions from one set of
  weights selected by task prefix. `[R-3.1]`
- Rule-based Thaana↔Latin transliteration in both directions, plus a Thaana IME
  so users type Malé Latin on a QWERTY keyboard and receive Thaana. `[R-1.7]`
- Browser-only static deployment to GitHub Pages under `base: '/latin-mv-tlt/'`.
  `[NFR-1, NFR-12]`
- Dictionary lookup with suffix stripping and honorific/register detection,
  surfaced as word-by-word analysis. `[R-4.x]`
- Six screens: Translator, Breakdown, Chat, Feedback, Benchmarks, About. `[R-6.x]`
- Evaluation: automatic (BLEU, chrF++) and human (adequacy, fluency 1–5). `[R-8.x]`
- Optional LLM chat as a *demonstration* that never sits on the translation path
  and never receives Thaana. `[R-6.3, §6 constraint 5]`

### 1.6.2 Limitations

State each as a bounded, declared limit with its evidence — not an apology.

- **Sentence unit only.** No document-level context, no coreference; a 6,000-word
  document path is designed but not built. `[§1.3, Context/QUALITY.md]`
- **Domain skew.** The corpus is predominantly news; the model will be weakest on
  conversational and social-media Dhivehi. `[§6 constraint 4]`
- **Ten Arabic-derived letters cannot round-trip exactly** by construction — one
  romanization forces many-to-one. Declared and measured, not a defect. `[GAP-13]`
- **Coda `h` ambiguity** (`ށް` vs `އް`) is resolved by frequency, not evidence.
  `[GAP-13]`
- **80 MB is a ceiling, not a comfort zone.** T5-small INT8 lands *at* ~80 MB, so
  a larger backbone requires an explicit recorded budget forfeit. `[R-3.2, R-3.3]`
- **No speech, OCR, or document translation.** `[§1.3]`
- **English glosses in the lexicon are Radheef definitions, not translation
  glosses** — 289 entries gloss as "a kind of plant", 254 as "a kind of fish".
  A ceiling on EN→DV lexical quality. `[Context/DATA.md]`
- **Model trained, exported and scored.** t5-small,
  4 epochs (60,004 steps), best validation
  chrF++ 34.2833; exported to ONNX INT8 at
  70.85 MB. Held-out test scores are in §6.4. The only figures
  still marked `⟨fill after M-3/M-4⟩` are the **human ratings** in §6.5, which
  require a rating session that has not been run. `[GAP-3]`

---

# Chapter 2: Literature Review

## 2.1 Introduction

- What the chapter covers and in what order: low-resource NMT → script and
  transliteration → NMT architectures → on-device inference → Dhivehi-specific
  work → the gap this project occupies.
- State the selection criterion you used (e.g. peer-reviewed MT literature plus
  the model/tooling documentation the build actually depends on).

## 2.2 Background Research

- Statistical MT → neural MT → transformer era, compressed; enough to position
  seq2seq, not a history lesson.
- Evaluation metrics: BLEU and its known weakness on morphologically rich
  languages; chrF and chrF++ as character-n-gram alternatives; why chrF++ is
  mandatory here rather than optional. `[R-8.4]`
- Human evaluation: adequacy vs fluency as separate axes — the pair this project
  collects as *meaning* and *naturalness*. `[R-6.4, evaluation/HUMAN_EVAL.md]`

## 2.3 Low-Resource Machine Translation

- Data-centric techniques: back-translation, pivot languages, transfer learning
  from multilingual checkpoints, data augmentation.
- Why back-translation is *scheduled last* here (Stage 2, M-11): it is only worth
  building once a Stage 1 baseline score exists to compare against. `[R-2.10, M-11]`
- Splitting policy in low-resource work: random splits over-report because near
  duplicates straddle the split; domain-held-out splits measure generalisation.
  `[R-2.6, R-8.8]`
- Test-set size and metric reliability — why 20 pairs cannot support a BLEU
  claim and 500 per direction is the working floor. `[R-8.9]`

## 2.4 Dhivehi Language and Thaana Script

- Thaana structure: consonant + obligatory *fili*, RTL, `ް` (sukun) marking no
  vowel, the *alifu* onset carrier.
- Morphology: agglutinative suffixation; case (`-ah` dative, `-ge` genitive,
  `-gai` locative), tense/aspect (`-anan`, `-aane`, `-fi`, `-jje`), negation via
  `nu-` prefix, and the written-register clause terminator `eve`.
- Register and honorifics: written vs spoken; reverential / respectful /
  informal tiers. Note the concrete consequence — formal Dhivehi *suppresses* the
  second-person pronoun and uses honorific verb morphology; `kaley` is a
  translation error in formal register, not a style choice.
  `[Context/QUALITY.md → "Formal second person"; cite the Saruna/MNU grammar]`
- Malé Latin as a *de facto* romanization: no `w`, no `x`, `c` only in `ch`, but
  `q` is legitimate (`naquluvun`, `baithulmaqdhis`). `[Context/DATA.md → Repair]`

## 2.5 Transliteration and Romanization

- Rule-based vs neural transliteration; why rule-based wins here — deterministic,
  synchronous, zero download, testable, and available before any model loads.
  `[R-1.1, R-1.4]`
- Canonical romanization as a *training-data* decision: if the corpus normaliser
  and the inference-time normaliser are the same code, spelling variance stops
  being a source of loss. `[R-1.2, R-2.2]`
- Round-trip stability as the standard evaluation for a pivot representation, and
  the three-figure formulation (exact / folded / Latin-stable) this project
  argues for. `[R-1.8]`
- The counter-intuitive loanword policy: emit phonetic Latin (`instagraam`), not
  English orthography, because consistency beats prettiness at training time.
  `[R-1.5]`

## 2.6 Neural Machine Translation

- Encoder–decoder with attention; sequence length, greedy vs beam decoding, and
  the cost of beam search on a CPU-bound WASM runtime. `[R-3.5]`
- Subword tokenization: BPE vs SentencePiece/unigram; why an ASCII-only Latin
  input is a good fit for an existing English-trained vocabulary.
- Multilingual/multitask models and the pitfalls of one mixed average hiding a
  collapsed direction. `[Context/TRAINING.md → "Metrics per direction"]`

## 2.7 Transformer and T5 Models

- T5's text-to-text framing and **task prefixes** as the mechanism that lets one
  set of weights serve both directions. Note the exact literals and that the
  trailing `": "` is part of the prefix. `[R-2.5, src/core/translate/prefixes.ts]`
- Model-size ladder: t5-small (60M) vs flan-t5-small vs flan-t5-base (250M) and
  what each costs in batch size on a T4. `[R-9.2]`
- NLLB-200-distilled-600M — includes Dhivehi, which is the obvious counter-choice
  to discuss; ~120–150 MB minimum INT8 before tokenizer, so it very likely breaks
  the browser budget. Adoption would require an explicit recorded forfeit of
  NFR-13 and AC-10. `[R-3.3]`
- On-device inference stack: ONNX export, dynamic INT8 quantization, ONNX Runtime
  WASM, Transformers.js; merged decoder with `use_cache_branch`; Cache Storage API
  (not IndexedDB) as the weight cache. `[R-3.12, §11 amendment 3]`

## 2.8 Existing Dhivehi Translation Systems

- Survey commercial/general systems (Google Translate's Dhivehi support, NLLB's
  `div_Thaa`) and note what they do not offer: offline use, privacy, inspectable
  intermediates, or published Dhivehi-specific numbers.
- Available Dhivehi resources and their character: the `alakxender/dhivehi-english-*`
  parallel datasets, Radheef-derived lexicons, Fritz Vol. II as *working notes on
  attested morphology* rather than a dictionary — and the copyright constraint
  that its texts must not be bulk-copied. `[Context/DATA.md → Sources]`
- Prior romanization schemes and why none of them was adopted wholesale.

## 2.9 Research Gap

- Three gaps, stated as the intersection this project sits in:
  1. No published Dhivehi MT system runs **fully client-side** within a stated
     size budget.
  2. Latin-pivot representation for Dhivehi is **asserted but not measured** —
     nobody publishes a round-trip stability figure that bounds it.
  3. Dhivehi MT results are reported without a **domain-held-out** test set or
     character-level metrics, so they are not comparable.
- Close with the one-line claim your work adds: measured pivot stability
  (99.8% on corpus text), a domain-held-out corpus, and a budget-gated browser
  deployment. `[evaluation/roundtrip_stats_corpus.json]`

## 2.10 Chapter Summary

- Three or four sentences; end by naming the gap Chapter 3 turns into requirements.

---

# Chapter 3: Requirements Analysis and Research Methods

## 3.1 Introduction

- Position the chapter as the bridge from gap to specification, and name the
  artefact that is the specification: `docs/REQUIREMENTS.md` v0.2.2, in which
  every requirement is traceable to a module, a data artefact, or a test.

## 3.2 Research Design

- Design Science Research / build-and-evaluate: the artefact is the contribution
  and the evaluation is measured on that artefact.
- **Two design iterations**, both documented — v0.1 semantic frames, v0.2 direct
  seq2seq — with a recorded architectural decision between them. This is the
  methodological spine of Chapter 4. `[docs/REQUIREMENTS.md §2.1, Appendix A]`
- The requirements document's own **amendment log** (§11) as evidence of
  disciplined iteration: nine places where the spec as written was unachievable
  or factually wrong about the runtime, each amended with its evidence.
- Traceability method: requirement → module → test, tabulated in §10.
- Ethics: no personal data collected; feedback stays in `localStorage`; no API
  key committed; source text never leaves the device except via opt-in LLM chat.
  `[R-7.3, R-7.5, NFR-3]`

## 3.3 Functional Requirements

Present as grouped tables lifted from §3 of the requirements document, with
priority (Must/Should/Could) and status. Groups:

- **Transliteration** `[R-1.1…R-1.8]` — rule-based only; one romanization;
  preserved-segment reporting; works before any model loads; IME; measured
  round-trip.
- **Corpus construction** `[R-2.1…R-2.10]` — real parallel sources; normalised by
  the project's own transliterator; de-duplicated; length-ratio filtered;
  explicit prefixes with a single shared definition; domain split; committed
  stats file; quarantine rather than delete.
- **Translation model** `[R-3.1…R-3.13]` — one model, two prefixes; INT8 ONNX;
  ≤80 MB; local-only loading; single in-flight load promise; four-state status;
  **unavailable rather than fabricated output**; test-mode short-circuit;
  single-threaded WASM.
- **Lexicon and morphology** `[R-4.1…R-4.7]` — retained from v0.1, repurposed for
  analysis rather than as model input.
- **Pipeline** `[R-5.1…R-5.7]` — per-sentence; full trace; six stage states
  including `error` and `dictionary`; the empty-input guard; glossing runs
  *beside* translation, never as an input to it.
- **UI** `[R-6.1…R-6.11]` — the six screens, responsive, themed, honest
  benchmarks, download progress.
- **LLM** `[R-7.1…R-7.5]`, **Evaluation** `[R-8.1…R-8.9]`, **Training** `[R-9.1…R-9.6]`.

Worth a paragraph of its own, because examiners ask: **R-3.9 / §6 constraint 2 —
"model or nothing"**. Fluent output comes from the model or the system reports
Unavailable. No rule-based fallback sentence is ever emitted.

## 3.4 Non-Functional Requirements

- Static hosting, no server runtime `[NFR-1]`; offline after first load `[NFR-2]`;
  privacy `[NFR-3]`.
- Type safety — strict `tsc -b` in the build `[NFR-4]`; tested core — 9 test files,
  73 tests `[NFR-5]`; tests touch neither models nor network `[NFR-6]`.
- Determinism: transliteration, lookup and morphology are pure; only the model is
  stochastic, and greedy decoding makes even that reproducible `[NFR-7]`.
- **Honest reporting** `[NFR-8]` — any metric not measured on this pipeline is
  labelled unmeasured; results from other repositories are never presented as
  this system's.
- Load tolerance `[NFR-9]`, bundled Thaana font `[NFR-10]`, portability including
  pages without `SharedArrayBuffer` `[NFR-11]`, reproducible deploy `[NFR-12]`,
  repository weight `[NFR-13]`.

## 3.5 Data Requirements

- Reproduce the artefact table from §5: what ships in the repo, what is
  gitignored, and why. `[docs/REQUIREMENTS.md §5]`
- Shipped: `dictionary.json` (15,302 entries), `dictionary_stats.json`,
  `honorifics.json`, `benchmarks.json`, gold set, quarantine, round-trip stats,
  tokenizer profile, corpus stats.
- Not shipped: the parallel JSONL (`train.jsonl` alone is 189 MB), ONNX Runtime
  WASM (~21.6 MB, vendored at build time), PyTorch checkpoints. `[R-9.5]`
- **Quantity targets are requirements, not aspirations**: ≥200k pairs `[R-2.1b]`,
  ≥500 test pairs per direction `[R-8.9]`, ≥1,000 round-trip samples `[R-1.8]`,
  ≥1,000 tokenizer words `[R-9.6]`.

## 3.6 Dataset Collection

- Sources: `alakxender/dhivehi-english-translations` and
  `alakxender/dhivehi-english-parallel`. `[data/parallel/corpus_stats.json]`
- Volume: **575,892 rows read → 285,748 pairs kept**, all real; `syntheticPairs: 0`,
  `meetsStage2Target: true`. Each kept pair is written twice, once per direction,
  giving **480,018 train / 49,948 valid / 40,592 test** rows.
- Domain inventory: 18 domains. Largest: the `alakxender/dhivehi-english-parallel`
  bulk (158,462), `conversational` (41,415), `politics` (20,848), `local news`
  (11,181), `crime` (10,846).
- **Split by whole domain**, not at random `[R-2.6, R-8.8]`:
  - train — crime, local news, politics, other, and the parallel bulk
  - valid — business, international, sports
  - test — education, entertainment, environment, health, law, religion, society,
    technology, tourism
- **The one exception, and say it out loud:** `conversational` is held out *by
  row* (seeded shuffle, seed 11), so it appears in all three splits
  (76,830 / 2,984 / 2,990 written rows). Scores on those rows are in-domain and
  must be reported separately or the headline number is inflated.
- Leakage control: 418 valid and 390 test inputs removed for appearing in train,
  plus 130 valid/test overlaps. `[corpus_stats.json → leakedInputsRemoved]`
- Quarantine, not deletion: 5,000 untrustworthy rows retained in a file. `[R-2.8]`
- The lexicon collection is a separate story worth its own subsection — see the
  merge and repair figures under 5.4.

## 3.7 Data Preprocessing

- **The single most important methodological point:** Thaana is normalised to
  Latin by the project's *own* TypeScript transliterator, invoked from Python
  through `tools/transliterate.mjs` / `tools/_transliterate_bridge.py`, so
  training-time and inference-time Latin come from one code path. The
  transliterator's SHA-256 (`77a097c9…`) is pinned into the stats file, so a
  silent rule change invalidates the corpus visibly. `[R-2.2, corpus_stats.json]`
  This is also *why* the corpus is built locally rather than on Colab — it needs Node.
- The filter ladder, with counts `[corpus_stats.json → dropped]`:

  | Filter | Rows dropped |
  |---|---|
  | Length bounds | 88,111 |
  | Over 128 tokens | 83,158 |
  | Exact duplicate | 49,752 |
  | Latin text inside the Dhivehi field | 23,555 |
  | Non-ASCII in the Latin field | 17,492 |
  | Too few words | 15,382 |
  | Timestamp fragment | 9,999 |
  | Length ratio outside [0.4, 2.5] | 1,643 |
  | Near-duplicate | 629 |
  | Thaana inside the English field | 409 |
  | UI string | 14 |
  | **Total** | **290,144** |

- Prefixing: `translate Dhivehi Latin to English: ` and
  `translate English to Dhivehi Latin: `, defined once in
  `src/core/translate/prefixes.ts` and read by both the app and the corpus
  builder. Two characters of drift between corpus and runtime degrade the model
  with no error at any layer. `[R-2.5, §11 amendment 4]`
- Invariant asserted, not assumed: **no Thaana character ever reaches a model
  input**. The Colab notebook asserts it; a violation is an architecture
  violation. `[Context/TRAINING.md]`
- Max sequence length 128, tokenizer `t5-small`, split seed 11 — the same seed as
  the round-trip sample, so the sampling is reproducible.

## 3.8 Model Training Method

- One `t5-small` (60M) checkpoint, both directions by prefix. `[R-3.1, R-3.2]`
- Hyperparameters, and the reason for each `[R-9.2, tools/train_translate.py]`:

  | Parameter | Value | Rationale |
  |---|---|---|
  | epochs | 4 | inside the 3–5 low-resource band |
  | batch | 32 | t5-small @ len 128, fp16, T4 |
  | learning rate | `1e-4` | v0.1's `5e-5` was too low; `3e-4` only as a recorded ablation |
  | weight decay | `0.01` | v0.1 silently used the HF default |
  | max length | 128 | `[R-3.5]` |
  | seed | 11 | matches the corpus split |
  | fp16 | when CUDA present | CPU runs fp32 |
  | beams | 1 (greedy) | matches inference `[R-3.5]` |

- **`load_best_model_at_end=True` on `metric_for_best_model="chrf"`** — without
  it an overfitting run ships its worst weights. `[R-8.5]`
- **Metrics computed per direction as well as overall** — one mixed average can
  look acceptable while a direction has collapsed. `[R-8.4]`
- chrF++ is `sacrebleu.CHRF(word_order=2)`; bare `CHRF()` is chrF, a different
  metric. Say which you used.
- Validation subsampling: 49,948 rows would add 30–50 minutes of generation per
  epoch, so a seeded 2,000-row subset (1,000 per direction) is used for
  per-epoch selection — well clear of the ≥500-per-direction floor — with the
  full set kept for final scoring. `[Context/TRAINING.md §3]`
- Where it runs, and why not locally: the dev machine is a 2016 Intel MacBook Pro
  with no CUDA and no MPS; `torch>=2.4` has no x86_64 macOS wheel at all, and
  pinned to 2.2.2 it is 40–80 hours *per epoch*. A free Colab T4 does the run in
  ~3 hours. This is a legitimate methods paragraph, not an excuse.
- Reproducibility: the notebook **clones the repo** rather than pasting the
  trainer inline — a notebook copy is a second implementation to keep in sync,
  which is exactly what went wrong in v0.1. `[colab_train_translate.ipynb]`

## 3.9 Evaluation Method

- Four layers, and keep them distinct:
  1. **Pre-training gates** — round-trip stability and tokenizer profile, both run
     *before* training because they bound what training can achieve.
  2. **Automatic MT metrics** — BLEU and chrF++, per direction, on the
     domain-held-out test set. `[R-8.4, R-8.8, tools/evaluate.py]`
  3. **Human evaluation** — meaning (adequacy) 1–5 and naturalness (fluency) 1–5,
     with an optional corrected translation, collected in-app and exported as
     CSV. `[R-6.4, R-8.1, evaluation/HUMAN_EVAL.md]`
  4. **System/acceptance testing** — AC-1…AC-13 as the pass/fail matrix.
- A **spellability spot-check** of ≥50 random test outputs: impossible consonant
  clusters mean failure regardless of BLEU. This is Dhivehi-specific and is the
  check a BLEU score cannot make. `[R-8.6]`
- Two honesty rules to state before any number appears:
  - ratings collected against an unloaded or smoke-test model are never reported
    as results `[R-8.3]`;
  - the current gold set holds **20 pairs per direction** against a ≥500
    requirement and is not domain-held-out, so it cannot support a published
    score. `[GAP-9, M-9]`

## 3.10 Chapter Summary

---

# Chapter 4: Product Design

## 4.1 Introduction

- Signal early that this chapter documents **two** designs and the decision
  between them; the second is the delivered system.

## 4.2 System Architecture

- The v0.2 architecture in one figure — reuse the README diagram:

  ```
  Dhivehi → English
    Thaana ──[rule-based transliterator]──▶ Latin ──[T5 ONNX q8]──▶ English
                                              │
                                              └──[dictionary + morphology]──▶ glosses

  English → Dhivehi
    English ──[T5 ONNX q8]──▶ Latin ──[rule-based reverse transliterator]──▶ Thaana
  ```

- **"Latin core, Thaana edges"** as the organising principle: every NLP component
  — dictionary, morphology, model, and any LLM traffic — sees Latin only. Thaana
  exists at the two user-facing edges. `[Context/PROJECT.md]`
- Layer view: UI (React) → pipeline (`src/core/pipeline/`) → the core modules
  (transliterator, dictionary, morphology, segmenter, translate runner) → the
  ONNX runtime. No server tier exists at any point.
- Offline pipeline (`tools/`, Python + Node) is explicitly **not runtime** — it
  builds artefacts that ship.

### 4.2.1 Design iteration 1 — the semantic frame architecture (recommended subsection)

Give this its own space. It is the strongest methods material in the project.

- What it did: Latin → dictionary + morphology → a **semantic frame** → two T5
  *sentence-realization* models (`en-realize`, `dv-realize`) → sentence.
- The frame was the contract between halves: `subject, action, object, location,
  time, manner, reason, tense, polarity, register, residue`. `[Appendix A.1]`
- Two design ideas worth defending on their own merits:
  - **`residue`** — tokens the extractor could not classify are retained and
    displayed, so lossy extraction is *visible*, never silent.
  - **`register`** as a first-class slot — written Dhivehi past-tense clauses end
    in `eve` and spoken ones do not, so without the slot one frame string mapped
    to two valid sentences and the model could not learn which to emit.
- Worked example to reuse verbatim:

  ```
  I will go to Male.
  → SUBJECT=I | ACTION=go | LOCATION=Male | TENSE=future | POLARITY=affirmative | REGISTER=spoken
  → SUBJECT=aharen | ACTION=dhaa | LOCATION=male | TENSE=future | POLARITY=affirmative | REGISTER=spoken
  → aharen maleah dhaanan
  → އަހަރެން މާލެއަށް ދާނަން
  ```

- **Why it was superseded**, with the numbers `[Appendix A.3]`:
  - training pairs were combinatorial over a curated slot vocabulary — **7
    subjects, 16 verbs, 12 objects, 5 locations, 7 times** ≈ sixty content words —
    expanded to 16,141 English and 14,270 Dhivehi synthetic pairs;
  - so *"The parliament passed the amendment yesterday"* could not be translated
    **at all** — the nouns and verb were not slots;
  - the apparent scale of the training set measured combinatorial expansion, not
    linguistic coverage;
  - cost was inverted against benefit: two models, **307 MB tracked** (~148 MB
    fetched), for *less* coverage than one ~80 MB model on real parallel text.

### 4.2.2 The architectural decision (recommended subsection)

- Reproduce the ADR table `[docs/REQUIREMENTS.md §2.1]`:

  | | v0.1 | v0.2 |
  |---|---|---|
  | Neural components | 2 | 1 |
  | Coverage | ~60 slot words | open-domain, corpus-limited |
  | Training data | ~30k synthetic combinatorial | 285,748 real parallel pairs |
  | Runtime download | ~148 MB | ≤80 MB target |
  | Repo weight | 307 MB tracked | ≤80 MB tracked |
  | Failure mode | out-of-vocabulary → unavailable | out-of-domain → degraded |

- State the **accepted cost** explicitly: the frame representation was the
  project's distinctive research contribution; v0.2 trades it for coverage. The
  trade-off is argued, not hidden.
- State what **survived** the pivot — and it is most of the engineering:
  transliterator, dictionary lookup, suffix parser, honorific/register detection,
  the React UI, the Pages deployment, the stage-state trace concept, the
  "model or nothing" principle, and the empty-input regression guard. `[Appendix A.4]`
- Optional forward-looking point: the frame layer would be most defensible as an
  **interpretability overlay** on a direct model, not as the translation
  mechanism. `[Appendix A.5]`

## 4.3 Translation Pipeline

- Per-sentence processing: segment first, translate each sentence independently,
  reassemble. `[R-5.1]`
- **The trace is a design artefact, not a debug log.** Every translation records:
  input, Latin form, Thaana form, preserved segments, prefixed model input, raw
  model output, dictionary glosses, register, and per-stage state. `[R-5.2]`
- Six stage states: `done` / `empty` / `not_loaded` / `unavailable` / `error`, over
  the stages original, transliteration, dictionary, translation,
  back-transliteration, final. Explain why `error` had to be added — without it a
  failed ONNX load renders identically to "never requested". `[R-5.3, §11 amendment 5]`
- **The empty-input guard**, and why it is a named requirement: `[].every(...)`
  is vacuously true, so an earlier version reported empty input as a *successful*
  translation. The guard is `traces.length > 0 && traces.every(...)` and it has a
  test that must survive any refactor. `[R-5.4]`
- Glossing runs **beside** translation, never as an input to it; a gloss failure
  must not fail the translation. `[R-5.6]`
- Normalise once, transliterate once, reuse. `[R-5.5]`

## 4.4 Transliteration Design

- Two directions, both rule-based and deterministic: `thaanaToLatin.ts`,
  `latinToThaana.ts`, over a shared `mappings.ts`. `[R-1.1]`
- **One canonical romanization** — the constraint that makes the ten
  Arabic-derived letters many-to-one, and therefore makes exact round-trip
  mathematically impossible. That is a consequence of the design, not a bug, and
  is why R-1.8 gates on Latin-stability instead. `[R-1.2, §11 amendment 1]`
- **Preserved segments**: unknown characters (digits, Latin, punctuation) are
  passed through and *listed* on the trace as `thaanaPreserved`, never silently
  dropped — an earlier version deleted them. `[R-1.3]`
- Accented place names fold to Malé Latin (`Malé` → `male`) before conversion.
- Loanword policy: phonetic Latin at model level; an optional *display-layer*
  prettifier may show `Instagram` but must never touch model input or training
  data. `[R-1.5, R-1.6]`
- The IME as a design decision: users type Malé Latin on a QWERTY keyboard and
  get Thaana in place, with correct caret handling and backspace over a composing
  sequence — so the OS layout never has to change. `[R-1.7, useThaanaIme.ts]`
- Transliteration works with **zero model download**, so the Latin view is
  available even when the translator is unavailable. `[R-1.4]`

## 4.5 Translation Model Design

- One model, two prefixes — the alternative (two models) is explicitly forbidden.
  `[R-3.1]`
- Backbone choice and the size arithmetic: encoder ~35 MB + merged decoder ~42 MB
  + tokenizer ~2.4 MB ≈ **80 MB**, i.e. *at* the budget, not under it. Record that
  the earlier ~60 MB estimate was optimistic and was corrected. `[R-3.2]`
- The budget's **scoping** is load-bearing: 80 MB covers
  `public/models/dv-en-translate/**`; the ONNX Runtime WASM (21.6 MB) and the app
  bundle are separate line items. Read as "everything fetched at runtime" the
  budget is unachievable at *any* model size. `[R-3.4, §11 amendment 2]`
- Loading design: local-only (`allowLocalModels` true, `allowRemoteModels` false);
  load at most once with a shared in-flight promise; four-state status machine
  with the underlying error surfaced; test-mode short-circuit; single-threaded
  WASM with the proxy disabled so pages without `SharedArrayBuffer` still work.
  `[R-3.6…R-3.11]`
- Caching in the **Cache Storage API** via Transformers.js — not IndexedDB. Worth
  a sentence because the spec was wrong about this and an examiner following it
  would look in the wrong devtools panel. `[R-3.12, §11 amendment 3]`
- Ship only the graphs the runtime loads. `[R-3.13]`

## 4.6 Dictionary and Morphology Design

- Repurposed, not retired: these no longer feed a frame extractor: they power
  word-level analysis and register tagging. `[§3.4 preamble]`
- `DictionaryEntry` is `{ latin, english[], pos, frequency }`; lookup returns a
  structured `WordTranslation` including the stem and transliteration used.
  `[R-4.2, src/core/dictionary/types.ts]`
- Staged lookup: normalise → exact lookup → recursive suffix stripping
  (`MAX_STRIP_DEPTH = 3`, gated by a `known()` check) → stem lookup, with the
  parsed suffixes exposed for display. `[R-4.3, lookup.ts, suffixParser.ts]`
- Closed-class words handled separately from open-class entries `[R-4.6]`;
  prefix lookup is a binary search, not a 16k linear scan.
- Register detection from honorific and morphological evidence in
  `honorifics.json`, degrading gracefully — a honorifics load failure must reduce
  register detection only, never prevent startup. `[R-4.4, R-4.5]`
- **The `dhivehi` column does not ship**: 11,269 of 16,014 values (70.4%) were
  byte-identical to `latinToThaana(latin)`, i.e. a deterministic function of a
  field already present. Dropping it cut the file from 2,111,356 to **1,491,467
  bytes**. Thaana for display is generated at the edge. `[Context/DATA.md]`

## 4.7 User Interface Design

- Six screens and the role of each `[R-6.1…R-6.6]`:
  - **Translator** — the main artefact; auto-detects script, both directions.
  - **Breakdown** — source, Latin, word-by-word glosses with parsed suffixes,
    the prefixed model input, and the raw model output. A first-class research
    deliverable, not a debug view.
  - **Chat** — optional LLM demo; **English only** leaves the device; the LLM
    never receives Thaana.
  - **Feedback** — meaning and naturalness 1–5 plus an optional correction, CSV
    export.
  - **Benchmarks** — measured metrics only; unmeasured metrics displayed *as*
    unmeasured.
  - **About** — problem, method, architecture, limits.
- Script rendering: Chrome stays Inter/LTR; only Thaana nodes use `.font-thaana`
  (Faruma, 16px, RTL). The font is bundled so Thaana renders without a system
  font. `[NFR-10]`
- Responsive sidebar/mobile-nav split `[R-6.7]`; light/dark with a persisted
  toggle `[R-6.8]`.
- Failure-state design: dictionary loading state; on dictionary failure show the
  error and withhold the translation screens while keeping About reachable
  `[R-6.9]`; model download progress, because a silent multi-second stall on a
  tens-of-MB fetch is a defect `[R-6.10]`.
- Optional low-confidence advisory indicator that must never suppress or alter
  output. `[R-6.11]`

## 4.8 Chapter Summary

---

# Chapter 5: Software Development and Implementation

## 5.1 Introduction

- Order the chapter the way the system was built: transliterator → data →
  training → export → runtime → UI → integration. That order is also the
  dependency order, which is worth saying.

## 5.2 Development Environment

- Frontend: React 19, Vite 8, TypeScript 5.8 (strict), Tailwind 3.4, Vitest 4,
  `@huggingface/transformers` ^3.8.1, `lucide-react`. `[package.json]`
- Why the successor package over the legacy `@xenova/transformers` 2.17: it is the
  maintained line, and its `dtype` option retires v0.1's duplicate-decoder file
  hack. A move to the 4.x line is deferred until there is a trained model to
  regression-test against. `[§4.1]`
- **ONNX Runtime WASM is vendored** into `public/ort/` at build time by
  `scripts/copy-ort.mjs` (~21 MB, gitignored). Not optional: the library
  otherwise defaults `wasmPaths` to a jsDelivr CDN, which would place a
  third-party network call on the translation path in breach of NFR-2 and NFR-3.
  `[§11 amendment 6]`
- Offline tooling: Python 3 with pinned `tools/requirements.txt` /
  `requirements-train.txt`, **plus Node** — because the corpus tools call the
  project's own TypeScript transliterator.
- npm scripts as the developer contract: `dev`, `build` (`tsc -b && vite build`),
  `test`, `check:models`, `transliterate`, plus `predev`/`prebuild` ORT copy and a
  `postbuild` prune. `[package.json]`

## 5.3 Transliteration Implementation

- `mappings.ts` (92 lines) as the single source of the character tables;
  `thaanaToLatin.ts` (112) and `latinToThaana.ts` (268) as the two directions —
  the asymmetry in size is itself informative and worth one sentence.
- The improvement worth narrating in detail: **three missing inverse rules** —
  geminates, prenasalized stops, and the coda `h` / `iy` sukun specials — took
  Latin-stability from **~87% to 99.35%** on the dictionary set. This is the
  clearest before/after result in the project. `[Context/STATUS.md]`
- Two fixed defects worth naming: `latinToThaana` silently deleting unknown
  characters (now preserved and reported), and unreachable branches in the
  `އ` handling.
- Declared residual gaps: prenasalised stops still do not round-trip fully, and
  coda `h` is resolved by frequency. `[GAP-13]`
- IME implementation: composing-sequence state, caret handling, backspace over a
  partial sequence, all unit-tested. `[useThaanaIme.test.ts]`

## 5.4 Dataset Preparation

Two datasets, built by different scripts. Keep them apart in the write-up.

**The lexicon** (`tools/improve_dictionary.py` → `tools/clean_dictionary.py`)

- Merge: union on lowercased Latin across the SQLite export (15,984 unique keys),
  a second bilingual dump that **stops at ފ** (first ~10,000 Radheef headwords, 14
  Thaana letters absent — replacing rather than unioning would have deleted most
  of the lexicon), a currency database, a frequency list, and
  `tools/fritz_closed_class.json`. Result: **0 keys dropped, 30 added, 17 English
  lists unioned.** `[Context/DATA.md]`
- Repair, with the diagnostic that made it possible — Malé Latin uses no `w` or
  `x`, and `c` only in `ch`, but **does** use `q`, so `q` is not a signal of an
  English string:

  | Defect | Count | Repair |
  |---|---|---|
  | Direction-inverted rows | 585 | columns swapped |
  | Corrupt rows | 26 | quarantined, not guessed |
  | Malformed keys (`firi (firimeehaa)`) | 1,656 | split → 1,562 new reachable keys |
  | Mirror-gloss stubs | 403 repaired | frequency decides direction |
  | Mirror ties left for a human | 315 | reported, not auto-resolved |
  | POS corrections | 13 | e.g. `aharen` was tagged `noun` |

- **Shipped lexicon: 15,302 entries** from 16,014 raw rows. `clean_dictionary.py`
  refuses to write if any pre-existing Latin key would vanish without a recorded
  rewrite; every edit lands in `tools/cleanup_report.json`. That refusal is the
  data-integrity mechanism worth describing.
- Honest residue: `frequency` is a placeholder on most rows (11,091 at exactly 50,
  4,361 at exactly 1); only rows carrying `freqSource: "spelling.md"` have a real
  count. Do **not** describe it as a corpus frequency. 179 rows still have POS
  `unknown`.

**The parallel corpus** (`tools/build_translation_pairs.py`)

- Implementation detail worth a paragraph: the Python builder shells out to
  `tools/transliterate.mjs` through `tools/_transliterate_bridge.py` so the
  normalisation is literally the shipped TypeScript, and the transliterator hash
  is written into the stats file.
- The filter ladder, dedup, length-ratio bound, prefixing, domain split and stats
  emission — figures already tabulated at 3.6 and 3.7; here describe the *code
  path*, not the numbers again.
- `data/parallel/*.jsonl` is gitignored (`train.jsonl` is 189 MB); the committed
  evidence is `corpus_stats.json`. Explain that choice — a repo is not a data
  warehouse, and the stats file is the reproducibility contract. `[R-2.1b]`

## 5.5 Model Training

- `tools/train_translate.py`: `PairDataset` loader (adapted from v0.1's
  `FrameDataset` rather than rewritten), `Seq2SeqTrainer`,
  `predict_with_generate`, per-direction BLEU/chrF++ in `compute_metrics`,
  `load_best_model_at_end` on chrF++.
- The `--smoke` path and the trap in it: `PairDataset` parses all 480k rows
  *before* `--smoke` truncates them, so slice the file first with `head`. Worth
  including — it is the kind of detail that shows the tooling was actually used.
- Colab procedure `[colab_train_translate.ipynb]`: T4 assertion cell → corpus in
  via **Drive**, not `files.upload()` (which stalls at 189 MB) → property
  assertions on the corpus (prefix present, both directions present, no Thaana in
  any model input, no valid input also in train) → training → probe → export.
- ~15,000 steps per epoch; keep the tab visible or the session dies at ~90
  minutes idle.
- Evidence to capture for the write-up: screenshot the per-epoch metric table. It
  is the proof that the checkpoint was selected on a metric rather than on the
  last epoch, and it goes in the report alongside `t5-small`, pair counts, epochs,
  LR, batch size, fp16, and **T4**.
- Diagnostic rules to record: validation metric peaking early → overfitting, drop
  to 3 epochs; loss near zero from step one → the model is copying, check input ≠
  target; one direction's chrF++ far below the other → never report the mixed
  average alone.
- Status: **run and recorded.** t5-small,
  4 epochs = 60,004 steps at batch
  32, lr 0.0001, fp16 on a T4.
  The session dropped at epoch 3 and was resumed from `checkpoint-45003`
  (step 45,003), which is why the metric series changes shape there:
  the resumed leg evaluated every 500 steps against a
  2,000-row validation subsample, where epochs 1–3 used the full 49,948-row split. The two
  populations are tagged separately in `evaluation/training_curve.json` and drawn as separate
  series in `docs/figures/training_curve.svg`; averaging them would be wrong.
  Best validation chrF++ **34.2833**, and the checkpoint was selected on it rather
  than on the last epoch — which is the diagnostic this section asks for, since eval loss is
  *higher* at epoch 4 than at epoch 3 while chrF++ is higher too.
  `[evaluation/training_curve.json, docs/figures/training_curve.svg, docs/figures/training_loss_lr.svg]`

## 5.6 ONNX Conversion and Quantization

- `tools/export_onnx.py` — the script v0.1 never had, which is exactly how 307 MB
  of models ended up containing ~162 MB of graphs the runtime never loads.
- **It refuses to write** rather than ship something that fails in the browser.
  Three assertions, each with a concrete failure mode behind it:
  1. the merged decoder really exposes `use_cache_branch` — this is what makes
     v0.1's `runBeam` monkey-patch unnecessary;
  2. each quantized graph actually shrank — `quantize_dynamic` silently skips `If`
     subgraphs without `extra_options={"EnableSubgraph": True}`, leaving a file
     that is fp32 inside at ~160 MB;
  3. the total is inside the **80 MB** budget, scoped to the model directory.
- Runtime files are exactly what Transformers.js fetches and nothing else:
  `config.json`, tokenizer files, `encoder_model_quantized.onnx`,
  `decoder_model_merged_quantized.onnx`. `[R-3.13]`
- The dead weight this replaces, quantified: of four ONNX graphs per v0.1 model,
  `decoder_with_past_model_quantized.onnx` (37 MB) is never loaded and
  `decoder_model_quantized.onnx` (40 MB) duplicates the merged file — roughly
  150 MB of 307 MB was dead. `[R-3.13 note]`
- Contingency if the budget gate fails: vocabulary trimming first, and it must
  happen **before** retraining, not after.
- Status: **exported and within budget.** 70.85 MB of the
  80 MB ceiling (88.6%):
  encoder 31.10 MB, merged decoder
  37.89 MB, tokenizer
  1.86 MB, opset 14, QInt8. The contingency above was
  exercised: the untrimmed export measured 80.27 MB, so `tools/trim_vocab.py` cut the
  embedding from 32,128 to 23,505 rows
  (73.2% kept, 23,404 ids actually seen across
  1,141,116 corpus texts) for ~8.8 MB across the two shipped
  graphs — **before** retraining, and without needing it.
  `[export_stats.json, evaluation/trim_stats.json, docs/figures/model_size_vs_budget.svg]`

## 5.7 Translation Pipeline Implementation

- `src/core/translate/runner.ts` (237 lines) — the loader, the four-state status
  machine, the shared in-flight promise, and the single-threaded WASM
  configuration. Note that it was **refactored from** `realization/runner.ts`
  rather than rewritten, as the requirements direct. `[R-3.6…R-3.11]`
- `prefixes.ts` (41 lines) as the single definition of the two task prefixes,
  imported by both the app and the corpus builder. `[R-2.5]`
- `dvToEn.ts` (82) and `enToDv.ts` (76): normalise once → segment → per sentence
  transliterate, gloss (in parallel, non-blocking), prefix, run, back-transliterate
  → assemble, with a trace per stage.
- `segmenter/textProcessor.ts` (141): script-aware segmentation treating `.`,
  `۔`, `؟` and line breaks as boundaries, collapsing terminator runs and never
  emitting letterless fragments. `[R-5.7, GAP-12 closed]`
- Model-absent behaviour, which is a feature: stages report `not_loaded`, the
  final result is `unavailable`, and no sentence is fabricated. `[R-3.9, AC-3]`

## 5.8 User Interface Implementation

- `App.tsx` as the shell: dictionary bootstrap, honorifics with graceful
  degradation (`App.tsx:22-28` implements R-4.5), routing across the six screens.
- Screens with line counts as a rough complexity indicator: `Chat.tsx` (204),
  `Translator.tsx` (146), `Feedback.tsx` (80), `About.tsx` (79),
  `Benchmarks.tsx` (77), `Breakdown.tsx` (33) — Breakdown is thin because the
  work lives in `TraceView.tsx`.
- `TraceView.tsx` renders the stage states, which is where R-5.3's `error` state
  becomes visible to a user.
- LLM adapter (`src/llm/`): OpenAI-compatible and Ollama providers over
  `/chat/completions`; the `browser` provider is declared but unconfigured and
  must fail with a clear message rather than silently; key storage in
  `sessionStorage` by default with opt-in `localStorage`. `[R-7.1…R-7.5]`
- Feedback storage under `latin-mv-tlt:feedback` with id, ISO timestamp,
  direction, source, generated text, both scores and correction; CSV export with
  correct quoting/escaping. `[R-8.1, R-8.2]`

## 5.9 System Integration

- CI/CD: push to `main` runs tests, the typecheck **and** the model-budget gate
  before deploying to GitHub Pages with `npm ci`. Note that CI ran no tests before
  v0.2. `[NFR-5, NFR-12, AC-8]`
- `npm run check:models` (`scripts/check-models.mjs`) enforces the 80 MB budget as
  a *deploy blocker*, so the budget is verified in three independent places:
  export script, CI gate, and a cold-cache devtools check. `[AC-10]`
- `scripts/copy-ort.mjs` / `prune-ort-assets.mjs` in `prebuild`/`postbuild`.
- Base path `/latin-mv-tlt/` for Pages, and the consequence developers hit — the
  dev server serves under that path, not the site root.
- `node tools/smoke_translate.mjs "aharen maleah dhaanan"` as the pre-browser
  check on an export, under Node, before WASM is involved.
- Gitignore policy as an engineering decision: `*.safetensors`, `*.pt`,
  `/models/`, `data/parallel/*.jsonl`, `public/ort/`. `[R-9.5]`
- The honest caveat about repository weight: deleting 307 MB from the working
  tree does **not** shrink git history; a `filter-repo` rewrite is a separate
  destructive decision and is explicitly not authorised. `[§8 M-8 caveat]`

## 5.10 Chapter Summary

---

# Chapter 6: Testing and Evaluation

## 6.1 Introduction

- State up front what exists and what does not, so the chapter reads as honest
  rather than incomplete: pre-training gates and the software test suite are
  measured; translation metrics await the checkpoint. `[NFR-8, GAP-2, GAP-4]`

## 6.2 Testing Approach

- Four levels: unit (Vitest), gate measurements (Python + Node tooling),
  acceptance criteria AC-1…AC-13, and human evaluation.
- Unit suite: **9 test files, 73 tests**, covering transliterator, dictionary,
  morphology (stemming and suffix parsing), segmenter, pipeline, translation
  runner and IME. `[NFR-5, Context/STATUS.md]`
- **Tests touch neither models nor the network** — enforced by a `MODE === 'test'`
  short-circuit in the translation runner, so the suite is fast and deterministic
  and can run in CI without a 80 MB download. `[NFR-6, R-3.10]`
- Vitest runs in `environment: 'node'`; there is therefore **no DOM and no
  component test**. Declare it. `[Context/STATUS.md → Open]`
- Regression tests as documentation of past defects — the empty-input guard test
  is the clearest example. `[R-5.4]`

## 6.3 Transliteration Testing

- Unit level: `transliterator.test.ts` (153 lines) and `useThaanaIme.test.ts`.
- **The three-figure round-trip metric** and why it is three figures — weakest
  claim to strongest `[R-1.8, §11 amendment 1]`:
  - *exact* — raw Thaana equality;
  - *exact after folding* the ten Arabic-derived letters onto native counterparts;
  - *Latin-stable* — whether the round-tripped Thaana reads out to the **same
    Latin**, which is what actually bounds training quality, because the model
    only ever sees the Latin.
- Two measurements, on different populations — report both:

  | Population | Samples | Exact | Folded | **Latin-stable** | Source |
  |---|---|---|---|---|---|
  | Dictionary entries | 15,201 | 88.13% | 88.96% | **99.35%** | `evaluation/roundtrip_stats.json` |
  | Corpus sentences | 5,000 | 27.50% | 34.32% | **99.80%** | `evaluation/roundtrip_stats_corpus.json` |

- The corpus row is the more interesting result and deserves the analysis: exact
  match collapses to 27.5% on real sentences while Latin-stability *rises* to
  99.8%. Explain why — the dominant failing class is `spelling_normalised`
  (3,274 of 5,000): the source Thaana is nonstandard and the round trip
  **corrects** it, leaving the Latin unchanged. Exact-match would have punished
  the transliterator for being right.
- Failing-class breakdown on the corpus sample: `spelling_normalised` 3,274,
  `variant_fold` 341, `coda_h_ambiguity` 6, `unmapped_char` 2, `prenasalized` 2.
  Levenshtein per character 0.021.
- Gate: ≥98% Latin-stable, measured **before** corpus construction and training.
  Both populations pass. `[AC-11]`
- `benchmarks.json` now carries both populations and matches these figures, so
  a Benchmarks screenshot and this table agree.

## 6.4 Translation Evaluation

- Method first: greedy decoding, max length 128, per-direction scoring on the
  domain-held-out test split (40,592 rows across nine unseen domains).
- **The conversational caveat, restated where the numbers appear:** those rows are
  held out by row and appear in all three splits, so their scores are in-domain
  and must be reported as a separate line — mixing them inflates the headline.
  `[corpus_stats.json → conversationalHoldout]`
- Gold set status: 20 verified pairs per direction today against a ≥500
  requirement, and not domain-held-out — so no score is publishable until M-9
  extends it. `[R-8.7, R-8.9, GAP-9]`
- Report both directions separately in every table.

### 6.4.1 BLEU

- Definition, tokenization sensitivity, and the specific reason it is unreliable
  here: Dhivehi's suffix-heavy morphology means a correct translation with a
  different case suffix scores as a whole-word miss.
- State the tokenizer/`sacrebleu` configuration you used, so the number is
  reproducible.
- Configuration: `sacrebleu.BLEU()` at defaults (13a tokenization), scored per direction
  and per holdout kind, never as one mixed average. `[R-8.4]`
- Results, stratified 500-pair-per-direction sample of the 40,592-row test split, not the full split:

  | | dv→en | en→dv |
  |---|---|---|
  | held-out domains (n=500 per direction) | **3.63** | **3.22** |
  | conversational, in-domain (n=500) | 12.98 | 8.81 |

  The row gap is larger than the column gap, which is the finding: unseen subject
  matter costs this model more than direction does. The conversational rows are a
  *row*-level holdout from a register the model trains on, so they are not
  comparable to the domain holdouts and are never averaged with them.
  `[evaluation/scores.json, evaluation/scores_conversational.json, docs/figures/scores_by_direction.svg, docs/figures/heldout_vs_indomain.svg]`

### 6.4.2 chrF++

- Character n-gram F-score with word order 2; why it is the primary metric for
  this language pair. Note the implementation detail that matters:
  `sacrebleu.CHRF(word_order=2)`; bare `CHRF()` is chrF, a different metric.
- chrF++ is also the **checkpoint-selection** metric, so the two uses should be
  distinguished in the text. `[R-8.5]`
- Results, same test sample as §6.4.1:

  | | dv→en | en→dv |
  |---|---|---|
  | held-out domains | **22.70** | **29.00** |
  | conversational, in-domain | 28.05 | 30.03 |

  Note the disagreement with BLEU worth discussing: on the held-out domains en→dv
  scores *lower* than dv→en on BLEU (3.22 vs 3.63) but
  *higher* on chrF++ (29.00 vs 22.70). That is the
  morphology argument made concrete — a Dhivehi Latin output with the wrong case suffix is a
  whole-word miss for BLEU and a near-miss for a character n-gram metric, which is exactly
  why chrF++ is the primary metric here and the checkpoint-selection metric. `[R-8.5]`
  `[evaluation/scores.json, evaluation/scores_conversational.json]`

### 6.4.3 Spellability spot-check (recommended subsection)

- ≥50 random test outputs manually checked for whether the generated Latin is
  actually **spellable in Dhivehi**; impossible consonant clusters are a failure
  regardless of BLEU. `[R-8.6]`
- This is the check no automatic metric performs, and it is Dhivehi-specific —
  worth arguing as a methodological contribution.
- Results: **2 of 50** sampled en→dv
  outputs on the held-out domains contain a `w`, `x`, or a `c` outside the digraph `ch`;
  **0 of 50** on the in-domain sample.
  The rule is mechanical (`Male Latin has no w or x, and uses c only in the digraph ch`) and the flagged strings are kept in
  `evaluation/scores.json` so a reader can judge them rather than take the count on trust.
  A low count here is a weaker claim than it looks: it says the model's Latin is *writable*,
  not that it is *right*. `[R-8.6, evaluation/scores.json]`

## 6.5 Human Evaluation

- Protocol: Dhivehi-speaking raters use the Feedback screen on their own device;
  ratings persist in `localStorage` and export as CSV; an optional corrected
  translation is captured alongside. `[evaluation/HUMAN_EVAL.md, R-8.1]`
- Report rater count, sentence count per direction, and inter-rater agreement if
  more than one rater.
- **The rule that governs this whole section:** ratings collected against an
  unloaded or smoke-test model are never reported as final results, and items
  must be regenerated after a real checkpoint is installed. `[R-8.3]`
- Two known implementation defects to fix before collecting data — the CSV blob
  URL is revoked immediately after `a.click()` (breaks Firefox/Safari), and the
  `correction` field is not sanitised against spreadsheet formula injection.
  `[Context/STATUS.md]`

### 6.5.1 Meaning Rating

- Adequacy, 1–5: is the meaning preserved? Give the rubric you handed raters.
- Results: `⟨fill after M-3/M-4⟩`

### 6.5.2 Naturalness Rating

- Fluency, 1–5: would a Dhivehi speaker write it this way? Independent of whether
  the meaning is right — say why the axes are scored separately.
- Results: `⟨fill after M-3/M-4⟩`

## 6.6 System Testing

- Present AC-1…AC-13 as a pass/fail matrix with evidence per row. Current state:

  | | Criterion | Status |
  |---|---|---|
  | AC-1 | `npm ci && npm run build` succeeds; `npm test` passes offline | Pass — 73 tests, 9 files |
  | AC-2 | Translator produces output with the model present | ⟨after M-4⟩ |
  | AC-3 | Model removed → `not_loaded` / `unavailable`, nothing fabricated | Pass |
  | AC-4 | Breakdown shows source, Latin, glosses, model input, model output | Pass |
  | AC-5 | Feedback persists and exports valid CSV | Pass (see 6.5 defects) |
  | AC-6 | Benchmarks shows no unmeasured metric as measured | Pass |
  | AC-7 | Chat sends English only; fails clearly with no key | Pass |
  | AC-8 | Push to `main` deploys to Pages | Pass |
  | AC-9 | BLEU + chrF++ on ≥500 pairs/direction, plus spellability check | ⟨after M-3/M-4, M-9⟩ |
  | AC-10 | Model directory ≤80 MB, verified three ways | ⟨after M-4⟩ |
  | AC-11 | Round-trip measured over ≥1,000 samples, all three figures | **Pass** — 15,201 and 5,000 samples |
  | AC-12 | Tokenizer profile published before the training run it gates | **Pass** |
  | AC-13 | Corpus stats record stage counts and real/synthetic split | **Pass** |

- Also worth reporting here: **tokenizer profiling** `[R-9.6, M-2b]` —
  2,000 word types from `train.jsonl` against the `t5-small` vocabulary,
  **0 words containing `<unk>` (0.0%, gate ≤5%)**, mean **5.697 pieces per word**,
  histogram peaking at 5 pieces with a tail to 15.
  `[evaluation/tokenizer_profile.json]`
  - The interesting reading: Dhivehi Latin never falls out of vocabulary, but it
    fragments heavily — ~5.7 subwords per word against roughly 1.3 for English —
    which is a real cost in effective sequence length and is an argument for
    vocabulary work in future iterations. Do not report the 0% without this.
- Cross-browser checks against NFR-11, including a page without
  `SharedArrayBuffer`; cold-cache first load and a hard reload confirming no
  weight refetch (Application → **Cache Storage**). `[R-3.12, AC-10]`

## 6.7 Results

- Structure the section as: pre-training gates (measured) → automatic metrics
  (measured) → human ratings (**still pending**) → acceptance matrix.
- Every table this section asks for now has a rendered figure and a CSV of the exact
  plotted numbers beside it in `docs/figures/`, generated by `tools/render_figures.py`
  from the committed artefacts — so an appendix table and its figure cannot disagree:

  | Table | Figure | CSV |
  |---|---|---|
  | round-trip, both populations | `roundtrip_three_figures` | `.csv` alongside |
  | round-trip failure classes | `roundtrip_failure_classes` | ″ |
  | tokenizer profile | `pieces_per_word` | ″ |
  | cross-tokenizer script comparison | `tokenizer_tokens_per_sentence`, `tokenizer_information_loss`, `tokenizer_worked_example` | ″ |
  | browser-footprint comparison | `model_size_vs_budget`, `vocab_vs_thaana_coverage` | ″ |
  | corpus composition and split | `corpus_funnel`, `corpus_domains_splits` | ″ |
  | training curve | `training_curve`, `training_loss_lr` | ″ |
  | per-direction BLEU / chrF++ | `scores_by_direction`, `heldout_vs_indomain` | ″ |
  | human means and SDs | — | **not collected** `[GAP-3]` |
  | the AC matrix | `acceptance_criteria`, `budget_vs_actual` | ″ |

- The only cells that keep their `⟨fill after M-3/M-4⟩` marker are the human ratings
  in §6.5. Nothing here estimates them. `[NFR-8]`

## 6.8 Discussion

The strongest material in the chapter. Suggested arguments:

- **The pivot hypothesis is supported at the representation level** — 99.8%
  Latin-stability on real sentences and 0% `<unk>` mean the Latin IR loses almost
  nothing and is fully in-vocabulary. Whether it is supported at the *translation*
  level is `⟨pending M-3⟩`. Be precise about which half you have evidenced.
- **Exact-match would have been the wrong gate**, and the corpus measurement
  proves it: 27.5% exact vs 99.8% Latin-stable, with the gap dominated by the
  transliterator *correcting* nonstandard source spelling. A methodological point
  that generalises to other pivot systems.
- **Fragmentation is the cost of the pivot**: 5.697 pieces per word is the price
  of using an English-trained vocabulary on Dhivehi Latin, and it is invisible to
  the `<unk>` rate.
- **Scale is not coverage** — v0.1's 30k training pairs came from ~60 content
  words. The v0.2 corpus at 285,748 real pairs across 18 domains is a different
  kind of number. Say plainly that the earlier figure measured combinatorial
  expansion.
- **The lookup layer, not the model, is the current quality ceiling for analysis.**
  An 84-sentence trace dump produced **373 unknown occurrences / 292 distinct
  unknown forms**; most are inflected forms of lemmas already in the lexicon
  (`kotareege` → `kotari` + `-ge`), not missing words. T5 cannot recover meaning
  the analysis layer already lost. `[Context/QUALITY.md]`
- **The dictionary is lexical, not translation-oriented** — Radheef definitions
  ("a kind of fish") reaching `english[0]` is a bounded, diagnosed cause of poor
  EN→DV lexical choice, and it is lexicography work, not engineering.
- **Budget honesty**: t5-small INT8 lands *at* 80 MB, so the architecture has no
  headroom. NLLB includes Dhivehi and would likely translate better, but at
  ~120–150 MB it forfeits the browser-only premise. Name the trade-off rather
  than implying the small model was free.
- Threats to validity: news-domain skew; a single-rater human evaluation if that
  is what you run; the conversational split being in-domain; a gold set below the
  R-8.9 floor until M-9.

## 6.9 Chapter Summary

---

# Chapter 7: Conclusion

## 7.1 Project Summary

- Restate the aim and the answer in one paragraph, with the scope of the answer
  stated exactly: the representation-level claim is measured; the
  translation-level claim is `⟨pending M-3/M-4⟩`.
- One sentence per delivered component: transliterator, corpus, lexicon, browser
  application, evaluation harness.

## 7.2 Achievement of Aim and Objectives

- Objective-by-objective table (O1…O8 from 1.4.2) with status and the artefact
  that evidences it. Expected shape at time of writing:

  | Objective | Status | Evidence |
  |---|---|---|
  | O1 transliterator | Met | `src/core/transliterator/`, 153-line test file |
  | O2 round-trip ≥98% | **Met** | 99.35% / 99.80% Latin-stable, two populations |
  | O3 corpus | **Met** | 285,748 real pairs, 18 domains, domain-held-out split |
  | O4 tokenizer profile | **Met** | 0.0% `<unk>`, 5.697 pieces/word |
  | O5 train model | ⟨M-3⟩ | scripts and notebook committed and rehearsed |
  | O6 export ≤80 MB | ⟨M-4⟩ | `export_onnx.py` with three refuse-to-write assertions |
  | O7 browser app + trace | Met | six screens, 73 tests, deployed to Pages |
  | O8 evaluation | Partly | harness and gold-set method ready; scores ⟨pending⟩ |

- Do not soften the two unmet rows. A clearly bounded gap with committed,
  rehearsed tooling reads better than a vague claim.

## 7.3 Main Findings

- Latin as an intermediate representation for Dhivehi is **empirically stable**:
  99.8% Latin-stable on real sentence data, 0% out-of-vocabulary.
- The gate you choose changes the conclusion: exact-match round-trip would have
  reported 27.5% and condemned a transliterator that was in fact normalising
  correct output.
- Subword fragmentation, not vocabulary coverage, is the real tokenization cost
  of the pivot.
- Interpretable architectures can fail on **coverage** rather than on quality —
  v0.1's frame pipeline was clean and inspectable and still could not translate
  most sentences.
- Measuring before training is cheap and decisive: two gates costing no GPU time
  bounded everything downstream.
- Data quality, not model capacity, is the binding constraint for Dhivehi MT at
  this scale.

## 7.4 Project Limitations

- No trained checkpoint at submission, therefore no BLEU/chrF++/human ratings on
  this pipeline. `[GAP-2, GAP-3, GAP-4]`
- Gold set at 20 pairs per direction against a ≥500 requirement, and not
  domain-held-out. `[GAP-9]`
- 307 MB of v0.1 models still tracked in git, and history cannot be shrunk without
  an unauthorised destructive rewrite. `[GAP-5, §8 M-8 caveat]`
- No back-translation pipeline. `[GAP-10 — but restate it as *pipeline absent*,
  not *corpus too small*: the ≥200k target was met with real data]`
- Known runtime defects, declared rather than hidden `[Context/STATUS.md]`:
  `segmentSentences` producing junk fragments on `"Dr. Smith went."`;
  `tokenizeWords` shredding decimals (`"3.14"`); three divergent tokenizers so
  the Breakdown word list can differ from the analysis; contradictory suffix
  tables (`kamah`); lossy closed-class round trips (`work → kurun → do`); a
  dark-mode toggle that ignores `prefers-color-scheme`; an LLM adapter with no
  `AbortController`; no component tests.
- Lexicon residue: 315 mirror ties, 26 quarantined rows, 179 `unknown` POS,
  placeholder frequencies. `[Context/DATA.md]`
- Single-developer evaluation resources; no controlled user study.

## 7.5 Future Work

Ordered as the project itself orders it — lookup before more training. `[Context/QUALITY.md → Work order]`

1. **Complete M-3/M-4**: train, export, measure, publish; then M-9 (gold set to
   ≥500 verified pairs per direction) and M-10 (reset and republish benchmarks).
2. **Fix the analysis layer before retraining**: staged lookup with recursive
   suffix and vowel-change stem generation (`kotareege` → `kotari` + `-ge`), using
   the 84-sentence trace dump as an unknown-rate regression set; resolve the
   contradictory suffix tables.
3. **Translation glosses vs Radheef definitions**: split `DictionaryEntry` into
   `english_gloss` / `semantic_class` / `definition` and stop feeding
   `english[0]` into translation; add sense selection for homographs (`bura`,
   `haradhu`).
4. **Sentence-type and intent slots** for conversational translation, with a
   target inventory of **30–50 sentence structures** rather than full grammar
   coverage.
5. **Placeholder scheme** for numbers, locations, dates, names and technical terms
   (`<NUM_1>`, `<LOCATION_1>`) so the open class is not memorised.
6. **Register as grammatical features**, with the formal second-person rule
   enforced: suppress the plain pronoun and use honorific verb morphology; a
   `kaley*` blocklist checked after Latin realization and before Thaana. Cite the
   descriptive-grammar source for why this is a correctness issue, not style.
7. **Stage 2 back-translation** (M-11) with provenance labelling, excluded from
   the test set, compared against the Stage 1 baseline.
8. **Document-level path**: Web Worker, progress reporting, paragraph-preserving
   reassembly, and a rolling context object for pronoun and place resolution.
9. **Revisit the frame layer as an interpretability overlay** on the direct model
   — the Breakdown screen's teaching value without the sixty-word coverage cap.
   `[Appendix A.5]`
10. Larger backbone (`flan-t5-base`, NLLB) *only* with an explicit, recorded
    decision about the 80 MB budget. `[R-3.3]`
