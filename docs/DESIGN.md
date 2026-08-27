# latin-mv-tlt — Software Design Specification

**Version:** 0.2 · **Status:** describes the system as built at commit `763ca5d`
**Companion to:** [`docs/REQUIREMENTS.md`](REQUIREMENTS.md) (v0.2.2)

---

## 0. About this document

`REQUIREMENTS.md` states *what* the system must do and *why*, as `R-x.y` / `NFR-n` /
`AC-n` clauses. This document states *how* the delivered system satisfies them: the
architecture, the module boundaries, the interfaces between them, the algorithms,
the data shapes, and the decisions — including the ones that were rejected.

Every design element below cites the requirement it serves. §12 inverts that into a
requirement → design traceability matrix. Where the design deliberately does *less*
than the requirement asks, §13 says so rather than leaving the gap implicit.

**Scope of this document.** The delivered v0.2 system. The superseded v0.1
semantic-frame design is summarised in Appendix A for the record, because the
decision between the two is itself part of the design and is examinable material;
its full account lives in `REQUIREMENTS.md` Appendix A.

**Reading order for the other documents**

| Document | Answers |
|---|---|
| [`REQUIREMENTS.md`](REQUIREMENTS.md) | What must be true |
| **this document** | How it is built |
| [`Context/DATA.md`](../Context/DATA.md) | Where the lexicon and corpus came from |
| [`Context/TRAINING.md`](../Context/TRAINING.md) | How the model is trained and exported |
| [`Context/STATUS.md`](../Context/STATUS.md) | What is measured, right now |
| [`Context/QUALITY.md`](../Context/QUALITY.md) | What is known to be wrong |

`Context/PROJECT.md` described the v0.1 semantic-frame pipeline until it was
migrated alongside this document; it was the last file still doing so. All four
`Context/` documents and this one now describe the same system.

---

## 1. Design goals

These are the properties the design optimises for, in priority order. Where two
conflict, the higher one wins, and §11 records the trade that was made.

| # | Goal | Consequence in the design |
|---|---|---|
| G1 | **Never fabricate a translation** | The model is the *only* producer of a sentence. With no model there is no output — `output: null`, final stage `unavailable`. No templates, no gloss-concatenation fallback. (R-3.9) |
| G2 | **The method must be inspectable** | Every translation emits a `PipelineTrace` carrying every intermediate; the Breakdown screen renders all of it, including the verbatim model input and raw model output. (R-5.2, R-6.2) |
| G3 | **No server, no account, no third-party runtime call** | Static build on GitHub Pages. Model weights, ONNX Runtime WASM, lexicon and font are same-origin. (NFR-2, NFR-3, R-3.6) |
| G4 | **Latin core, Thaana edges** | Thaana is converted to Latin on the way in and generated from Latin on the way out. No NLP component — dictionary, morphology, model, LLM — ever sees Thaana. (§2.1) |
| G5 | **Deterministic where it can be** | Transliteration is rule-based; decoding is greedy with no sampling, so a published score can be re-derived. (R-1.1, R-3.5, NFR-7) |
| G6 | **Fits in a browser tab** | ≤80 MB of model weights; single-threaded WASM inference; dynamic import so the shell is usable before any of it downloads. (R-3.4, R-3.11, R-1.4) |
| G7 | **Degrade in parts, not as a whole** | A honorifics failure costs register detection only; a dictionary miss cannot fail a translation; a model failure leaves transliteration, glossing and the IME working. (R-4.5, R-5.6, R-1.4) |

### 1.1 The organising principle: Latin core, Thaana edges

```text
        ┌──────────── Thaana edge ────────────┐
USER →  │  Thaana ──▶ thaanaToLatin           │
        └──────────────────┬──────────────────┘
                           ▼
        ┌──────────── LATIN CORE ─────────────┐
        │  normalise · segment · dictionary   │
        │  morphology · T5 seq2seq · LLM      │   ← never sees a Thaana codepoint
        └──────────────────┬──────────────────┘
                           ▼
        ┌──────────── Thaana edge ────────────┐
USER ←  │  latinToThaana ──▶ Thaana           │
        └─────────────────────────────────────┘
```

This is not stylistic. It is what makes a 60M-parameter model viable on a
low-resource language: the model's vocabulary problem is reduced to Latin subwords
it already tokenises (0.0% `<unk>`, `evaluation/tokenizer_profile.json`), and the
script problem is handled by ~360 lines of deterministic rules instead of by
learned weights. The cost is bounded by round-trip stability, which is measured and
gates training (R-1.8, §5.4).

The corollary is a hard invariant, asserted in the training notebook and enforced
by the corpus builder's `latin_in_dhivehi` / `thaana_in_english` drop rules:

> **INV-1.** A Thaana codepoint in a model input, a model target, or a training
> pair is an architecture violation, not a data-quality issue.

---

## 2. Architectural design

### 2.1 Context

There is no server tier at any point. The deployed artefact is a directory of static
files; every computation happens in the user's tab.

```text
┌─────────────────────── the user's browser tab ────────────────────────┐
│                                                                       │
│   React UI  ──▶  pipeline  ──▶  core modules  ──▶  ONNX Runtime WASM  │
│                                                                       │
└───────────┬──────────────────────────────────────┬────────────────────┘
            │ same-origin fetch (GitHub Pages)     │ optional, user-supplied
            ▼                                      ▼
   dictionary.json · honorifics.json        an OpenAI-compatible
   benchmarks.json · Faruma font            /chat/completions endpoint
   models/** · ort/**                       (Chat screen only, English only)
```

The only outbound request the system can make to a third party is the Chat screen's
LLM call, which is off by default, requires the user to enter a URL and key, and
carries English only (R-7.x, §9).

### 2.2 Runtime / build-time partition

```text
BUILD TIME (never runs in a browser)          RUNTIME (only this ships)
─────────────────────────────────────         ─────────────────────────
tools/*.py    corpus, cleaning, metrics       src/**       React + TS
tools/*.mjs   Node bridge to the TS           public/data  lexicon, stats
scripts/*.mjs ORT vendoring, budget gate      public/models  q8 ONNX + tokenizer
colab_*.ipynb training + export (GPU)         public/ort   ONNX Runtime WASM
                                              public/fonts Faruma
```

`tools/` is Python **and** Node, deliberately. The corpus builder and the round-trip
measurement call the project's *own* TypeScript transliterator through
`tools/transliterate.mjs` rather than reimplementing it in Python (R-2.2). A second
implementation would drift, and the drift would be invisible: training-time Latin
and inference-time Latin would diverge with no error anywhere. `corpus_stats.json`
records `transliteratorSha256` so a corpus can be tied to the exact rules that built
it.

### 2.3 Layers and the dependency rule

```text
┌─ src/ui/ ────────────────────────────────────────────────────────────┐
│  screens/  Translator Breakdown Chat Feedback Benchmarks About       │
│  components/  TopBar Sidebar MobileNav TraceView                     │
│  hooks/  useThaanaIme                                                │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ may import ↓ only
┌─ src/core/pipeline/ ─────────▼───────────────────────────────────────┐
│  dvToEn.ts  enToDv.ts  types.ts  — orchestration, owns PipelineTrace │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌─ src/core/ (peer modules, no cross-imports except as noted) ─────────┐
│  normalize  segmenter  transliterator  dictionary  morphology        │
│  translate (prefixes.ts, runner.ts)                                  │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌─ @huggingface/transformers ──▼──▶ ONNX Runtime (WASM, 1 thread) ─────┐
└──────────────────────────────────────────────────────────────────────┘

  src/llm/     ── used only by ui/screens/Chat.tsx; imports nothing from core
  src/lib/     ── leaf utilities: theme, feedback store, lastTrace store
```

**Dependency rules, enforced by review rather than by tooling:**

- **D1.** `src/core/**` must not import from `src/ui/**` or `src/llm/**`. The core is
  headless and testable under `environment: 'node'` with no DOM (NFR-6).
- **D2.** Only `src/core/pipeline/**` may orchestrate. Peer core modules do not call
  each other except for the three declared exceptions below.
- **D3.** `src/llm/**` must never touch the translation path. The LLM is a
  demonstration *of* the pipeline, never a component *in* it (§1.2 of the
  requirements; R-7.1).

Declared cross-imports inside `core/` (each is a deliberate, narrow exception):

| From | To | Why |
|---|---|---|
| `segmenter/textProcessor` | `transliterator/thaanaToLatin` | `prepareSentence` transliterates as part of preparing a sentence, so the pipeline does it once (R-5.5) |
| `dictionary/lookup` | `morphology/suffixParser`, `transliterator/thaanaToLatin`, `normalize` | staged lookup needs stemming and Thaana→Latin normalisation of the key (R-4.3) |
| `pipeline/*` | everything | it is the orchestrator (D2) |

### 2.4 Control flow

**Dhivehi → English** (`translateDvToEn`)

```text
raw text
  └▶ normalise()                                   NFC, strip ZWJ/ZWNJ/BOM, NBSP→space
     └▶ segmentSentences()                         script-aware, 1 segment = 1 inference
        └▶ for each sentence, SEQUENTIALLY:
           ├▶ prepareSentence()                    → latin, latinWords  (transliterate once)
           ├▶ lookupWords()      ─ beside ─┐       → dictionary glosses (never blocks)
           ├▶ buildModelInput('dv-en', latin)      → "translate Dhivehi Latin to English: …"
           ├▶ translateText()                      → TranslationResult
           ├▶ detectRegister()   ◀────────┘        → written | spoken | neutral
           └▶ assemble PipelineTrace
        └▶ available = traces.length > 0 && every trace has output
```

**English → Dhivehi** (`translateEnToDv`)

```text
raw text
  └▶ normalise() ▶ segmentSentences()
     └▶ for each sentence, SEQUENTIALLY:
        ├▶ dictionaryForEnglish()  ─ beside ─      → glosses
        ├▶ buildModelInput('en-dv', source)        → "translate English to Dhivehi Latin: …"
        ├▶ translateText()                         → Latin  ← the model's OUTPUT
        └▶ latinToThaanaDetailed(latin)            → { thaana, preserved[] }
```

Three properties of this flow are load-bearing and each has a named requirement:

- **Sequential, not `Promise.all`.** There is one ONNX session behind one WASM
  thread (R-3.11). Concurrent sentences would contend for it, not go faster, and
  would multiply peak memory. The `for … of await` loop is intentional.
- **`latin` means different things per direction.** On `dv-en` it is the
  transliterated *source*; on `en-dv` it is the model's *output*. Latin is the
  pivot, so it sits on whichever side faces Thaana. `enToDv.output.test.ts` exists
  to stop a well-meaning refactor "fixing" the asymmetry.
- **Glossing is a sibling of translation, not a parent.** A dictionary miss can
  never fail a translation (R-5.6).

---

## 3. Module design

Each module below gives its responsibility, its public interface, the design
decisions inside it, and the requirements it serves.

### 3.1 `core/normalize`

**Responsibility.** One canonical form for all downstream text.
**Interface.** `normalise(text: string): string` (`normalize` is an alias).
**Design.** NFC composition, then removal of `U+200B/200C/200D/FEFF`, then
`U+00A0 → U+0020`. Applied once at the top of each pipeline entry and again per
sentence; it is idempotent, so double application is safe by construction.
**Why zero-width characters.** Thaana text pasted from Maldivian news sites carries
ZWNJ; without stripping it, two visually identical words hash to different lexicon
keys and the dictionary silently misses.

### 3.2 `core/segmenter`

**Responsibility.** Turn a paragraph into translatable sentences and into word
tokens. **Interface.** `segmentSentences`, `tokenizeWords`, `extractWordsOnly`,
`identifyScript`, `hasThaana`, `prepareSentence`.

**`segmentSentences` — five rules, in order** (R-5.7):

1. A run of terminators (`...`, `?!`) is **one** boundary, not one per mark.
2. Closing quotes and brackets stay with the sentence they close.
3. A segment containing no letter or digit (`\p{L}`/`\p{N}`) is never emitted.
4. A `.` flanked by digits is a decimal point, not a boundary: `3.14 is pi.` is
   one sentence, where it used to be `['3.', '14 is pi.']`.
5. A `.` closing a known abbreviation (`Dr.`, `etc.`), a capitalised initial
   (`J. Smith`) or a dotted initialism (`e.g.`, `U.S.`) does not end the sentence.

Rules 4 and 5 are checked **only when the next character is not itself a
terminator**, which is what keeps rule 1 intact: `a... b` still splits, because
the `.` after `a` is followed by another `.`. The initial rule requires a capital,
so a lowercase `a.` is not mistaken for an initial. The abbreviation list is
English-only by design — Dhivehi terminates with `۔` and does not abbreviate with
a full stop, so a Dhivehi list would be inventing a problem.

Terminators are script-aware: `.` `!` `?` plus `U+061F` (Arabic question mark) and
`U+06D4` (Arabic full stop, used in Dhivehi). Before `U+06D4` was a boundary, an
entire Thaana paragraph arrived at the model as one "sentence" and was truncated at
128 tokens. Line breaks are hard boundaries, punctuated or not.

**Why rule 3 is a correctness requirement and not tidiness.** Under v0.1 a bad split
was untidy. Under v0.2 **one segment costs one model inference**, so emitting `"."`
as a segment means prefixing and decoding a fragment with nothing in it.

**One tokenizer, not three** (R-5.8, DD-18). `tokenizeWords` defines the token classes and
`extractWordsOnly` filters them to words; both pipeline directions route through
it. `enToDv` previously split English on its own regex, so the Breakdown's
dictionary panel could list different words than the pipeline had analysed, for
the same sentence. The token classes also keep `3.14` and `1,000` whole, and the
word filter keeps contractions and hyphenated forms that the old `/^[a-zA-Z]+$/`
filter discarded silently.

R-5.8 was added to the requirements spec in revision 0.2.3 as a consequence of
this work. It is the one place where the defect sweep found a gap in the *spec*
rather than in the code: nothing had ever said where a word begins, so no
implementation was in breach and no test could fail. Segmentation (R-5.7) and
tokenization are separate rules over the same text, and are now separate clauses.

**`identifyScript`** is a single pass over the string returning percentage shares of
Thaana / Latin / digit / punctuation / whitespace. It replaced an implementation
that rebuilt five `RegExp` objects and materialised five match arrays *per
sentence*; the percentages are what `prepareSentence` uses to decide whether the
input needs transliterating at all.

### 3.3 `core/transliterator`

**Responsibility.** The Thaana edge, both directions, deterministic and rule-based
(R-1.1). **Interface.** `transliterateThaana`, `transliterateThaanaDetailed`,
`transliterateWord`, `latinToThaana`, `latinToThaanaDetailed`,
`convertLatinWordToThaana`, plus the shared `mappings`.

**Shared tables (`mappings.ts`) are the single source of truth.** Both directions
read `THAANA_CONSONANTS`, `THAANA_VOWELS`, `SUKUN_SPECIAL`, `GEMINATE_CONSONANTS`
and `PRENASALIZED_STOPS`. The reverse direction *derives* its tables from the
forward ones (`Object.entries(...).map(...)`) rather than restating them, so the two
cannot drift.

**One canonical romanization** (R-1.2). Ten Arabic-derived letters map many-to-one
(`ޘ`/`ތ` → `th`, `ޛ`/`ދ` → `dh`, `ޙ`/`ހ` → `h`, `ޞ`/`ސ` → `s`, …). This makes exact
round-trip **mathematically impossible**, by design, not by defect — which is why
R-1.8 gates on *Latin stability* (`latin → thaana → latin` is a fixed point) rather
than on exact Thaana recovery. Measured: **99.35%** over 15,201 lexicon entries,
**99.80%** over a 5,000-sentence news sample.

**Forward algorithm** (`thaanaToLatin.ts`), a single left-to-right pass:

| Order | Rule | Example |
|---|---|---|
| 1 | prenasalized stop: `ނ` + stop → apostrophe form | `ނބ` → `n'b` |
| 2 | consonant + vowel diacritic | `ކަ` → `ka` |
| 3 | alifu + sukun + geminable consonant → doubled consonant | `އްބ` → `bb` |
| 4 | consonant + sukun → `SUKUN_SPECIAL` or bare consonant | `ތް` → `iy`, `ށް`/`އް` → `h` |
| 5 | alifu carrying a vowel → bare vowel | `އަ` → `a` |
| 6 | anything else → passed through **and recorded** | digits, ASCII, `،` |

**Reverse algorithm** (`latinToThaana.ts`) inverts 1, 3 and 4 explicitly — those
three had no inverse at all before, which is what held Latin stability at ~87%;
adding them took it to 99.35%. Two disambiguations are worth naming because greedy
matching gets both wrong:

- **`ey` before a vowel is not the digraph.** `ey` is the vowel `ޭ` but also spells
  `ެ` + onset `ޔ`. If a vowel follows, the `y` must be carrying it: `keyo` is `ކެޔޮ`,
  not `ކޭއޮ`.
- **`ddh` is not a doubled `d`.** The second `d` opens `dh`, so this is `ޑް` + `ދ`.
  The geminate branch re-runs `matchConsonant` at the repeat position to confirm the
  repeat really is the same consonant.
- **`iy` → `ތް` is an accepted lossy choice.** `އިޔް` also reads out as `iy`; `ތް` is
  chosen as canonical because it is far the commoner word-final shape. R-1.2 permits
  exactly one convention, so the alternative is *deliberately* lost.

**A prenasalized stop is one Latin unit spelled from two Thaana consonants**, and
the diacritic that follows belongs to the *second* of them. The forward rule used
to emit the digraph and jump straight past the stop, so a following sukun met the
next iteration with no consonant in front of it and was copied into the Latin as a
raw `U+07B0`: `ނބް` came out as `n'b` plus a Thaana character. Falling into the
shared vowel/sukun handling instead makes the pair behave exactly like any other
consonant, and every prenasalized form is now Latin-stable.

**Preserved segments** (R-1.3). Both directions return `preserved: string[]` — what
could not be mapped, de-duplicated. Forward, only Thaana-block characters count
(whitespace and ASCII punctuation pass through *by design*, so listing them would be
noise). The trace carries them to the Breakdown as `Unconverted: …`. An earlier
implementation **deleted** unknown characters silently; visibility here is the whole
point of G2.

**Accent folding.** `foldMaleLatin` applies NFD and strips combining marks before
conversion, so `Malé` → `male` → `މާލެ`. Model inputs and training data are ASCII
Latin (the corpus builder drops `non_ascii_latin` rows), so folding at the edge keeps
runtime and training in the same alphabet.

**Zero-model availability** (R-1.4). This module imports nothing heavy. The Latin
view, the Breakdown's transliteration block and the IME all work with no model
downloaded at all.

### 3.4 `core/dictionary`

**Responsibility.** Word-level glossing, beside the translation. Under v0.2 this no
longer feeds anything neural — it is analysis and display.

**Interface.** `loadDictionary`, `loadDictionaryFromData`, `translateWord`,
`searchDictionary`, `isKnownLatin`, `isDictionaryLoaded`, `getDictionaryStats`,
`getEntryCount`, `englishGloss`, `latinValue`.

**In-memory structures**, built once at load:

| Structure | Purpose | Cost |
|---|---|---|
| `entries: DictionaryEntry[]` | the copy of record | — |
| `byLatin: Map<string, Entry[]>` | exact Latin lookup | O(1) |
| `byEnglish: Map<string, Entry[]>` | exact English lookup | O(1) |
| `sortedLatinKeys: string[]` | prefix lookup by binary search | O(log n + k) |
| `cache: Map<string, WordTranslation>` | memoised results, bounded at 5,000 | O(1) |

`entries` is a *copy* of the caller's array, so a later mutation by the caller cannot
desynchronise the indexes. `loadDictionary` memoises its in-flight promise: without
that, React StrictMode's double effect fetched and re-indexed the whole 1.5 MB
lexicon twice on every mount.

**Staged lookup for a Dhivehi word** (R-4.3), first hit wins:

```text
normalise
  ├─ non-ASCII?  → transliterateThaana, look up the Latin,
  │                 confidence DOWNGRADED, fallbackUsed = 'transliteration_lookup'
  └─ ASCII:
     1. closed-class table (curated)        → high
     2. exact byLatin hit                   → high
     3. stemWord() then exact stem hit      → high, exposes stem + suffixes + caseGloss
     4. prefix scan, ranked, top 5          → LOW, fallbackUsed = 'prefix'
     5. nothing                             → low, fallbackUsed = 'transliteration_only',
                                              gloss rendered as "[unknown: …]"
```

Two ranking decisions carry scars:

- **Prefix candidates are ranked before truncation** — shorter extension first, then
  higher frequency. Previously the first five in *file order* won, so `kiyavaa`
  resolved to "a recitation-house" while better candidates were discarded unseen.
  `MAX_PREFIX_SCAN = 500` bounds a pathologically common prefix.
- **A prefix guess is never `high` confidence.** Step 4 is a guess, and labelling a
  guess as authoritative is exactly the kind of quiet dishonesty G2 exists to
  prevent. Likewise an exact dictionary hit is the *only* thing allowed to replace a
  curated closed-class gloss.

**A curated closed-class entry overrides the 16k lexicon**, so a wrong entry there
is worse than a missing one — the staged lookup never reaches the real dictionary
to be corrected. Four entries were removed on that basis, each an open-class
content word pointing at a Dhivehi form that means something else: `work → kurun`
("to do/make"), `stay → huri` ("was/is present"), `never → nu` (the negative
prefix) and `exist → ulee` (a finite form among lemmas). No replacements were
invented — that needs a native speaker, not a guess. The genuinely many-to-one
collapses that remain (`me`/`I` → `aharen`, `going`/`went` → one lemma,
`home`/`house` → `ge`) are declared in `COLLAPSED_ENGLISH` and enforced by
`closedClass.test.ts`, which fails on any round-trip asymmetry that is not on the
list. `eyna` is gender-neutral in Dhivehi and is now glossed `he/she` rather than
picking one.

**Browse is a separate path from lookup** (R-4.8). `searchDictionary` shares the
`byLatin` / `byEnglish` maps and `sortedLatinKeys`, and none of the thresholds.
Three differences are each deliberate:

- **It scans exhaustively where lookup binary-searches.** `lookupLatin` breaks at
  the first non-matching key, which is right for its job but can only report "at
  least N". The screen's contract is "showing 50 of 762", and that sentence is
  only true if everything was looked at. One `indexOf` per key over ~32k keys
  measures **1–9 ms for any realistic query and ~22 ms for a single character**
  (14,577 of 15,528 rows) on the project's 2016 laptop — cheap enough to buy an
  exact denominator.
- **It selects the top *k* by bounded insertion, not `Array.sort`.** Sorting the
  full matched set of a one-character query costs several times more; the
  comparator never revisits a row that has already lost.
- **It does not touch `cache`.** `translateWord` stops *accepting* entries at
  `MAX_CACHE` rather than evicting, so a browse path sharing the cache would fill
  all 5,000 slots after a few hundred keystrokes and silently disable memoisation
  for the whole translation pipeline.

It returns **copies** (`{ ...entry, english: [...entry.english] }`), so the
private-`entries` promise above survives a screen holding a result. No
`sortedEnglishKeys` was added: an English prefix index would cost a sort at load
and still miss most matches, because **67.8% of glosses are multi-word** —
`water` must find "a kind of water plant" (DD-21).

**Why binary search.** Prefix lookup previously walked all ~16k keys per word. Keys
sharing a prefix form one contiguous run in sorted order, so `lowerBound` plus a walk
that stops at the first non-match is O(log n + k).

### 3.5 `core/morphology`

**Responsibility.** Suffix analysis for display, and register detection.
**Interface.** `parseSuffix`, `stemWord`, `NOUN_SUFFIXES`, `VERB_SUFFIXES`,
`STEM_SUFFIXES`, `loadHonorifics`, `loadHonorificsSync`, `detectRegister`,
`REGISTERS`.

**Suffix tables are sourced, not invented.** They follow Fritz, *The Dhivehi
Language* Vol. II: `gai` as the standard Malé locative, `eh`/`ek`/`aku` indefinite,
`un`/`in` ablative, `aai` sociative; verbs across infinitive, preterite, perfective,
future, present-focus copula, progressive and the clause-chaining converbs. Each
entry carries an English hint, which is what surfaces on the Breakdown as the
`caseGloss`.

**The two suffix tables agree.** `kamah` read `{case: 'indefinite_dative', english:
'some'}` in `NOUN_SUFFIXES` and `['kamah', 'to']` in `STEM_SUFFIXES`, so the same
morpheme carried two glosses and the Breakdown printed whichever table the caller
happened to reach. `kam` (verbal noun) + dative `ah` is *to*; `some` was the error.

**Stemming is gated by a `known()` callback.** `stemWord(word, isKnownLatin, maxDepth
= MAX_STRIP_DEPTH)` strips recursively to a depth of 3 but only accepts a root the
lexicon actually contains, so it cannot invent a stem. The gate is passed in rather than imported, which keeps the module
free of a dependency on the dictionary and keeps it unit-testable in isolation.

**Spelling variants compose.** The four letter-variant rules (`q`→`g`, `kh`→`h`,
`gh`→`g`, `dhh`→`dh`) used to be applied to the original word only, so a word
carrying two of them never reached its normalised form: `ghaqee` produced `gaqee`
and `ghagee` but never `gagee`, which is the spelling the lexicon holds. The
generator is now a fixed point over the rules — at most 2^4 spellings, bounded by
`MAX_VARIANTS = 64` — with the word-final mutations and sandhi undoings applied to
each spelling rather than only to the input.

**Register detection** returns `written | spoken | neutral`. The design note in
`honorifics.ts` is candid about its own limits: Fritz Vol. II does *not* attest a
systematic three-level honorific paradigm — only eight mostly dialectal HON tokens —
so the three-level inflection is an **unwired stub**. What *is* strongly attested is
the written-narrative particle `eve` (`އެވެ`) versus spoken, and that is what the
detector actually keys on. Honorifics are loaded with `.catch(() => undefined)` at
startup: a failure degrades register detection and nothing else (R-4.5, G7).

### 3.6 `core/translate`

**Responsibility.** Own the model: prefixes, loading, status, inference.

#### 3.6.1 `prefixes.ts` — one file, two consumers

```ts
export const DV_EN_PREFIX = 'translate Dhivehi Latin to English: ';
export const EN_DV_PREFIX = 'translate English to Dhivehi Latin: ';
```

The browser imports these constants; the Python corpus builder reads them via
`node tools/transliterate.mjs --prefixes`. **Hardcoding the literals in
`build_translation_pairs.py` is deliberately not done**: if the corpus is built with
one string and the app prompts with another, the model meets an unfamiliar prefix at
inference and *silently degrades*. There is no error — just worse output. The
trailing `": "` is part of the prefix for the same reason; two characters of
disagreement produce the same silent failure.

`buildModelInput(direction, source)` is the only way the pipeline constructs an
input, so the exact bytes handed to the model are decided in one place and can be
shown verbatim on the Breakdown (R-6.2).

#### 3.6.2 `runner.ts` — module-level singleton with a four-state machine

**One model, both directions** (R-3.1). One `MODEL_ID = 'dv-en-translate'`, four
module-level slots (`status`, `generate`, `loading`, `lastError`) where v0.1 had
eight for two models.

```text
          ┌──────────────┐  ensureTranslationModel()   ┌───────────┐
          │  not_loaded  │ ──────────────────────────▶ │  loading  │
          └──────────────┘                             └─────┬─────┘
                  ▲                                          │
                  │ (test mode short-circuits here)   ┌──────┴──────┐
                  │                                   ▼             ▼
                  │                             ┌─────────┐   ┌─────────┐
                  └──── retry after failure ─── │  error  │   │  ready  │
                                                └─────────┘   └─────────┘
```

- **Load at most once, shared in-flight promise** (R-3.7). Two sentences translated
  at once would otherwise each start an 80 MB download. `loading` is cleared in a
  `finally`, so a later call retries after an error — `generate` is still null, so
  the retry starts clean.
- **`ensureTranslationModel` never rejects.** Failures land in the returned status
  with `lastError` set. Callers stay correct without a try/catch.
- **Exactly four states** (R-3.8). v0.1 carried a fifth, `not_configured`, for a
  remote-model path this build never had; it was dead in the runner and appeared
  only in a test mock. *A state that cannot occur is a state the UI renders wrong*,
  so it was deleted.
- **Test-mode short-circuit before the dynamic import.** `MODE === 'test'` returns
  `not_loaded` *without importing the library at all*. Placing this before the
  import is what makes NFR-6 true — tests touch no model and no network. Moving it
  after the import would silently break that guarantee while all tests still passed.

**Environment configuration, applied once** (`envConfigured` guard):

| Setting | Value | Requirement |
|---|---|---|
| `allowLocalModels` / `allowRemoteModels` | `true` / `false` | R-3.6 — no third-party model fetch, ever |
| `localModelPath` | `${BASE_URL}models/` | same-origin |
| `wasm.numThreads` | `1` | R-3.11 — many localhost/Electron pages have no `SharedArrayBuffer`; multi-threaded ORT then fails to create a session at all |
| `wasm.proxy` | `false` | same |
| `wasm.wasmPaths` | `${BASE_URL}ort/` | otherwise the library points at `cdn.jsdelivr.net`, contradicting NFR-2/NFR-3. `scripts/copy-ort.mjs` vendors the files at build time |
| `dtype` | `'q8'` | R-3.4 budget; resolves to the same `*_quantized.onnx` filenames as v2's `quantized: true` |

**Input length is checked with the model's own tokenizer, not by characters.**
Dhivehi Latin fragments to ~5.7 subwords per word against English's ~1.3, so a
character heuristic would be wrong by a factor of four *between the two directions*.
Over `MAX_INPUT_TOKENS = 128` the runner **throws rather than truncates**: the
tokenizer would otherwise silently drop the tail, and the user would receive a
fluent translation of the first half of their sentence with nothing anywhere
reporting the loss. A confidently wrong translation is worse than a refusal (G1).
Because callers segment first (R-5.1), this fires only on genuinely long single
sentences.

**Decoding is greedy** — `num_beams: 1`, `do_sample: false`, `max_new_tokens: 128`
(R-3.5) — matching the training-time generation config so a published BLEU number is
reproducible (NFR-7).

**Progress is a first-class output** (R-6.10). A `Set` of listeners plus
`lastProgress` replay-on-subscribe, driven by the library's `progress_callback`.
Eighty megabytes of silence is a defect.

**Two v0.1 hacks this design retires.** v0.1 shipped a *copy* of the unmerged decoder
under the merged filename because the fp32 merge was ~159 MB; that graph has no
`use_cache_branch`, which forced a monkey-patch on `PreTrainedModel.prototype.runBeam`
to stop the library feeding it a KV cache. Three things retire it: `runBeam` no
longer exists in v3; `tools/export_onnx.py` quantizes *after* merging (~42 MB, not
159 MB); and that script asserts `use_cache_branch` is present before it will write
the model at all.

### 3.7 `core/pipeline`

**Responsibility.** Orchestration, and ownership of the trace.
**Interface.** `translate(text, direction)`, `translateDvToEn`, `translateEnToDv`,
their per-sentence variants, and the `PipelineTrace` / `PipelineResult` types.

**The trace is a design artefact, not a debug log** (R-5.2, G2). Every field on
`PipelineTrace` appears on screen:

| Field | Meaning |
|---|---|
| `direction`, `input` | the normalised source |
| `latin` | dv→en: transliterated source · en→dv: the model's **output** |
| `thaana`, `thaanaPreserved` | the Thaana form and what could not be converted (R-1.3) |
| `dictionary` | word-level glosses, computed beside the translation |
| `modelInput` | **verbatim**, prefix included |
| `modelOutput` | raw, before any post-processing |
| `translation` | the full `TranslationResult`, error included |
| `output` | the final string, or `null` — never a fabrication |
| `register` | written / spoken / neutral |
| `stages` | five states over six stages (§7) |

**The empty-input guard** (R-5.4) is a named requirement because of a real defect:
`[].every(...)` is vacuously true, so empty input reported as a *successful*
translation with an empty output.

```ts
const available = traces.length > 0 && traces.every((t) => t.output);
```

Both directions carry it, both have a test, and the tests must survive any refactor.

### 3.8 `src/llm` — deliberately outside the translation path

**Interface.** `completeEnglish(settings, prompt)`, `loadSettings`, `saveSettings`,
`DEFAULT_SETTINGS`, and the `LlmSettings` / `ChatMessage` types.

One adapter against the OpenAI-compatible `/chat/completions` shape, which covers
both the `api` and `ollama` providers by URL alone (`browser` is a declared-but-
unimplemented provider that throws a clear message rather than pretending). It sends
`temperature: 0.4` and a fixed system prompt, and it receives and returns **English
only** — the LLM never sees Thaana, and never sees a translation in progress (D3).

Three robustness properties, each of which was a defect first:

- **`endpointFor` tolerates a missing, null or blank URL.** `settings.apiUrl.replace(...)`
  threw a raw `TypeError` whenever storage held `apiUrl: null`, which surfaced in
  the Chat error line with nothing pointing at the setting that caused it.
- **`loadSettings` drops null values before the spread.** That is the root cause:
  spreading a stored blob over the defaults lets an explicit `null` *overwrite* a
  default rather than fall back to it.
- **The call takes an `AbortSignal`**, and Chat holds the controller in a ref with
  a Cancel button in place of Send while a request is in flight. Without it a hung
  endpoint left `busy` true forever and the only recovery was a page reload. An
  `AbortError` is a user action, so it is not reported as a failure.

`Translator → English → LLM → English → Translator`. The translator must work with
no API key at all.

### 3.9 `src/ui`

App shell in `App.tsx`: single-state screen switch (`useState<Screen>`), no router —
the deployment is a static Pages site under a base path, and a hash router would buy
nothing that seven screens need.

**Startup ordering** encodes G7 directly:

```ts
loadDictionary()                              // required
  .then(() => loadHonorifics().catch(() => undefined))   // optional
  .then(() => setReady(true))
  .catch(setError)                            // dictionary failure blocks the app screens
```

`About` renders even when `ready` is false, so the failure state still explains
itself (R-6.9).

Screens and components are covered in §6.

### 3.10 `src/lib`

| Module | Design note |
|---|---|
| `lastTrace.ts` | The Breakdown reads the last result from `sessionStorage`, not from React state, so it survives a screen switch. The key is **versioned** (`…:last-result:v2`): a v0.1-shaped trace parses fine and renders as `undefined`, because the frame fields the old Breakdown read are gone. Bumping the key retires stale entries left in tabs open across a deploy. |
| `feedback.ts` | `localStorage`-backed rows; CSV export with `"`-doubling **and** formula-injection neutralisation — a correction beginning `=`, `+`, `-`, `@` or a control character is prefixed with an apostrophe, because this file is *designed* to be opened in a spreadsheet. The download anchor is attached to the document before the synthetic click (Firefox ignores a detached one) and the blob URL is revoked on a later task, not the next line — revoking immediately cancelled the download that had just started in Firefox and Safari. |
| `theme.ts` | Precedence is **explicit choice → `prefers-color-scheme` → light**. The choice persists in `localStorage` and is read synchronously on the first render, so the app does not paint light and then flip. While no explicit choice exists the hook follows OS changes live; once the user has picked, the OS no longer overrides them. `localStorage` access is wrapped — Safari private mode throws rather than returning null, and a theme is not worth failing a render over. |

### 3.11 `tools/` and `scripts/` — build-time only

| File | Milestone | Role |
|---|---|---|
| `tools/build_translation_pairs.py` | M-1 | Build the parallel corpus; eleven named drop rules; whole-domain splits |
| `tools/measure_roundtrip.py` | M-2 | Round-trip gate, ≥98% Latin-stable |
| `tools/profile_tokenizer.py` | M-2b | `<unk>` rate gate, ≤5% |
| `tools/train_translate.py` | M-3 | Fine-tune; best-checkpoint-by-chrF; per-direction metrics |
| `tools/export_onnx.py` | M-4 | Merge → quantize → assert → write only runtime files |
| `tools/transliterate.mjs` | — | Node bridge exposing the TS transliterator and the prefixes to Python (R-2.2) |
| `tools/clean_dictionary.py`, `improve_dictionary.py`, `export_dictionary.py`, `export_honorifics.py` | — | Lexicon build; "no key disappears without a recorded rewrite" |
| `scripts/copy-ort.mjs` / `prune-ort-assets.mjs` | — | Vendor ORT WASM into `public/ort/`; drop the bundler's duplicate |
| `scripts/check-models.mjs` | — | CI gate: 80 MB budget **and** forbidden-graph names |

**`export_onnx.py` asserts rather than warns**, matching the lexicon scripts' posture.
Two traps it exists to catch, both of which bit v0.1: merging *after* quantization
instead of before; and `quantize_dynamic` silently skipping `If` subgraphs unless
`extra_options={"EnableSubgraph": True}` is passed — which yields a file that is
nominally quantized and still fp32 inside, at ~160 MB.

**`check-models.mjs` fails two ways independently**: total bytes over budget (R-3.4),
*and* the presence of a graph the runtime never loads, matched by name (R-3.13) —
because a duplicate that happens to be small is still dead weight.

---

## 4. Interface contracts

```ts
// core/pipeline
translate(text: string, direction: 'dv-en' | 'en-dv'): Promise<PipelineResult>

// core/translate
buildModelInput(direction: TranslationDirection, source: string): string
translateText(prefixedInput: string): Promise<TranslationResult>   // never rejects
ensureTranslationModel(): Promise<TranslationStatus>               // never rejects
onLoadProgress(cb: (p: LoadProgress | null) => void): () => void   // returns unsubscribe

// core/transliterator
transliterateThaanaDetailed(text: string): { latin: string; preserved: string[] }
latinToThaanaDetailed(text: string): { thaana: string; preserved: string[] }

// core/dictionary
translateWord(word: string, sourceLang: 'dhivehi' | 'english'): WordTranslation  // cached, READ-ONLY
searchDictionary(input: string, limit?: number): SearchResponse                  // NOT cached; entries are copies
loadDictionary(dictUrl?: string, statsUrl?: string): Promise<void>               // memoised

// core/morphology
stemWord(word: string, known: (latin: string) => boolean): StemAnalysis | null
detectRegister(words: string[]): string
```

Two contracts that are easy to violate and are therefore stated explicitly:

- **`translateWord` returns a shared, cached object.** Callers must treat it as
  read-only. The cache is cleared whenever the dictionary is (re)loaded.
- **`translateText` takes an already-prefixed string**, not `(text, direction)`.
  That is what forces prefix construction into one place (§3.6.1).
- **`searchDictionary` deliberately ignores `MIN_PREFIX_LEN` and `MAX_PARTIAL`.**
  Those bound the *translation* path. Browse has its own `SEARCH_LIMIT` /
  `SEARCH_LIMIT_MAX`, accepts a one-character query, and shares no code with
  `lookupLatin` — which is why adding it could not change pipeline behaviour.

---

## 5. Data design

### 5.1 Shipped runtime data (`public/data/`)

| File | Size | Shape |
|---|---|---|
| `dictionary.json` | ~1.49 MB | `DictionaryEntry[]` — `{ latin, english[], pos, frequency, freqSource? }` |
| `dictionary_stats.json` | ~188 B | provenance counters, all keys optional |
| `honorifics.json` | ~4.8 KB | `HonorificEntry[]` — `{ latin, english[], register, kind, plainForm }` |
| `benchmarks.json` | ~5 KB | `{ notes, metrics: [{ group, name, value, source }] }` |

**The `dhivehi` column does not ship.** 11,269 of 16,014 values (70.4%) were
byte-identical to `latinToThaana(latin)` — a deterministic function of a field
already present. Dropping it cut the file from 2,111,356 to 1,491,467 bytes. Thaana
for display is generated at the edge. A `dhivehi` column in `dictionary.json`, or
Thaana in the gold sentences, is a bug (INV-1).

`DictionaryStats` has **all keys optional** and an index signature, so an older
stats file still parses. A previous five-key type silently dropped every provenance
counter the build scripts emit before Benchmarks could read them.

### 5.2 Parallel corpus (`data/parallel/`, not committed)

One JSON object per line:

```json
{"input": "translate Dhivehi Latin to English: aharen maleah dhaanan",
 "target": "I will go to Male.",
 "direction": "dv-en",
 "provenance": {"source": "alakxender/dhivehi-english-translations",
                "domain": "crime", "synthetic": false}}
```

Every kept pair is written **twice**, once per direction. 285,748 × 2 = 571,496
written rows, less 938 removed as cross-split **input leakage** (valid 418, test 390,
valid/test overlap 130) = the 570,558 rows below. Leak removal is part of the split
design, not a cleanup afterthought: an identical input appearing in train and test
turns a memorised row into an apparently strong test score.

| | |
|---|---|
| Rows read | 575,892 |
| Pairs kept | 285,748 (`syntheticPairs: 0`) |
| Dropped | 290,144 across 11 named rules — largest: `length_bounds` 88,111, `over_max_tokens` 83,158, `duplicate_exact` 49,752, `latin_in_dhivehi` 23,555, `non_ascii_latin` 17,492 |
| Splits | 480,018 train / 49,948 valid / 40,592 test |
| Leakage removed | 938 rows (valid 418, test 390, valid/test overlap 130) |
| Quarantined | 5,000 |
| Domains | 18, `splitSeed: 11`, `lengthRatioBounds: [0.4, 2.5]`, `maxTokens: 128`, tokenizer `t5-small` |

**Splits hold out whole domains** (R-2.6, R-8.8), so valid and test scores are
out-of-domain. The `conversational` group is the one exception — held out **by row**,
present in all three splits — 38,415 / 1,500 / 1,500 pairs, written as
76,830 / 2,984 / 2,990 rows. Its scores are in-domain and **must be reported
separately**, or the headline number is inflated.

`corpus_stats.json` **is** committed (the JSONL is not — `train.jsonl` alone is
189 MB) and records `transliteratorSha256`, tying a corpus to the exact rules that
built it.

### 5.3 Model artefacts (`public/models/dv-en-translate/`)

Exactly the files transformers.js fetches, and no others (R-3.13):

```text
config.json  generation_config.json  tokenizer.json
tokenizer_config.json  special_tokens_map.json
onnx/encoder_model_quantized.onnx           ~35 MB
onnx/decoder_model_merged_quantized.onnx    ~42 MB
```

**Budget arithmetic** (R-3.4): 35 + 42 + 2.4 ≈ **80 MB** — *at* the budget, not under
it. The earlier ~60 MB estimate was optimistic and has been corrected. The budget's
**scoping** is load-bearing: it covers `public/models/**` only; the ONNX Runtime WASM
(~21.6 MB) and the app bundle are separate line items. Read as "everything fetched at
runtime", 80 MB is unachievable at any model size.

### 5.4 Evaluation artefacts (`evaluation/`)

| File | Contents |
|---|---|
| `roundtrip_stats.json` | 15,201 lexicon entries — 99.35% Latin-stable, 88.13% exact Thaana, 88.96% folded |
| `roundtrip_stats_corpus.json` | 5,000-sentence news sample — 99.80% Latin-stable, 27.50% exact, 34.32% folded |
| `tokenizer_profile.json` | 2,000 word types — **0.0% `<unk>`**, mean **5.697** pieces/word, histogram peaking at 5 with a tail to 15 |
| `gold_sentences.json`, `HUMAN_EVAL.md` | Human evaluation set and protocol |

Two reporting rules the design commits to:

- **Never quote the 0% `<unk>` without the 5.697.** In-vocabulary but heavily
  fragmented is a sequence-length *cost*, not a coverage win.
- **Exact-Thaana recovery is the wrong gate.** It punishes the round trip for
  *normalising* nonstandard source Thaana, which is the correct behaviour. R-1.8
  gates on Latin stability.

### 5.5 Client-side storage map

| Store | Key | Contents | Lifetime |
|---|---|---|---|
| `sessionStorage` | `latin-mv-tlt:last-result:v2` | last `PipelineResult` for the Breakdown | tab |
| `sessionStorage` | `latin-mv-tlt:llm-session` | LLM settings **including the key** | tab (default) |
| `localStorage` | `latin-mv-tlt:llm-local` | LLM settings, only under "Remember on this device" | until cleared |
| `localStorage` | `latin-mv-tlt:feedback` | `FeedbackRow[]` | until cleared |
| Cache Storage API | transformers.js cache | model weights | browser-managed |

**Model weights live in the Cache Storage API, not IndexedDB.** This is called out
because the requirements text said IndexedDB and an examiner following it would look
in the wrong devtools panel (R-3.12, amendment 3).

---

## 6. User interface design

### 6.1 Screens

| Screen | Role | Design commitments |
|---|---|---|
| **Translator** | the main artefact | Direction toggle; Thaana IME on the dv→en input; download progress with `role="status" aria-live="polite"`; on failure shows **"Final translation: Unavailable"** plus the reason plus the verbatim model input — never a substitute sentence |
| **Breakdown** | first-class research deliverable | Renders every trace field; one `TraceView` per sentence; reads `sessionStorage`, so it works after a screen switch; each gloss headword opens it in the Dictionary |
| **Dictionary** | searchable lexicon browser | Search-first, never an A–Z listing (§6.6); a script toggle drives the IME; Thaana generated per DD-13 and labelled as generated; `frequency` shown only where `freqSource` exists; counts reported as shown-of-exact-total |
| **Chat** | optional demo | English only leaves the device |
| **Feedback** | meaning + naturalness 1–5, optional correction | CSV export |
| **Benchmarks** | measured metrics only | The live entry count from `getEntryCount()` — the same number the Dictionary reports — merged with the build-script figures `dictionary_stats.json` actually carries and with `benchmarks.json`; a note when the stats file disagrees with the shipped lexicon; the stats file's `source` never rendered; unmeasured metrics displayed **as** unmeasured |
| **About** | problem, method, architecture, limits | The only screen that renders before `ready` |

### 6.2 `TraceView` — the method on screen

Six blocks, each with a state badge: Original · Latin transliteration (dv→en only) ·
Dictionary · **Model input** · **Model output** · Back-transliteration (en→dv only) ·
Final translation.

The model-input block shows the string **verbatim, prefix included**, in monospace.
The task prefix is *how one model serves both directions*, so it belongs on screen.
This is a more honest view than v0.1 offered: v0.1 displayed the frame string — a
*rule-based* artefact — in the position where a reader would reasonably expect to see
what the neural model was actually given.

### 6.3 Script rendering

Chrome stays Inter / LTR. Only Thaana-bearing nodes get `.font-thaana` (Faruma,
RTL), decided per node by `hasThaana(...)`, never per page. The font is bundled
(`public/fonts/`) so Thaana renders on a machine with no Dhivehi font installed
(NFR-10); `src` is `local("Faruma")` first, so an installed copy is preferred over
the download, with `font-display: swap` so text is never invisible while it loads.

**Inside a table cell, `.font-thaana` goes on a `<bdi>`, never on the `<td>`.**
The class carries `direction: rtl; text-align: right`; on a cell that silently
flips the whole column's alignment. `<bdi>` is inline and defaults to
`unicode-bidi: isolate`, which is exactly what a Thaana run sitting between LTR
cells needs, and `text-align` does not apply to it. Every earlier use puts the
class on a block that *is* the whole line (`TraceView.tsx`, `Chat.tsx`,
`Translator.tsx`), which is why the trap had not bitten before the Dictionary
screen put Thaana in a column.

The `@font-face` URL is the **root-absolute public path** `/fonts/Faruma.ttf`, not a
base-prefixed literal. Vite injects `base` into public-file references in CSS in both
dev and build, so the emitted rule is `/latin-mv-tlt/fonts/Faruma.ttf` without the
deployment path being written into a stylesheet. Hardcoding it — as an earlier
version did — makes the font silently fall back to a system font under any other
base, which is a failure with no error attached to it.

### 6.4 The Thaana IME (`useThaanaIme`)

Users type Malé Latin on an unmodified QWERTY keyboard and see Thaana appear in
place, so the OS layout never has to change (R-1.7).

**Composition state** is `{ latin: string; start: number | null }` held in a ref.
Each Latin keystroke re-transliterates the *whole* composing run rather than
appending one character, because Thaana output length is not a function of Latin
input length (`th` is one character, `aa` is one diacritic). Composition continues
only when the caret is collapsed **and** sits exactly at `start + latinToThaana(latin).length`
— any other caret position starts a new run, which is what makes clicking elsewhere
mid-word behave correctly.

**Backspace deletes one Latin character and re-renders**, so `aharen` → backspace
gives `އަހަރެ`, not a half-formed cluster. When the composing buffer empties the state
resets to idle.

The hook is `enabled` only on the dv→en direction; en→dv input stays English.
`applyLatinKey` and `applyImeBackspace` are exported as pure functions so they are
unit-testable with no DOM (`useThaanaIme.test.ts`), which matters because the whole
suite runs under `environment: 'node'`.

### 6.5 Layout and theme

Sidebar on desktop, `MobileNav` below the breakpoint, shared `TopBar`. Tailwind with
a `brand` palette and class-based dark mode; the theme's precedence and persistence
are described in §3.10.

---

### 6.6 Why the Dictionary screen is search-first

The lexicon is sorted by headword, and its first two entries are inverted rows —
`{"latin": "a goal in sport", "english": ["lan'du jehun"]}` — English in the
headword column, Dhivehi in the glosses. An A–Z browse would therefore open on
the worst data in the file. An empty query shows an empty state with example
chips instead, and the alphabet is never the entry point.

The screen also declines to *classify* the defective rows. The obvious heuristic
— flag a row whose glosses are all themselves known Latin headwords — fires on
1,565 of 15,528 rows, including correct ones such as `a'zum → ambition`. A badge
that wrong would attach a confident label to a guess, which is the failure G1
exists to prevent. The screen states the problem in prose, shows the matched key
per row so a surprising result explains itself, and leaves classification to a
human.

## 7. State and error design

### 7.1 Stage states

**Five states over six stages.** The states are `done · empty · not_loaded ·
unavailable · error`; the stages are `original · transliteration · dictionary ·
translation · backTransliteration · final`.

`error` is new in v0.2. Without it, a failed ONNX load rendered **identically** to
"never asked for" — which is wrong on the face of it and contradicts the requirement
that the underlying error be surfaced (R-5.3, R-3.8).

### 7.2 The decision table

| Condition | `translation` | `backTransliteration` | `final` | `output` |
|---|---|---|---|---|
| model produced text | `done` | dv→en `empty`, en→dv `done` | `done` | the text / the Thaana |
| model not loaded | `not_loaded` | `empty` / `unavailable` | `unavailable` | `null` |
| model errored | `error` | `empty` / `unavailable` | `unavailable` | `null` |
| stage not applicable to the direction | — | `empty` | — | — |

`empty` means *nothing to do here*; `unavailable` means *this should have produced
something and could not*. Conflating them is what v0.1 did.

### 7.3 Failure containment

| Failure | Blast radius | Mechanism |
|---|---|---|
| Honorifics fetch fails | register detection only | `.catch(() => undefined)` at startup; loader returns `{}` on any non-OK response |
| Dictionary fetch fails | translation screens withheld, error shown, About still reachable | `ready` gate in `App.tsx` |
| Model fetch/session fails | `error` status + message on Translator and Breakdown; transliteration, glossing and IME keep working | four-state machine; `ensureTranslationModel` never rejects |
| Sentence over 128 tokens | that sentence only | runner throws → `status: 'error'` with the token count and the reason |
| Dictionary miss | one gloss shows `[unknown: …]` | glossing runs beside translation (R-5.6) |
| LLM call fails | Chat only | adapter throws; translation path untouched (D3) |

---

## 8. Performance and resource design

| Concern | Design response |
|---|---|
| First paint before 80 MB of ONNX | `await import('@huggingface/transformers')` inside `loadPipeline` keeps ORT out of the initial bundle (R-1.4) |
| Repeat visits | Cache Storage via transformers.js; after the first load, translation needs no network (R-3.12) |
| One WASM thread | Sentences translated sequentially; `numThreads = 1`, `proxy = false` (R-3.11) |
| 16k-key prefix scan per word | Sorted key array + `lowerBound`; `MAX_PREFIX_SCAN = 500` |
| Repeated word lookups | `Map` cache bounded at `MAX_CACHE = 5000` |
| StrictMode double-mount | In-flight promise memoisation in `loadDictionary` and `loadHonorifics` |
| Five regex rebuilds per sentence | `identifyScript` rewritten as one pass with module-level regexes |
| Silent 80 MB stall | Progress listener set + replay-on-subscribe (R-6.10) |
| 15k-entry browse scan per keystroke | Exhaustive `indexOf` scan + bounded top-*k* insertion, no full sort. 1–9 ms typical, ~22 ms worst case (one character). `useDeferredValue`, not a debounce — the table render is the slower half, and a debounce would add latency to every keystroke including the fast ones |
| Model bloat regressing | `check:models` in CI, on bytes **and** on forbidden graph names |

---

## 9. Security and privacy design

- **No accounts, no server, no telemetry.** Nothing leaves the device on the
  translation path — ever, in any configuration.
- **API keys** default to `sessionStorage`; `localStorage` only under an explicit
  "Remember on this device". Never in git, never in source, never in a CSV export.
- **The LLM receives English only**, and only from the Chat screen, and only after
  the user supplies a URL and key.
- **Feedback data stays local** and is exported by explicit user action.
- **No third-party runtime origin.** Model weights and the ORT WASM are same-origin
  by construction; `allowRemoteModels = false` and the vendored `wasmPaths` are the
  two settings that enforce it, and both are in one guarded block.

Two known weaknesses are recorded honestly in §13 rather than glossed: CSV formula
injection, and a `null` `apiUrl` crash path.

---

## 10. Build, test and deployment design

```text
npm run dev     predev  → copy-ort.mjs        vite dev at /latin-mv-tlt/
npm run build   prebuild → copy-ort.mjs       tsc -b && vite build
                postbuild → prune-ort-assets.mjs
npm test        vitest run, environment: 'node'
npm run check:models  80 MB + forbidden-graph gate
```

**`base: '/latin-mv-tlt/'`** in `vite.config.ts` is why the dev server serves the app
under that path and not at the root; `import.meta.env.BASE_URL` is what makes the
model path, the ORT path and the data fetches work identically in dev, preview and
Pages.

**CI ordering is the design point.** `deploy` *depends on* `test`. Until v0.2 there
was no test job at all — CI built and deployed, so the "all tests pass" acceptance
criterion was unenforced and the forbidden-graph rule could regress silently.

```text
test:  checkout → node 22 → npm ci → tsc -b → npm test → npm run check:models
deploy: needs: test, skipped on pull_request → npm run build → upload dist/ → Pages
```

**Test design.** 103 tests across 12 files. The suite touches no model and no network
(NFR-6), which the runner's test-mode short-circuit guarantees structurally rather
than by convention.

`environment: 'node'` remains the **default** on purpose: the core must be able to
run with no DOM, and a jsdom default would hide an accidental `window` or
`document` reference inside `src/core/**`. The two component suites opt in per file
with a `// @vitest-environment jsdom` docblock, so the opt-in is visible at the top
of the file that needs it rather than buried in config.

| Suite | What it pins |
|---|---|
| `transliterator` | round trips both ways, preserved segments, prenasalized Latin-stability |
| `suffixParser`, `stemWord` | longest-suffix matching, the two tables agreeing on `kamah`, composed spelling variants, honest failure on an unknown root |
| `lookup`, `closedClass` | staged lookup and ranking; every closed-class asymmetry either impossible or declared |
| `segmentSentences` | all five boundary rules, including decimals and abbreviations; the R-5.8 tokenizer contract, and that both pipeline directions use it |
| `pipeline`, `enToDv.output` | the empty-input guard, and `latin` being the model's *output* on en→dv |
| `useThaanaIme` | the pure composition functions |
| `search`, `Dictionary` | exact totals under truncation, both-sides matching, multi-word gloss hits, copies not references, `<bdi>` never on a `<td>`, uncounted frequency shown as `—`, and that browse left the translation path untouched |
| `TraceView` | verbatim model input, Unavailable with nothing invented, error surfaced, preserved segments listed, Thaana font applied only to Thaana |
| `Translator` | the same refusal at screen level, through the *real* pipeline in its not-loaded state; direction switching; the trace reaching `sessionStorage`; QWERTY Latin becoming Thaana in place |
| `Breakdown` | the empty state vs. a stored trace; one `TraceView` per sentence and numbering only past one; a clicked headword reaching `onLookup`; the glosses still rendering as plain text with no navigator attached |
| `Chat` | that **nothing is sent** when the model is not loaded — the screen-level form of "only English leaves the device"; the no-key refusal; the composer not stuck after a failed send; QWERTY Latin becoming Thaana; the key field staying `type="password"` |
| `Feedback` | prefill from the last trace; the stored row carrying that trace's direction; the confirmation clearing when a field changes; and the CSV formula-injection guard in `lib/feedback.ts` |
| `Benchmarks` | that the live entry count renders even when the stats file carries none of the build-script keys — the regression that made the DICTIONARY group empty; the staleness note appearing only on disagreement; the build machine's absolute path never rendered |
| `App` | R-6.9 at shell level: the data screens withheld while loading and after a failure, About reachable throughout, and a gloss clicked on the Breakdown arriving in the Dictionary already searched |

There is no `About.test.tsx`. About is static prose with one real contract — that
it renders outside the `ready` gate — and that is a property of the shell, so it
is asserted in `App.test.tsx` where the gate lives. A snapshot of the copy would
assert nothing and would have to be edited every time the prose is.

The `Translator` suite is deliberately not mocked. `MODE === 'test'` puts the runner
in exactly the state a user hits before the weights exist, so the test exercises the
production refusal path rather than a stand-in for it.

---

## 11. Design decisions and rejected alternatives

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| DD-1 | One seq2seq model, two task prefixes | Two direction-specific models | Halves the download and the memory; one set of weights to train, export and version. Two models is explicitly forbidden by R-3.1 |
| DD-2 | Latin pivot; the model never sees Thaana | Train directly on Thaana | Thaana fragments badly under a Latin-trained tokenizer; the pivot buys 0.0% `<unk>` and lets ~360 lines of rules do what weights would otherwise have to learn |
| DD-3 | Rule-based transliteration, both directions | Learned transliteration | Deterministic, testable, needs no download, and its error rate can be *measured* and used as a gate |
| DD-4 | Gate on Latin stability, not exact Thaana | Exact round-trip accuracy | One canonical romanization makes exact recovery mathematically impossible (DD-5); exact match also punishes correct normalisation of nonstandard source Thaana |
| DD-5 | One canonical romanization | Preserve Arabic-derived letter distinctions | Ten letters collapse many-to-one. Preserving them would need a second alphabet the model has never seen. The loss is accepted and named (R-1.2) |
| DD-6 | Prefixes defined once in TS, read by Python | Hardcode the strings in the corpus builder | Drift between corpus and runtime degrades quality *silently* — no error, just worse output |
| DD-7 | Refuse over-length input | Let the tokenizer truncate | Truncation yields a fluent translation of half a sentence with no signal. A refusal is honest (G1) |
| DD-8 | Whole-domain held-out splits | Random row split | A random split over near-duplicate news text inflates BLEU. Domain holdout measures what the system will actually face |
| DD-9 | Glossing beside translation | Glossing as model input | A lexicon gap must never be able to fail a translation (R-5.6) |
| DD-10 | Sequential per-sentence inference | `Promise.all` | One session, one WASM thread; concurrency adds contention and peak memory, not speed |
| DD-11 | Vendor the ORT WASM | Use the library's CDN default | A CDN dependency at translation time contradicts the browser-only, no-third-party constraint |
| DD-12 | Quantize after merging | Ship an unmerged decoder under the merged name | Removes the ~159 MB fp32 merge *and* the `runBeam` monkey-patch it forced |
| DD-13 | Drop the `dhivehi` column | Ship it | 70.4% of it was a deterministic function of a field already present; dropping it saved ~620 KB |
| DD-14 | Four model states, five stage states | Keep `not_configured`; conflate `empty` with `unavailable` | A state that cannot occur is a state the UI renders wrong |
| DD-15 | Model-or-nothing output | Fall back to concatenated glosses | A plausible-looking wrong sentence is worse than an honest "Unavailable" (G1) |
| DD-16 | No router, single-state screen switch | React Router | Seven screens on a static base-path deploy; a router adds a build-time and cognitive cost for nothing gained |
| DD-17 | **Abandon the semantic-frame architecture** | Keep v0.1 | ~60 content words of coverage for 307 MB tracked / ~148 MB fetched, versus open-domain coverage for one ≤80 MB model. See Appendix A |
| DD-18 | One tokenizer (`tokenizeWords` / `extractWordsOnly`) for the whole system | Per-consumer tokenizers | Divergent word definitions made the Breakdown's dictionary panel disagree with the pipeline about the same sentence — a visible inconsistency with no error attached. Promoted to **R-5.8** in requirements revision 0.2.3 |
| DD-19 | Declare closed-class collapses in a list and test them | Force the tables symmetric, or leave them unchecked | Dhivehi genuinely collapses `me`/`I`; forcing symmetry would be wrong. Declaring the collapses makes the *undeclared* ones fail CI |
| DD-21 | Browse scans exhaustively; lookup keeps its binary search | Reuse `lowerBound` and a scan cap for browse too | A capped scan cannot honestly say "showing 50 of 762". The cap exists to keep the translation path tight; the browse screen's whole contract is the denominator |
| DD-22 | Rank browse by match kind → headword-hit before gloss-hit → length → alphabetical; **never** by `frequency` | Reuse `lookupLatin`'s frequency tiebreak | 93.9% of rows sit on the placeholder constants 50 or 1; only 759 of 15,528 carry a `freqSource`. A ranking that looks meaningful and is arbitrary is worse than an alphabetical one |
| DD-20 | Node test environment by default, jsdom per file | jsdom for everything | A jsdom default would hide an accidental DOM reference in `src/core/**`, which must stay headless (NFR-6) |

---

## 12. Traceability — requirement → design

| Requirement | Design element |
|---|---|
| R-1.1, R-1.2 | §3.3 shared `mappings.ts`, one canonical romanization |
| R-1.3 | §3.3 preserved segments; §6.2 `Unconverted:` line |
| R-1.4 | §3.3 zero-model availability; §8 dynamic import |
| R-1.7 | §6.4 `useThaanaIme` |
| R-1.8 | §3.3 forward/reverse inverse rules; §5.4 measured stability |
| R-2.1b, R-2.6 | §5.2 corpus and whole-domain splits |
| R-2.2 | §2.2 `tools/transliterate.mjs` bridge; `transliteratorSha256` |
| R-2.5 | §3.6.1 `prefixes.ts` as single source of truth |
| R-3.1 | §3.6.2 one `MODEL_ID`, four module slots |
| R-3.4, R-3.13 | §5.3 budget arithmetic; §3.11 `check-models.mjs`; §10 CI gate |
| R-3.5 | §3.6.2 greedy decoding, 128 in / 128 out |
| R-3.6 | §3.6.2 `allowRemoteModels = false`, vendored `wasmPaths` |
| R-3.7, R-3.8 | §3.6.2 shared in-flight promise; four-state machine |
| R-3.9 | §3.7 `output: null`; §6.1 "Unavailable" |
| R-3.11 | §3.6.2 `numThreads = 1`, `proxy = false` |
| R-3.12 | §5.5 Cache Storage API |
| R-4.2, R-4.3, R-4.6 | §3.4 structures and staged lookup |
| R-4.4, R-4.5 | §3.5 register detection; §7.3 containment |
| R-4.8 | §3.4 browse path; §6.3 `<bdi>` rule; DD-21, DD-22 |
| R-5.1 | §2.4 segment-then-translate |
| R-5.2 | §3.7 trace fields; §6.2 `TraceView` |
| R-5.3 | §7.1 five stage states, `error` added |
| R-5.4 | §3.7 empty-input guard |
| R-5.5 | §2.4 normalise once, transliterate once |
| R-5.6 | §2.4 glossing beside translation; DD-9 |
| R-5.7 | §3.2 five segmentation rules, script-aware terminators |
| R-5.8 | §3.2 one tokenizer, both directions; decimals and contractions preserved |
| R-6.1 – R-6.6, R-6.12 | §6.1 screens; §6.6 search-first |
| R-6.7, R-6.8 | §6.5 layout and theme |
| R-6.9 | §3.9 startup ordering; §7.3 |
| R-6.10 | §3.6.2 progress listeners; §6.1 progress bar |
| R-7.x | §3.8 LLM adapter; §9 |
| R-8.4, R-8.8 | §3.11 per-direction metrics; §5.2 domain holdout |
| R-9.2, R-9.3 | §3.11 training defaults; `export_onnx.py` assertions |
| NFR-2, NFR-3 | §2.1 no server tier; DD-11 |
| NFR-6 | §3.6.2 test-mode short-circuit; §10 node-environment suite |
| NFR-7 | §3.6.2 greedy decoding |
| NFR-10 | §6.3 bundled Faruma |
| NFR-13 | §3.11, §10 model budget gate |

---

## 13. Known design gaps and debt

Fuller accounts: [`Context/STATUS.md`](../Context/STATUS.md),
[`Context/QUALITY.md`](../Context/QUALITY.md).

### 13.1 Outstanding

**Blocking the product — neither is a code defect**

- **No trained checkpoint.** The design is complete and the application code is
  migrated, but M-3 (training) and M-4 (export) have not been run; both need a
  GPU. The Translator therefore reports *Unavailable*, which is the design working
  as specified (G1). BLEU, chrF++ and human ratings are unmeasured, and Benchmarks
  says so.
- **`public/models/{en,dv}-realize` (307 MB) is still on disk.** v0.1 dead weight,
  scheduled for removal at **M-8b — explicitly gated on the v0.2 model being
  verified in a browser first**, which cannot happen until there is a checkpoint.
  Deleting it now would discard the only working models in the repo before their
  replacement exists, so it is deliberately still here. `.git` stays ~65 MB either
  way: the blobs are in history and rewriting it is not authorised.

**Design limits, accepted rather than fixed**

- **The three-level honorific paradigm is an unwired stub.** Fritz Vol. II does not
  attest a systematic three-level honorific system — only eight mostly dialectal
  tokens — so there is nothing to implement against. What is attested (the written
  narrative particle `eve`) *is* implemented. The stub is not claimed anywhere in
  the UI. This is a limit of the sources, not of the code.
- **Lexicon leftovers needing human work**: Radheef "a kind of plant/fish" glosses,
  placeholder frequencies, 315 mirror ties, 26 quarantined rows, 179 `unknown` POS.
  Verb and location slots were not widened; that needs Fritz-attested inflection
  tables.
- **Four closed-class entries were removed, not replaced** (`work`, `stay`,
  `never`, `exist`). They now fall through to the bilingual dictionary, which is
  more likely right than a wrong hardcoded override — but a native speaker should
  decide whether correct entries belong there.
- **Segmentation exceptions are heuristics.** A lowercase single letter followed by
  a stop and a space (`a. b`) is now read as an initialism rather than two
  sentences. That is the deliberate trade for handling `e.g.` and `U.S.`; a
  one-letter lowercase sentence is vanishingly rarer than an initialism.
- **`@huggingface/transformers` pulls a vulnerable `sharp`** (GHSA-f88m-g3jw-g9cj,
  no fix available). `sharp` is a Node-only optional dependency of the library and
  is not in the browser bundle, so it does not reach the deployed artefact — but it
  is in the lockfile and `npm audit` reports it.

### 13.2 Closed since the first draft of this document

Each was listed as outstanding above; each now has a regression test.

| Gap | Resolution |
|---|---|
| `tokenizeWords('3.14')` → `['3','.','14']` | Token classes keep decimals and thousands separators whole (§3.2) |
| `segmentSentences('3.14 is pi.')` split the number | Rule 4: a stop flanked by digits is not a boundary |
| `segmentSentences('Dr. Smith went.')` split the title | Rule 5: abbreviation lexicon, capitalised initials, dotted initialisms |
| Divergent tokenizers across the pipeline | One tokenizer, both directions (R-5.8, DD-18) |
| `extractWordsOnly` silently dropped contractions | Filter widened to the full word token class |
| `kamah` glossed `some` in one table and `to` in the other | `to` in both; test asserts they agree |
| Spelling variants never composed | Fixed point over the letter-variant rules, bounded at 64 |
| `latinToThaana` not a full inverse for prenasalised stops | The forward rule now reads the stop's own diacritic; all forms Latin-stable |
| `work → kurun → do` and friends unchecked | Four wrong entries removed; remaining collapses declared and enforced (DD-19) |
| Feedback CSV: blob revoked too early | Anchor attached before click; revoke deferred |
| Feedback CSV: formula injection | Leading `=`/`+`/`-`/`@`/control prefixed with an apostrophe |
| Chat adapter crashed on `apiUrl: null` | `endpointFor` falls back; `loadSettings` drops nulls before the spread |
| Chat had no `AbortController` | Signal threaded through; Cancel button replaces Send while in flight |
| Dark mode ignored `prefers-color-scheme` and never persisted | Explicit choice → system → light, persisted, synchronous on first render |
| No component tests | jsdom opt-in per file; `TraceView` and `Translator` suites (§10) |
| Faruma `@font-face` hardcoded the deployment path | Root-absolute public path; Vite injects `base` (§6.3) |
| `Context/PROJECT.md` described the v0.1 architecture | Rewritten for v0.2 |

### 13.3 Recorded in `STATUS.md` but no longer present

Verified against the code while writing this section. These were carried forward
from v0.1 notes and describe modules the migration deleted:

- **`deserializeFrame` cannot parse `serializeFrame`'s output.** Both functions are
  gone with `src/core/frames/`.
- **Unreachable `extractDv` `'ga'` branch.** `extractDv` and `extractEn` are gone.
- **`parseSuffix('age')` yields root `"a"`.** It returns `age` with no suffix;
  `minStemFor` already guards it, and `stemWord.test.ts` pins the behaviour.
- **Ten dead exports.** The sweep found the residue was `LOCATION_LATIN`,
  `SUBJECT_LATIN`, `PARTICLE_LATIN` (v0.1 frame-slot classifiers) and
  `parseWordList` (an unused wrapper) — all now deleted. `englishGloss` and
  `latinValue` were dead only because `TraceView` reimplemented them inline; it now
  calls them. The rest of the unreferenced exports are public API surface or types
  (`SuffixParse`, `REGISTERS`, `mergeEve`'s Fritz sandhi rules), retained
  deliberately.
- **Unreachable `thaanaToLatin` `'އ'` branch.** Confirmed dead — `އ` is in
  `THAANA_CONSONANTS` mapped to the empty string, so the consonant branch always
  claimed it first and produced the identical result. Now removed.
- **Dead `forms.delete(base)`.** Confirmed dead — the `if (suffix)` guard already
  keeps `base` out of the set. Now removed.

## Appendix A — the superseded v0.1 design, and why

Recorded because the *decision* is part of the design, and because the frame idea is
the project's most distinctive research material. Full account:
`REQUIREMENTS.md` Appendix A.

**What it did.** Latin → dictionary + morphology → a **semantic frame** → two T5
*sentence-realization* models (`en-realize`, `dv-realize`) → a sentence.

The frame was the contract between the two halves:

```json
{"subject": "I", "action": "go", "object": null, "location": "Male",
 "time": null, "manner": null, "reason": null, "tense": "future",
 "polarity": "affirmative", "register": "spoken", "residue": []}
```

serialised as

```text
SUBJECT=I | ACTION=go | LOCATION=Male | TENSE=future | POLARITY=affirmative | REGISTER=spoken
```

**Two ideas in it were genuinely good and are worth defending on their own merits:**

- **`residue`** — tokens the extractor could not classify were *retained and
  displayed*, so lossy extraction was visible rather than silent. That instinct
  survives directly in v0.2's `thaanaPreserved` and in the stage-state design.
- **`register` as a first-class slot** — written Dhivehi past-tense clauses end in
  `eve` and spoken ones do not, so without the slot one frame string mapped to two
  valid sentences and the model could not learn which to emit.

**Why it was superseded.** Training pairs were combinatorial over a curated slot
vocabulary — 7 subjects, 16 verbs, 12 objects, 5 locations, 7 times, roughly sixty
content words — expanded to 16,141 English and 14,270 Dhivehi synthetic pairs. So
*"The parliament passed the amendment yesterday"* could not be translated **at all**:
the nouns and the verb were not slots. The apparent scale of the training set
measured combinatorial expansion, not linguistic coverage. And the cost was inverted
against the benefit — two models, 307 MB tracked (~148 MB fetched) — for *less*
coverage than one ~80 MB model trained on real parallel text.

| | v0.1 | v0.2 |
|---|---|---|
| Neural components | 2 | 1 |
| Coverage | ~60 slot words | open-domain, corpus-limited |
| Training data | ~30k synthetic combinatorial | 285,748 real parallel pairs |
| Runtime download | ~148 MB | ≤80 MB target |
| Repo weight | 307 MB tracked | ≤80 MB tracked |
| Failure mode | out-of-vocabulary → unavailable | out-of-domain → degraded |

**The accepted cost, stated plainly.** The frame representation was the project's
distinctive contribution; v0.2 trades it for coverage. The trade is argued, not
hidden.

**What survived — most of the engineering.** The transliterator, dictionary lookup,
the suffix parser, honorific and register detection, the React UI, the Pages
deployment, the stage-state trace concept, the model-or-nothing principle, and the
empty-input regression guard.

**If it is ever revived,** the frame layer is most defensible as an *interpretability
overlay* on a direct model — deriving a frame from the translation to explain it —
rather than as the translation mechanism itself.
