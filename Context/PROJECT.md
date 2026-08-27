# Project

Working notes for **latin-mv-tlt**. This folder is not the dissertation.

> **v0.2.** This file described the semantic-frame architecture until the v0.2
> migration; it was the last document still doing so. Frames, `en-realize` and
> `dv-realize` are gone, and `src/core/frames/` and `src/core/realization/` are
> deleted. The superseded design is recorded in [`docs/DESIGN.md`](../docs/DESIGN.md)
> Appendix A and `docs/REQUIREMENTS.md` Appendix A — deliberately, because the
> decision between the two architectures is examinable material. It is not what
> the code does.

**Research question:** Can Dhivehi be translated to and from English through a
Latin intermediate representation, with the script handled by deterministic rules
and every intermediate step visible?

This is not "Dhivehi ChatGPT." It is a method for translating through Malé Latin
with visible intermediate steps. The product is the **translation pipeline**. AI
chat is a demonstration of that pipeline. The LLM is optional; the translator
must work with no API key.

```text
Dhivehi → English
  Thaana ──[rule-based transliterator]──▶ Latin ──[T5 ONNX q8]──▶ English

English → Dhivehi
  English ──[T5 ONNX q8]──▶ Latin ──[rule-based reverse transliterator]──▶ Thaana
```

One seq2seq model serves both directions, selected by a task prefix. It is not
two models, and it never sees Thaana.

The LLM sits outside that:

```text
Your Translator → English → Optional LLM → English → Your Translator
```

Data: [DATA.md](DATA.md). Training: [TRAINING.md](TRAINING.md). Measured state:
[STATUS.md](STATUS.md). Next quality cycle: [QUALITY.md](QUALITY.md). Design:
[`docs/DESIGN.md`](../docs/DESIGN.md). Requirements:
[`docs/REQUIREMENTS.md`](../docs/REQUIREMENTS.md).

## Latin core, Thaana edges

The NLP core is Latin only: dictionary processing, morphology, the model and all
LLM traffic use Dhivehi Latin and English. The user reads and writes **Thaana**.

```text
USER Thaana
  → Thaana → Latin
  → LATIN CORE (dictionary, morphology, T5)
  → Latin → Thaana
USER Thaana
```

The model never learns Thaana. `latinToThaana` runs **after** inference. Unknown
characters are copied through and listed on the pipeline trace as
`thaanaPreserved`. Accented place names fold to Malé Latin (`Malé` → `male`)
before conversion.

A Thaana codepoint in a model input, a model target or a training pair is an
architecture violation, not a data-quality issue. The corpus builder drops such
rows (`latin_in_dhivehi`, `thaana_in_english`) and the training notebook asserts
against them.

The shipped lexicon has no `dhivehi` column — 70.4% of it was byte-identical to
`latinToThaana(latin)`. Thaana for display is generated at the edge, not stored.
Gold sentences and corpus JSONL stay Latin; Thaana in those files is a bug.

Chrome stays Inter / LTR. Only Thaana nodes use `.font-thaana` (Faruma, 16px,
RTL). Dhivehi input (Translator DV → EN and Chat) converts Malé Latin from a
QWERTY keyboard (`aharen` → `އަހަރެން`) so the OS layout does not need to change.
English → Dhivehi input stays English.

## Pipelines

Browser-only Vite + React + TypeScript. No Flask. No accounts. GitHub Pages hosts
the static build. Python under `tools/` is for corpus building, export, training
and benchmarks — not the runtime.

### Dhivehi → English

```text
Thaana (or Dhivehi Latin)
  → normalise
  → segment into sentences
  → Thaana → Latin (if the input was Thaana)
  → prefix:  "translate Dhivehi Latin to English: "
  → T5 (ONNX q8, greedy, 128 in / 128 out)
  → English
        └─ beside it, never into it: dictionary + morphology glosses, register
```

### English → Dhivehi

```text
English
  → normalise
  → segment into sentences
  → prefix:  "translate English to Dhivehi Latin: "
  → T5 → Dhivehi Latin
  → Latin → Thaana
  → Dhivehi
        └─ beside it: dictionary glosses
```

Example:

```text
I will go to Male.
        ↓
translate English to Dhivehi Latin: I will go to Male.
        ↓
aharen maleah dhaanan
        ↓
އަހަރެން މާލެއަށް ދާނަން
```

## Model-or-nothing

The model is the only thing that produces a sentence. There is no template
English, no gloss-concatenation fallback, and nothing invented in its place. If
the model is not loaded, the trace still shows everything up to it and the final
translation stays Unavailable.

```text
Original       ✓
Latin          ✓
Dictionary     ✓
Model input    ✓   (shown verbatim, prefix included)
Model output   Not loaded
Final          Unavailable
```

Weights are local q8 ONNX files in `public/models/` and load with
Transformers.js. First load fetches them from the same origin; afterwards the
Cache Storage API holds them, so translation runs offline. The ONNX Runtime WASM
is vendored into `public/ort/` at build time — no CDN is on the translation path.
A full offline LLM is not required.

API keys: `sessionStorage` by default; optional "Remember on this device" uses
`localStorage`. Never in git, source, or CSV exports. Feedback ratings stay in
localStorage and export as CSV.

## Seven screens

- **Translator** — main artefact
- **Sentence Breakdown** — viva / research view
- **Dictionary** — searchable lexicon browser; the shipped entries as they are
- **AI Chat** — application / demo
- **Feedback** — meaning and naturalness ratings, CSV export
- **Benchmarks** — pipeline metrics only, unmeasured shown as unmeasured
- **About** — problem, idea, architecture, limits

## Scope

MUST: Vite app + seven screens; Latin core with Thaana at the edges; rule-based
transliteration both ways with a measured round-trip rate; dictionary +
morphology glossing; pipeline traces without the model; Translator + Breakdown;
parallel-corpus generation; train / export the translation model; plug it into
both directions; evaluation + local feedback.

SHOULD: LLM API adapter + AI Chat + local key store; Feedback / Benchmarks /
About filled.

OPTIONAL: Ollama, browser LLM, PWA install.

Out of scope: login, profiles, cloud DB, admin, history server, voice, OCR,
images, documents, mobile app, foundation-model training, multi-provider billing,
collaborative dictionary editor.
