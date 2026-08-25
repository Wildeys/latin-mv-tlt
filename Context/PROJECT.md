# Project

Working notes for **latin-mv-tlt**. This folder is not the dissertation.

**Research question:** Can Dhivehi sentences be translated through a Latin intermediate representation using dictionary lookup, linguistic analysis, semantic frames, and small sentence-realization models?

This is not “Dhivehi ChatGPT.” It is a method for translating through Malé Latin with visible intermediate steps. The product is the **translation pipeline**. AI chat is a demonstration of that pipeline. The LLM is optional; the translator must work with no API key.

```text
Dictionary / rules
        ↓
Semantic representation
        ↓
Small trained realization model
        ↓
Translation
```

The LLM sits outside that:

```text
Your Translator → English → Optional LLM → English → Your Translator
```

Data: [DATA.md](DATA.md). Training: [TRAINING.md](TRAINING.md). Measured state: [STATUS.md](STATUS.md). Next quality cycle: [QUALITY.md](QUALITY.md).

## Latin core, Thaana edges

The NLP core is Latin only: dictionary processing, frames, training data, T5, and LLM traffic use Dhivehi Latin and English. The user reads and writes **Thaana**.

```text
USER Thaana
  → Thaana → Latin
  → LATIN CORE (dictionary, morphology, frames, T5)
  → Latin → Thaana
USER Thaana
```

The T5 models never learn Thaana. `latinToThaana` runs **after** inference. Unknown characters are copied through and listed on the pipeline trace as `thaanaPreserved`. Accented place names fold to Male Latin (`Malé` → `male`) before conversion.

The shipped lexicon has no `dhivehi` column. Thaana for display is generated at the edge, not stored in `dictionary.json`. Gold sentences and realization JSONL stay Latin; Thaana in those files would be a bug.

Chrome stays Inter / LTR. Only Thaana nodes use `.font-thaana` (Faruma, 16px, RTL). Dhivehi input (Translator DV → EN and Chat) converts Male Latin from a QWERTY keyboard (`aharen` → `އަހަރެން`) so the OS layout does not need to change. English → Dhivehi input stays English.

## Pipelines

Browser-only Vite + React + TypeScript. No Flask. No accounts. GitHub Pages hosts the static build. Python under `tools/` is for export, pair generation, training, and benchmarks — not the runtime.

### Dhivehi → English

```text
Thaana (or Dhivehi Latin)
  → Thaana → Latin (if the input was Thaana)
  → Dictionary + morphology
  → Segmentation
  → Semantic frame (English slot values)
  → English realization T5
  → English
```

### English → Dhivehi

```text
English
  → English sentence analysis
  → Semantic frame (English slot values)
  → Map English slots → Dhivehi Latin
  → Dhivehi Latin frame
  → Dhivehi Latin realization T5
  → Dhivehi Latin
  → Latin → Thaana
  → Dhivehi
```

Example:

```text
I will go to Male.
        ↓
SUBJECT=I | ACTION=go | LOCATION=Male | TENSE=future | POLARITY=affirmative | REGISTER=spoken
        ↓
SUBJECT=aharen | ACTION=dhaa | LOCATION=male | TENSE=future | POLARITY=affirmative | REGISTER=spoken
        ↓
aharen maleah dhaanan
        ↓
އަހަރެން މާލެއަށް ދާނަން
```

## Semantic frame

```json
{
  "subject": "I",
  "action": "go",
  "object": null,
  "location": "Male",
  "time": null,
  "manner": null,
  "reason": null,
  "tense": "future",
  "polarity": "affirmative",
  "register": "spoken",
  "residue": []
}
```

Missing fields stay empty. `residue` holds tokens the extractor could not classify — they are not silently discarded. `polarity` stops meaning reversal (`aharen nudhiyaan` must not become “I went”).

`register` distinguishes written Dhivehi, whose past-tense clauses end in `eve`, from spoken. Without it one frame string mapped to two different sentences and the model could not learn which to produce.

Serialized model input:

```text
SUBJECT=I | ACTION=go | LOCATION=Male | TENSE=future | POLARITY=affirmative | REGISTER=spoken
```

## T5-only rule

The models are **sentence-realization** models, not grammar-correction models. They receive a frame string and generate a sentence. No template English. If a realization model is not loaded, show the frame. Final translation stays Unavailable.

```text
Original     ✓
Latin        ✓
Dictionary   ✓
Frame        ✓
Realization  Not loaded
Final        Unavailable
```

Realization weights are local q8 ONNX files in `public/models/` and load with Transformers.js. First load fetches those files from the same origin; after the browser cache holds them, realization can run offline. A full offline LLM is not required.

API keys: `sessionStorage` by default; optional “Remember on this device” uses `localStorage`. Never in git, source, or CSV exports. Feedback ratings stay in IndexedDB / localStorage and export as CSV.

## Six screens

- **Translator** — main artefact
- **Sentence Breakdown** — viva / research view
- **AI Chat** — application / demo
- **Feedback** — meaning and naturalness ratings, CSV export
- **Benchmarks** — pipeline metrics only
- **About** — problem, idea, architecture, limits

## Scope

MUST: Vite app + six routes; Latin core with Thaana at the edges; dictionary + morphology; semantic frames both directions; pipeline traces without T5; Translator + Breakdown; training-pair generation; train / export T5; plug T5 into both pipelines; evaluation + local feedback.

SHOULD: LLM API adapter + AI Chat + local key store; Feedback / Benchmarks / About filled.

OPTIONAL: Ollama, browser LLM, PWA install.

Out of scope: login, profiles, cloud DB, admin, history server, voice, OCR, images, documents, mobile app, foundation-model training, multi-provider billing, collaborative dictionary editor.
