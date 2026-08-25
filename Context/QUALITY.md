# Quality

Working notes for the next translation-quality cycle. This folder is not the dissertation. Architecture: [PROJECT.md](PROJECT.md). Lexicon and pair counts: [DATA.md](DATA.md). How to train: [TRAINING.md](TRAINING.md). Measured bugs: [STATUS.md](STATUS.md).

This file does **not** change the runtime. It is the instruction set before more T5 training.

**Narrowed target:** latin-mv-tlt is not a general Dhivehi machine translator. It is a **controlled-domain conversational translation layer** for everyday chat and common LLM replies. Browser-only is a sensible design for that, not a limitation.

Research question this cycle (PROJECT.md stays as written):

> Can a Latin semantic representation of common conversational sentence types preserve enough information for browser-based Dhivehi–English translation of everyday chat and LLM replies?

The quality ceiling is data and representation, not the stack. The shipped lexicon has **15,302** Latin entries; the realization corpus only covers **7 subjects, 16 verbs, 12 objects, 5 locations, 7 time words**. Row count is not linguistic diversity. **Do not increase T5 training until surface → lemma → gloss is reliable.** Browser memory is not the 6,000-word bottleneck; lookup and context are.

## Immediate bottleneck: lookup, not T5

An 84-sentence pipeline-trace dump showed **373 unknown occurrences / 292 distinct unknown forms**. Those traces are not in the repo yet; keep them under `evaluation/` as the unknown-rate regression set.

First sentence of that dump: `musaara → pay` and `ves → also` hit, but `libumaaeku`, `enmen`, `dhakkanee`, `konme`, `mahegge`, `husveeve` did not. The frame kept `ACTION=dhakkanee` and `OBJECT=pay` and dumped the rest into residue. T5 then produced `Pay.` T5 did not fail first — **the meaning was already gone**.

```text
Dhivehi sentence
        ↓
Latin                       ✓
        ↓
Dictionary                  ⚠ many failures
        ↓
Morphology                  ⚠ insufficient
        ↓
Semantic frame              ✗ meaning lost
        ↓
T5                          receives a bad frame
        ↓
Bad translation
```

T5 cannot recover information the frame no longer contains. Residue is doing its job; do not hide it.

### Inflected unknowns

Many “unknowns” are inflected forms, not missing lemmas: `kotareege`, `epaatmantegge`, `nooneve`, `jehenee`, `balaairu`, `jehifaivaa`, `libumaaeku`, `sababun`, `ithurun`, `gothugai`. Repeated endings:

```text
-ge  -ah  -gai  -eh  -aku  -akah  -aaeku  -aai  -eve  -un  -gen  -fai  -vaa  -nee
```

If `kotari` is in the lexicon, exact lookup of `kotareege` misses it. Need:

```text
kotareege
        ↓ morphology
kotari + ge
        ↓
lemma = kotari
case  = possessive/genitive
```

Malé Latin spelling and vowel-change rules belong here (`kotaree` vs `kotari`).

Runtime already tries exact lookup, then `stemWord` (recursive strip, `MAX_STRIP_DEPTH=3`, `known()` gate) in [`lookup.ts`](../src/core/dictionary/lookup.ts) and [`suffixParser.ts`](../src/core/morphology/suffixParser.ts). That path exists and is **still insufficient** on real traces: stem variants, compounds, and `englishGloss` taking `english[0]`. Suffix tables also contradict each other (`kamah`); see STATUS.md.

Target lookup:

```text
Surface word
        ↓
1. Normalize spelling
        ↓
2. Exact dictionary lookup
        ↓ failed
3. Detect suffixes (recursive: ROOT + CASE + CONJUNCTION + FORMAL ENDING)
        ↓
4. Generate possible stems
        ↓
5. Look up stems
        ↓
6. Aliases / irregular forms
        ↓
7. Return lemma + morphology
        ↓
UNKNOWN only if all fail
```

Removing only a final `eve` and trying the dictionary once is not enough.

### Sense selection

Hits can be the wrong English. Traces included `bura → complaint`, `libey → damage`, `haradhu → a kind of spice`, `sitee → letter`, `kaadu → food`. `bura masakkaiy` became `OBJECT=complaint` and later `The complaint was`. That is not a missing-word problem.

Current [`DictionaryEntry`](../src/core/dictionary/types.ts) is `{ latin, english[], pos, frequency }`. Radheef definitions such as `"a kind of fish"` land in `english[]` and become slot values. Split:

```text
lemma                kalhubilamas
english_gloss        [specific English name if known]
semantic_class       fish
definition           a kind of ...
```

The translator uses `english_gloss`, not `definition`. Pick sense with document context when needed. `englishGloss` must stop feeding `english[0]` into frames.

## 6,000-word documents

Technically fine in-browser. Do **not** send 6,000 words as one input. T5 realizes frames, not documents. Load the model once; reuse it per sentence. Run translation in a **Web Worker** so a long document does not freeze the UI. Show progress (`127 / 384 sentences`) and stream completed **paragraphs**.

```text
6,000-word document
        ↓
Preserve paragraphs
        ↓
Sentence splitter
        ↓
Sentence 1 → frame → translate
Sentence 2 → frame → translate
        ...
        ↓
Reassemble paragraphs
```

The hard part is **context**, not RAM. Keep a tiny rolling object, not the full text:

```text
context = {
  topic,
  recentPeople,
  recentLocations,
  previousSubject,
  previousObject,
  register
}
```

So `Ahmed went to the office. He met his manager there.` can resolve `he → Ahmed` and `there → office`. The same splitter is required for LLM replies. Fix `segmentSentences` / decimal shredding (STATUS.md) before this path is usable.

## Three longer-term problems

Keep these distinct. T5 cannot fix the first two.

1. **Semantic analysis.** Latin → dictionary + morphology → frame. Wrong roles cannot be rescued. The realizer is not a grammar corrector (PROJECT.md). Measure frame accuracy separately from BLEU/chrF.
2. **Dictionary is lexical, not translation-oriented.** See Sense selection above.
3. **T5 is learning the combinatorial SVO dataset.** Thousands of rows from 7×16×12 slots memorize `aharen dhaanan`. `SUBJECT=car | ACTION=collide | OBJECT=solar_panel` is out of distribution. Retrain around **sentence structures**, not cartesian products. Do not treat 16k examples as the important number.

## Conversation patterns, not all grammar

Coverage target: **30–50 sentence structures**, not full Dhivehi grammar.

```text
މިއަދު ވާރޭ ވެހޭނެ؟
        ↓
INTENT=weather_question | EVENT=rain | TIME=today
MODAL=future_probability | QUESTION=yes_no | REGISTER=spoken
        ↓
Is it going to rain today?
```

Useful types:

| Type | Example |
|---|---|
| Question | Is it going to rain today? |
| Simple fact | The weather is cloudy. |
| Negative fact | It is not expected to rain. |
| Probability | There is a 4% chance of rain. |
| Explanation | This happens because... |
| Instruction | Open Settings and select... |
| Suggestion | You can try restarting it. |
| Conditional | If that doesn't work... |
| Clarification | Could you tell me your location? |
| Confirmation | Yes, that is correct. |
| Uncertainty | I don't have enough information. |
| Capability | I can help you with that. |
| Comparison | X is cheaper than Y. |
| List intro | Here are a few options. |
| Time statement | It should finish tomorrow. |
| Location statement | This service is available in Malé. |

Do not force extras into `SUBJECT` / `OBJECT` / `LOCATION`. Frames should carry sentence `TYPE` plus typed slots (`EVENT`, `TIME`, `MODAL`, `QUESTION`, `POLARITY`, `PROBABILITY`, …). **Keep `residue`.**

## LLM replies: split first, then frame

Do not put a whole paragraph in one frame.

```text
LLM English response
        ↓
Sentence splitter
        ↓
Sentence-type detector
        ↓
Semantic frame (per sentence)
        ↓
Map vocabulary to Dhivehi Latin
        ↓
Dhivehi realizer
        ↓
Thaana
```

Example (weather reply), three frames not one:

```text
TYPE=statement | TOPIC=weather | SOURCE=latest_forecast
LOCATION=Malé | EVENT=rain | TIME=today | POLARITY=negative | MODAL=expected
```

```text
TYPE=statement | TOPIC=weather | TIME=current
CONDITION=mostly_cloudy | EVENT=rain | PROBABILITY=4%
```

```text
TYPE=conditional_request | CONDITION=different_location
REQUEST=tell_location | POLITENESS=polite
```

## Training data

Stop generating thousands of rows from 7 subjects × 16 verbs × 12 objects. Build examples around conversational structures, then **vary the slots**:

```text
TYPE=probability | EVENT=rain | VALUE=20% | TIME=tomorrow
        →  maadhamaa vaarey vehumuge furusathu 20 insahtha eve
```

Then vary `EVENT` / `VALUE` / `TIME` (`rain`, `delay`, `success`; `20%`, `60%`, `high`, `low`; `today`, `tomorrow`, `this_evening`). Want structural variation and vocabulary variation.

MVP for the **realizer** (the 15,302-entry lexicon still exists for lookup):

```text
1,000–2,000 everyday concepts
+ 40 strong sentence structures
+ good morphology
+ entity/number placeholders
```

Better than 15,000 words with weak structure coverage. The realizer does not need to know all 15,302 words.

## Placeholders

Do not train T5 on every number, location, date, product, person, or technical term.

```text
There is a 4% chance of rain in Malé today.
        ↓
There is a <NUM_1> chance of rain in <LOCATION_1> today.

TYPE=probability | EVENT=rain | VALUE=<NUM_1> | LOCATION=<LOCATION_1> | TIME=today
NUM_1 = 4%
LOCATION_1 = Malé
```

The realizer emits placeholders; a restore step fills them. Coverage without memorizing the open class.

## Register

`REGISTER` belongs in the frame because English has one general `you` while Dhivehi needs social information before that meaning can be realized.

- `REGISTER=formal` — today’s `written` / `eve` style; polite LLM replies, institutional tone
- `REGISTER=conversational` — today’s `spoken`; shorter chat replies

Runtime currently has two overlapping systems: frame `spoken` / `written` in [`types.ts`](../src/core/frames/types.ts) and honorific lexicon `reverential` / `respectful` / `informal` in [`honorifics.ts`](../src/core/morphology/honorifics.ts). Unify around formal vs conversational. Do not rename in code until this cycle is implemented.

## Formal second person: `kaley` is an error

In **formal** Dhivehi, `kaley` / `ކަލޭ` is a **translation error**, not a style choice. Modern standard Dhivehi generally avoids it in polite speech; it can sound accusatory or disrespectful. A descriptive grammar notes that the second-person pronoun is usually avoided for this reason ([Saruna / MNU](https://saruna.mnu.edu.mv/server/api/core/bitstreams/aecf5741-9311-44bc-899e-1747d644ca1c/content)). See also [Fizan on `kaley`](https://faafu.wordpress.com/2019/05/19/kaley/).

Hard rule:

```text
REGISTER=formal
SECOND_PERSON=you

DO NOT REALIZE AS:
kaley, kaleyge, kaleyah, kaleymen
```

Do **not** replace every English `you` with another pronoun. `thibaa` / `ތިބާ` is a literary/respectful form and is **not** required wherever English uses *you*. Formal Dhivehi drops the explicit pronoun and uses respectful verb morphology (`ballavan`, `lehvumun`).

Change the frame from `SUBJECT=kaley` to grammatical features:

```text
SUBJECT:
  person=2
  number=singular
  explicit=false
  honorific=true
REGISTER=formal
```

```text
if REGISTER == formal and person == 2:
    suppress_plain_pronoun = true
    honorific_verbs = true
```

If a sentence truly needs an explicit respectful reference, that is a **separate class**, not `you → thibaa` by default.

Safety check after Latin realization, **before** Thaana:

```text
FORMAL_BLOCKLIST = [kaley, kaleyge, kaleyah, kaleymen]
```

If any appears while `REGISTER=formal`, mark realization invalid and retry or fall back to a rule-based formal template. This is a concrete reason `REGISTER` must stay in the frame.

Training: formal EN→DV pairs must not contain `kaley*`. Conversational register may still allow it if that is the intended tone; formal never does.

## Realization: rules before T5

Keep extraction. Add a grammar / feature layer so case and honorifics are not hidden inside T5.

```text
Thaana → Latin → Morphology → Dictionary → Semantic frame
                                                      ↓
                                    Grammar / feature layer
                                                      ↓
                                          Surface realization
```

Build a **rule-based realizer** for the 30–50 structures first (`aharen male-ah dhaa-nan` → `aharen maleah dhaanan`). Then compare:

- Pipeline A: Frame → rules
- Pipeline B: Frame → T5
- Pipeline C: optional direct small-model baseline

PROJECT.md’s current T5-only rule (show frame / Unavailable if T5 is missing) is the runtime today. This file is the intended change: rules can produce a sentence for the grammar actually supported. Do not edit the runtime until that work is scheduled.

**Keep.** No server. No Thaana sent to a cloud model. Visible intermediates. Offline-capable. Inspectable errors. Residue slot. Browser-only.

## Work order

**Fix lookup before any more T5 training.**

1. Staged lookup + recursive suffix/stem generation, including vowel-change stems (`kotareege` → `kotari+ge`). Use the 84-sentence traces as the unknown-rate test. Fix the STATUS.md suffix-table contradictions.
2. Translation gloss vs definition; stop feeding `english[0]` Radheef definitions into frames. Sense selection for homographs (`bura`, `haradhu`).
3. Sentence splitter that does not shred `Dr.` / decimals; paragraph-preserving 6k-word path + rolling document context (`he` / `there`).
4. Sentence `TYPE` / intent slots; split LLM replies before framing.
5. Placeholder scheme for numbers, locations, dates, names, technical terms.
6. Inventory 30–50 conversational structures; corpus around those, not 7×16×12 cartesian products. Curate 1,000–2,000 everyday concepts for the realizer.
7. Person / number / `explicit` on subjects; formal `you` → suppress pronoun + honorific verbs, never `kaley`. Formal blocklist before Thaana.
8. Rule-based realizer for that inventory; Web Worker + progress UI; **then** retrain T5.
9. Measure separately: (a) unknown-rate / lemma recovery on the trace set, (b) frame accuracy, (c) placeholder restore, (d) formal `kaley` zero-rate, (e) end-to-end on a chat/LLM gold set.
