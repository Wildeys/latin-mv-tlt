This is an **exceptionally good** requirements specification. It is rigorous, honest about limitations, and makes the correct architectural call. Most project specs at this level are vague; yours is traceable, measurable, and defensible for a viva.

Here is my review: what is strongest, what needs a small fix, and what is missing.

---

## What is outstanding (do not change these)

**R-1.5: The loanword policy.** This is the single most important requirement in the entire document. Keeping `instagraam` instead of `Instagram` for training data is exactly right, and your justification ("consistency at training time takes precedence over prettiness") is the kind of reasoning that will impress an examiner.

**R-2.2: Same transliterator for training and inference.** Many low-resource MT projects fail because they normalize training data with one tool and inference data with another. Making this a hard requirement prevents the most common silent failure mode.

**R-2.6: Domain-based splits instead of random.** For a news-heavy corpus of ~92K pairs, random splitting will give you an inflated BLEU score because the model memorizes journalistic phrasing. Splitting by source/domain is the correct way to measure generalisation.

**R-3.13: Shipping only the ONNX graphs that are actually loaded.** Your analysis that ~150 MB of the 307 MB is dead weight is sharp. This is a real engineering win, not just a cleanup task.

**R-8.4: chrF++ is required, not optional.** For a suffix-heavy language like Dhivehi, BLEU alone is misleading. Requiring chrF++ shows you understand the evaluation literature.

**R-8.6: Spellability spot-check.** This is a genuinely original requirement that shows domain awareness. A model can score a decent BLEU while generating impossible Dhivehi consonant clusters. Checking for spellability is a sanity filter that most Dhivehi MT projects skip.

**Appendix A:** Preserving the frame architecture as "superseded, not erased" is excellent academic practice. It lets you argue the trade-off honestly rather than pretending v0.1 never happened.

---

## Issues that need fixing before you proceed

### 1. NLLB-200-distilled-600M will almost certainly break your size budget
**R-3.3** says NLLB shall be evaluated as an alternative, with adoption requiring either meeting R-3.4 (≤80 MB) or an explicit decision to raise the budget.

The problem: `facebook/nllb-200-distilled-600M` has 600M parameters. Even with INT8 quantization and only the merged decoder + encoder, you are looking at roughly **120–150 MB minimum**. That is before the tokenizer and config files. It is very unlikely to fit in 80 MB.

**Fix:** Add a note in R-3.3 that NLLB evaluation should include a *preliminary size estimate* before any training begins. If the exported ONNX exceeds 80 MB, the decision to adopt it must explicitly acknowledge that NFR-13 and AC-10 are forfeited. Do not let it become a "we will figure out quantization later" trap.

### 2. Learning rate 3e-4 may be too aggressive for T5-small
**R-9.2** specifies LR ~3e-4. For T5-small fine-tuned on translation with ~90K pairs, this is on the high end. The original T5 paper used 1e-4 for most tasks. Your own v0.1 realization notebook used 5e-5.

With only 90K examples, 3e-4 risks catastrophic forgetting of pre-trained English fluency or unstable validation loss. With 200K+ pairs it would be safer.

**Fix:** Change the recommendation to **1e-4**, with 3e-4 as an optional ablation if 1e-4 underfits. Or specify: "Start at 1e-4; raise to 3e-4 only if validation loss plateaus in the first two epochs."

### 3. The ~92K corpus is treated as sufficient, but it should be a Stage 1 baseline
The spec correctly identifies in §6 Constraint 4 that coverage is corpus-limited, but the data requirements table in §5 lists the parallel corpus as "Planned / Must" without a quantity target.

**Fix:** Add a requirement (perhaps R-2.1b) stating:
> "Stage 1 shall use the available ~90K real parallel pairs as a baseline. Stage 2 shall target ≥200K total pairs through back-translation or domain-specific mining, with the augmentation strategy recorded."

This makes it explicit that 92K is a starting point, not the final corpus.

### 4. Round-trip accuracy (R-1.8) needs a metric definition
You require measuring "Thaana → Latin → Thaana over a held-out sample, reported as a percentage." But percentage of what?

**Fix:** Specify the metric:
> "Round-trip accuracy shall be measured as **exact string match percentage** on a held-out sample of ≥1,000 Thaana words or sentences. Character-level Levenshtein distance may be reported as a secondary metric."

For a rule-based system, exact match is the correct strict standard. If it is below 98%, your transliterator rules have bugs that will poison the training data.

### 5. The gold evaluation set is probably too small
`evaluation/gold_sentences.json` is currently 3.5 KB. That is likely 20–40 sentences. For R-8.7 and R-8.8, you need enough held-out data to be statistically meaningful.

**Fix:** Add a requirement:
> "The held-out test set shall contain ≥500 sentence pairs per direction, drawn from a domain or source not represented in training. The gold set shall be manually verified for alignment quality before use."

500 is the minimum where BLEU differences start to become somewhat reliable.

---

## Missing requirements that would strengthen the spec

### 6. No back-translation strategy
You identified in our earlier conversation that back-translation is the best way to grow from 90K to 200K+. The spec never mentions it.

**Suggested addition (R-2.9):**
> "Planned — A back-translation pipeline shall augment the corpus using a larger pre-trained model (e.g., NLLB-200 or Madlad-400) on monolingual Dhivehi and English text. Synthetic pairs shall be labelled with provenance and filtered for length-ratio quality before inclusion."

### 7. No requirement for tokenizer behavior verification
T5-small uses SentencePiece. Because Dhivehi Latin is ASCII, T5 will subword it using English-like splits. This is generally fine, but long Latin words like `bihloorigandu` might be split unpredictably.

**Suggested addition (R-9.6):**
> "Before training, the tokenizer shall be profiled on a sample of 1,000 Latin words to verify that unknown tokens are subworded rather than mapped to `<unk>`. Any token with >5% `<unk>` rate shall trigger a vocabulary review."

For ASCII Latin, this should pass easily, but it is worth checking.

### 8. No runtime confidence / quality indicator
When the model generates output, the user has no way to know if it is high-confidence or gibberish.

**Suggested addition (R-6.11, Could):**
> "The UI may display a low-confidence warning when the model output contains tokens not seen in training, or when the output length is an extreme outlier relative to input."

### 9. Sentence segmentation for Dhivehi is unspecified
**R-5.1** says "segmented into sentences" but Dhivehi punctuation conventions differ from English.

**Suggested addition:**
> "Sentence segmentation shall treat Latin full stops, Dhivehi punctuation (e.g., `۔`), and line breaks as sentence boundaries. Segmentation shall be deterministic and script-aware."

---

## Minor corrections and nitpicks

| Location | Issue | Suggestion |
|---|---|---|
| R-3.2 | "~60 MB" for T5-small q8 | T5-small encoder (~35MB) + merged decoder (~42MB) + tokenizer (~2.4MB) ≈ **80MB**, not 60MB. Your budget is tight. Consider updating the estimate or the budget. |
| R-2.4 | "extreme source/target length ratios" | Specify a starting threshold, e.g., "ratios outside [0.4, 2.5] shall be flagged, with the final threshold recorded after corpus analysis." |
| R-9.2 | "batch 32" | For a T4 GPU with T5-small and sequence length 128, batch 32 in fp16 should fit. But if you move to `flan-t5-base` (250M params), it will not. Add: "Batch size assumes T5-small; flan-t5-base shall use batch 8–16." |
| GAP-6 | Missing `Context/` folder | You reference `Context/PROJECT.md` etc. in the README, but the folder is absent. Either restore the files or update the README links. |
| README | Windows path hardcoded | `C:\Users\Moham\Desktop\...` should be removed or made generic before submission. |

---

## My verdict

**Yes, proceed with this spec.** It is one of the most thoughtful low-resource MT requirement documents I have seen. The architecture is correct, the constraints are realistic, and the traceability is viva-ready.

The three things I would fix before writing any code are:

1. **Lower the learning rate to 1e-4** (R-9.2).
2. **Add a corpus size target for Stage 2** (augmentation to 200K+).
3. **Clarify that NLLB probably breaks the 80 MB budget** unless you are willing to raise it.

Everything else is either correct or a "could" priority that will not block your migration.

If you want, I can now generate the corpus builder script (M-1 in your migration plan) that downloads the Hugging Face datasets, runs them through your transliterator, deduplicates, domain-splits, and emits the exact `train.jsonl` / `valid.jsonl` format your spec requires.
