# Status

Measured state of **latin-mv-tlt**, not a diary. Data numbers: [DATA.md](DATA.md). How to train: [TRAINING.md](TRAINING.md).

## Now

**v0.2 migration: application code complete, model not yet trained.**

- `npx tsc -b` — clean. `npm test` — **103 passing across 12 files**. `npm run build` — succeeds.
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

Each item is reproducible and was deliberately left. Full design context:
[`docs/DESIGN.md` §13](../docs/DESIGN.md).

- **No checkpoint**, so BLEU / chrF++ / human ratings stay unmeasured. Needs a GPU
  (M-3, M-4).
- **`public/models/{en,dv}-realize` (307 MB)** still on disk. M-8b is gated on the
  v0.2 model being verified in a browser, which needs the checkpoint first.
- **The three-level honorific paradigm is an unwired stub.** Fritz Vol. II attests
  only 8 mostly dialectal HON tokens; the written-narrative `eve` register, which
  *is* attested, is implemented. A limit of the sources, not of the code.
- **Four closed-class entries removed, not replaced** (`work`, `stay`, `never`,
  `exist`). They fall through to the bilingual dictionary. Correct replacements
  need a native speaker.
- **Lexicon leftovers** (human work): Radheef “a kind of plant/fish” glosses,
  placeholder frequencies, 315 mirror ties, 26 quarantined rows, 179 `unknown` POS.
  Verb and location slots were not widened — that needs Fritz-attested inflection
  tables.
- **`sharp` advisory** (GHSA-f88m-g3jw-g9cj, no fix) reaches the lockfile through
  `@huggingface/transformers`. Node-only optional dependency; not in the browser
  bundle.

## Closed

Each of these was in the Open list and now has a regression test. `npm test` is
**103 passing across 12 files**; `npx tsc -b` and `npm run build` are clean.

- `segmentSentences` junk fragments, decimals (`3.14 is pi.`) and abbreviations
  (`Dr. Smith went.`) — five boundary rules now, all tested.
- `tokenizeWords` shredding decimals; `extractWordsOnly` dropping contractions.
- Divergent tokenizers — one tokenizer serves both pipeline directions.
- `kamah` glossed `some` in `NOUN_SUFFIXES` and `to` in `STEM_SUFFIXES`.
- Spelling variants never composing (`ghaqee` never reached `gagee`).
- `latinToThaana` not a full inverse for prenasalised stops — the *forward* rule
  was dropping the stop's own diacritic into the Latin as a raw `U+07B0`.
- Lossy closed-class round trips — four wrong entries removed, the legitimate
  many-to-one collapses declared and enforced by `closedClass.test.ts`.
- Feedback CSV: blob URL revoked before the download started; formula injection.
- Chat LLM adapter: crash on stored `apiUrl: null`; no `AbortController`.
- Dark-mode toggle ignoring `prefers-color-scheme` and never persisting.
- No component tests — jsdom opt-in per file; `TraceView` and `Translator` suites.
- Faruma `@font-face` hardcoding `/latin-mv-tlt/` instead of deriving from `base`.
- Dead code: `forms.delete(base)`, the unreachable `thaanaToLatin` `'އ'` branch,
  `parseWordList`, and the v0.1 frame-slot sets `LOCATION_LATIN` / `SUBJECT_LATIN` /
  `PARTICLE_LATIN`.
- `Context/PROJECT.md` still describing the v0.1 frame architecture.

Three items previously listed as open no longer exist in the code at all —
`deserializeFrame`, the `extractDv` `'ga'` branch, and `parseSuffix('age')`
yielding root `"a"`. The first two went with `src/core/frames/`; the third is
already guarded by `minStemFor`.
