# Data

How [`public/data/dictionary.json`](../public/data/dictionary.json) and [`data/realize/`](../data/realize/) were built. Numbers were printed by the scripts, not estimated.

Pipeline: merge sources → repair the lexicon → generate frame → sentence pairs. The T5 files stay **frame → sentence**. They are not a parallel corpus dump.

Architecture: [PROJECT.md](PROJECT.md). Training: [TRAINING.md](TRAINING.md).

## Sources

The browser lexicon started as the SQLite export (**15,984** unique Latin keys). [`Database_sources/dictionary_latin.json`](../../Database_sources/dictionary_latin.json) looks like a cleaner bilingual file. It is not a drop-in: it is the first ~10,000 Radheef headwords in alphabetical order and **stops at ފ**. Fourteen Thaana letters are absent. Replacing the JSON with that file would delete most of the lexicon. The two sources are complementary, so they are unioned on lowercased Latin.

Fritz Vol. II is **not** a dictionary. The notes in [`Database_sources/fritz_vol2/`](../../Database_sources/fritz_vol2/) are working notes on attested morphology. T8–T18 must not be bulk-copied (copyright; see that folder’s overview).

| Path | Role |
|---|---|
| `public/data/dictionary.json` | Base. Every existing Latin key is kept through the merge. |
| `Database_sources/dictionary_latin.json` | Add missing lemmas; **union** English glosses; fill weak POS. |
| `Database_sources/full curreny database.json` | Prefer verified Thaana and normalised POS. Do not overwrite a better English list. |
| `Database_sources/spelling.md` | Frequency only. Does **not** add tens of thousands of English-less rows. |
| `tools/fritz_closed_class.json` | Pronouns, particles, locations, tense forms Fritz attests and the bilingual dump often misses. |
| `Database_sources/fritz_vol2/*.md` | Inflection **templates** for training (`-gai`, `-ah`, `nu` + verb, `-anan`/`-aane`, `-fi`/`-jje`). |
| `tools/english_seed.txt` | Hand English lines kept as gold-ish seed. |
| `tools/parallel_seed.txt` | Short `latin \| english` lines, including Fritz-shaped patterns. No full T8 texts. |

**Not used** as lexicon or training rows: `corpus_latin.json` (unaligned documents), `new_bigram_latin.json` (collocations), `dhivehi-latin-slm/data/ape/` (old `grammar:` degrader pairs — different task).

## Merge

[`tools/improve_dictionary.py`](../tools/improve_dictionary.py) unions sources. **0** Latin keys dropped. **30** keys added (Fritz closed class + training lemmas such as `nu`, `eve`, `gai`). **17** English lists unioned. The same closed-class items are hardcoded in [`src/core/dictionary/closedClass.ts`](../src/core/dictionary/closedClass.ts).

`frequency` is a **placeholder for most rows**: 11,091 sat at exactly 50 and 4,361 at exactly 1 (the latter hardcoded in the merge script). Rows with a real count carry `freqSource: "spelling.md"`; absence of the field means placeholder. The lookup tiebreaker still works, but this is not a corpus frequency and must not be described as one.

The merge inherited inverted and unreachable keys from the original SQLite export. Both bilingual source files are correctly DV-oriented; fixing ingestion would not have helped. [`tools/clean_dictionary.py`](../tools/clean_dictionary.py) runs afterwards.

## Repair

Structurally the file was spotless: no missing field, no null, no duplicate Latin key. The damage was semantic.

Malé Latin does not use `w` or `x`, and uses `c` only in the digraph `ch`. It **does** use `q` (`naquluvun`, `baithulmaqdhis`), so `q` is not a signal.

| Mode | Count | Example | Repair |
|---|---|---|---|
| Inverted | 585 | `latin: "Alexander laurelwood tree"` → `english: ["funagas"]` | swap the columns |
| Corrupt | 26 | `latin: "crush"` → `english: ["island"]` | quarantined, not guessed |
| Malformed key | 1,656 | `latin: "firi (firimeehaa)"` | split into reachable keys |

Splitting recovered **1,562 lookup keys** that previously matched nothing. A second **mirror** rule catches stubs where the lexicon already holds the reverse row (`aharen: ["I"]` vs `i: ["aharen"]`); frequency from the Dhivehi side decides direction. **403** stubs repaired, **315** ties reported for a human. Losers keep their key, so no lookup breaks.

Also: glosses like `"lovely/ cute"` now index as `lovely` and `cute`; 13 closed-class POS corrections (`aharen` was tagged `noun`); contaminated gloss `male: ["firihen", "Malé"]` is now `["Male"]`.

The `dhivehi` column no longer ships. **11,269 of 16,014 values (70.4%)** were byte-identical to `latinToThaana(latin)`, so the column was a deterministic function of a field already present. Dropping it cut the file from 2,111,356 to **1,491,467 bytes**. The full copy is kept build-side in `data/dictionary_full.json`. `data/quarantine.json` may keep original Thaana; it is not served to the browser.

Shipped lexicon: **15,302** entries.

`clean_dictionary.py` refuses to write if any pre-existing Latin key would vanish without a recorded rewrite. Edits land in `tools/cleanup_report.json`.

## Realization corpus

[`tools/build_frame_pairs.py`](../tools/build_frame_pairs.py) writes `{input, target, direction}` JSONL — a frame string to a sentence — not raw bilingual lines.

| | Count |
|---|---|
| English pairs | **16,141** (14,526 train / 1,615 valid) |
| Dhivehi Latin pairs | **14,270** (12,843 train / 1,427 valid) |
| Inputs with conflicting targets | **0** |
| Train/valid input leakage | **0** |
| Targets contradicting their own slots | **0** |
| Capitalised Dhivehi tokens | **0** |
| Non-ASCII in targets | **none** |

The split groups by frame string, so leakage is impossible by construction. Slot values are plain ASCII (`Male`, not `Malé`).

English pairs: `english_seed.txt` + combinatorial SVO from the same slots. Dhivehi pairs: `parallel_seed.txt` plus Fritz-attested SOV templates (`nu` + verb, `-gai`, `-ah`, `-anan`, `-fi` / `-jje`).

Dative `-ah` is obligatory on a goal. Locations that used to emit a bare stem (`Male`, `addu`, `hulhumale`) now emit `maleah`, `adduah`, `hulhumaleah`. Stative locations use `-gai`. Motion vs location in the seed is corrected the same way.

`REGISTER=written` / `REGISTER=spoken` is a frame slot. Written rows end in `eve`; nothing else does. `extractDv` sets `written` when it consumes `eve`, so the app emits frame strings the model actually saw.

```text
SUBJECT=aharen | ACTION=dhaa | LOCATION=male | TENSE=future | POLARITY=affirmative | REGISTER=spoken
        →  aharen maleah dhaanan
```

### Slot vocabulary

A model trained on ~40 content words memorises those words; it does not generalise to a 15,302-entry lexicon. Objects and times were widened where it is safe (objects appear bare; every lemma is in the cleaned lexicon). Verbs and locations were **not**: both need inflected forms, and neither the lexicon nor `fritz_closed_class.json` carries a paradigm. Fritz gives masdars, not tense tables. Inventing them would reintroduce the case-marking defect.

| Slot | Count | Notes |
|---|---|---|
| subjects | 7 | added `meehaa` |
| verbs | 16 | not widened |
| objects | 12 | added sai, kaaru, beys, bas, magu, gadi |
| locations | 5 | not widened |
| times | 7 | added mirey, haveeru |

### Gold set

[`evaluation/gold_sentences.json`](../evaluation/gold_sentences.json) is **20 pairs per direction**, not mirrors of each other. [`evaluation/en_frames.python.json`](../evaluation/en_frames.python.json) holds the Python extractor’s frames; [`src/core/frames/crosscheck.test.ts`](../src/core/frames/crosscheck.test.ts) asserts the TypeScript extractor agrees. BLEU and chrF stay unmeasured until a checkpoint exists.

## Re-run

```powershell
$env:PYTHONIOENCODING = "utf-8"
python tools\improve_dictionary.py
python tools\clean_dictionary.py
python tools\build_frame_pairs.py
npm test
```

Expected clean-dictionary output:

```text
input rows              16014
shipped entries         15302
inverted rows flipped   585
mirror glosses repaired 403
mirror ties (review)    315
rows quarantined        26
malformed keys split    1656
new lookup keys         1562
POS corrected           13
shipped bytes           1491467
```

Then assert over both realize directions: zero conflicting targets, zero train/valid leakage, zero slot mismatches, every Dhivehi location target carrying `-ah` or `-gai`, no capitalised Dhivehi tokens, no non-ASCII, and `eve` only on `REGISTER=written` rows. Counts: `data/realize/stats.json`. Failures: `data/realize/rejected.jsonl`.

## Still wrong, known

- The English glosses are Radheef definitions, not translation glosses. 289 entries gloss as `"a kind of plant"` and 254 as `"a kind of fish"`. That is the ceiling on EN → DV quality. Fixing it is lexicography, not scripting.
- Placeholder `frequency` on most rows (see Merge).
- **315** mirror ties and **67** further suspects in `tools/cleanup_report.json` / `tools/inversion_candidates.json` need a human. `firihen` vs `male` is a genuine ambiguity (person vs city).
- **26** quarantined rows sit in `data/quarantine.json`, verbatim.
- **179** rows still have POS `unknown`.
