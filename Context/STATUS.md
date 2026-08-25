# Status

Measured state of **latin-mv-tlt**, not a diary. Data numbers: [DATA.md](DATA.md). How to train: [TRAINING.md](TRAINING.md).

## Now

- `npx tsc -b` — clean.
- `npm test` — **81 passing** across 11 files.
- `npm run build` — succeeds.
- Translator, Breakdown, Chat, Feedback, Benchmarks, and About are in the app.
- Thaana at the user edge (Faruma 16px, Male Latin IME on Dhivehi input). Latin in the NLP core.
- Shipped lexicon: **15,302** Latin entries, no `dhivehi` column.
- Realization corpus: **16,141** English pairs, **14,270** Dhivehi Latin pairs.
- **No T5 checkpoint.** Fluent output stays Unavailable. BLEU, chrF, and human ratings are unmeasured; the Benchmarks page says so.

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
