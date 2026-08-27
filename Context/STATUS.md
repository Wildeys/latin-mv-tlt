# Status

Measured state of **latin-mv-tlt**, not a diary. Data numbers: [DATA.md](DATA.md). How to train: [TRAINING.md](TRAINING.md).

## Now

**v0.2 migration: application code complete, model not yet trained.**

- `npx tsc -b` — clean. `npm test` — **73 passing across 9 files**. `npm run build` — succeeds.
- Architecture is now one direct Dhivehi Latin ↔ English seq2seq model selected by task prefix.
  `src/core/frames/` and `src/core/realization/` are deleted; `src/core/translate/` replaces them.
- Runtime is `@huggingface/transformers` ^3.8.1. The ONNX Runtime WASM is vendored into
  `public/ort/` at build time, so no translation depends on a CDN.
- **Round-trip transliteration measured** (M-2, was GAP-1): **99.35% Latin-stable** over 15,201
  dictionary entries (88.13% exact Thaana, 88.96% folded), and **99.80% Latin-stable** over a
  5,000-sentence sample of the news corpus (27.50% exact, 34.32% folded — exact match punishes the
  round trip for normalising nonstandard source Thaana, which is why R-1.8 gates on Latin
  stability). `evaluation/roundtrip_stats.json`, `evaluation/roundtrip_stats_corpus.json`. Three
  previously missing inverse rules were added — geminates, prenasalized stops, and the coda `h`/`iy`
  sukun specials — which took Latin-stability from ~87% to 99.35%.
- **Parallel corpus built** (M-1): **285,748** real pairs kept from 575,892 rows read, emitted twice
  (one row per direction) as **480,018 train / 49,948 valid / 40,592 test** over 18 domains. Whole
  domains are held out; `conversational` is held out by row instead and appears in all three splits,
  so its scores are in-domain and are not comparable to the news splits.
  `data/parallel/corpus_stats.json`. The ≥200k Stage 2 volume target (R-2.1b) is **met with real
  data** — `syntheticPairs: 0` — so what is outstanding at M-11 is the back-translation pipeline,
  not corpus size. Restate GAP-10 accordingly.
- **Tokenizer profiled** (M-2b): **0.0% `<unk>`** over 2,000 word types (gate ≤5%), mean **5.697
  pieces per word** on `t5-small`, histogram peaking at 5 with a tail to 15.
  `evaluation/tokenizer_profile.json`. In-vocabulary but heavily fragmented — a sequence-length
  cost, not a coverage win. Do not quote the 0% without the 5.697.
- **No checkpoint.** The Translator reports Unavailable and invents nothing. BLEU, chrF++ and human
  ratings stay unmeasured, and the Benchmarks page says so.
- Still to run (yours, needs GPU): M-3 training, M-4 ONNX export. Scripts are committed; see README
  "Offline pipeline".
- `public/models/{en,dv}-realize` (307 MB) is still on disk. It goes at M-8b, after the v0.2 model
  is verified in a browser. `.git` will stay ~65 MB regardless — the blobs remain in history, and
  rewriting it is not authorised by the requirements document.

## Already fixed (headlines)

Empty input no longer reports a successful translation (`[].every(...)` is vacuously true). `latinToThaana` no longer silently deletes unknown characters. **585** direction-inverted dictionary rows were flipped and **1,656** unreachable keys were split. Dhivehi motion targets that used to omit dative `-ah` now carry it. Prefix guesses are no longer labelled high confidence. `nu`-initial words like `nubai` no longer flip polarity. The runtime English verb table matches the generator (`crosscheck.test.ts`). Prefix lookup is a binary search, not a 16k linear scan.

## Open

Each item is reproducible and was deliberately left.

- **`segmentSentences` produces junk fragments.** `"a... b"` → `["a.", ".", ".", "b"]`; `"Dr. Smith went."` → `["Dr.", "Smith went."]`. Each bogus `"."` costs a full pipeline pass. `textProcessor.ts`.
- **`tokenizeWords` shreds decimals.** `"3.14"` → `["3", ".", "14"]`.
- **`deserializeFrame` cannot parse `serializeFrame`'s output.** Joins on `' | '` and splits on bare `'|'`. Dead code that would break if used.
- **Three divergent tokenizers** (`textProcessor.ts`, `extractEn.ts`, `enToDv.ts`). The Breakdown dictionary panel can show a different word list than the frame was built from.
- **Suffix tables contradict each other.** `kamah` is `{case: 'indefinite', english: 'some'}` in `NOUN_SUFFIXES` and `'to'` in `STEM_SUFFIXES`. The test locks the contradiction in.
- **`parseSuffix` and `stemWord` disagree on a legal stem.** `parseSuffix('age')` yields root `"a"`.
- **Spelling variants are never composed.** A word containing both `gh` and `q` never reaches the fully normalised form.
- **Lossy closed-class round trips.** `work → kurun` but `kurun → do`; `see`/`look → belun` but `belun → look`; `stay → huri` but `huri → was`.
- **Unreachable code** in `VERB_SUFFIXES.un`, `extractDv` `'ga'`, `thaanaToLatin` `'އ'`, `forms.delete(base)`.
- **Ten dead exports** hidden by `export *` barrels.
- **Feedback CSV:** blob URL revoked immediately after `a.click()` (breaks Firefox/Safari); `correction` is not sanitised against spreadsheet formula injection.
- **Chat LLM adapter** crashes on stored `apiUrl: null` and has no `AbortController`, so a hung call leaves Chat busy forever.
- **Dark-mode toggle** never reads `prefers-color-scheme` and never persists.
- **`latinToThaana` is still not a full inverse** of `transliterateThaana` for prenasalised stops. Silent deletion is fixed; prenasalisation round-trips remain a gap.
- **No component tests.** Vitest runs in `environment: 'node'` with no DOM.
- **Lexicon leftovers** (human work): Radheef “a kind of plant/fish” glosses, placeholder frequencies, 315 mirror ties, 26 quarantined rows, 179 `unknown` POS. Verb and location slots were not widened — that needs Fritz-attested inflection tables.
