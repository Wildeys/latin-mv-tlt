Here is a practical roadmap to get your Dhivehi Latin ↔ English translator working in the browser, along with the most likely reasons your first T5 attempt failed and how to fix them.

---

## 1. Why Your Pipeline Likely Failed

Based on common failure patterns with low-resource language T5 fine-tuning, here are the probable culprits:

### Data Format Issues
T5 is a **text-to-text** model. It expects a strict prefix format:
```
"translate Dhivehi Latin to English: <sentence>"
```
If your dataset was not consistently prefixed, or if you mixed directions (Latin→English and English→Latin) without clear task prefixes, the model receives contradictory signals and learns nothing.

### Script Inconsistency
Dhivehi Latin has no single official romanization standard. If your training data mixed different spelling conventions (e.g., "th" vs "t", "ng" vs "n"), the model sees those as completely different words. This is the #1 silent killer for Dhivehi Latin models.

### Train/Test Leakage or Poor Split
If you randomly split sentence pairs without ensuring different topics/domains were separated, your model may have memorized phrases rather than learned to generalize.

### No Validation Metric
Without BLEU or chrF++ tracking during training, you cannot tell whether the model is actually improving or just overfitting.

---

## 2. A Better Data Pipeline

Good news: there are now usable Dhivehi datasets on Hugging Face.

| Dataset | What It Contains | How to Use It |
|---|---|---|
| `alakxender/dhivehi-english-translations` | ~92K sentence pairs (Thaana ↔ English) from news | Core parallel corpus |
| `alakxender/dhivehi-transliteration-pairs` | ~188K Thaana ↔ Latin transliteration pairs | Convert your Thaana data to consistent Latin |
| `alakxender/dhivehi-english-parallel` | Cleaned parallel corpus (Thaana ↔ English) | Additional training data |

### Recommended Pipeline

**Step A: Normalize your Latin script**
Before anything else, decide on **one** romanization convention and stick to it. Use the transliteration dataset to build a deterministic Thaana→Latin converter. Do not rely on multiple romanization styles in training data.

**Step B: Create a unified parallel Latin-English dataset**
```
Thaana-English dataset  →  Thaana text
                                  ↓
                           [Your converter]
                                  ↓
Latin-English parallel dataset
```
This ensures your Latin spellings are 100% consistent.

**Step C: Prefix correctly**
Your CSV/JSON should look like this:
```json
{"prefix": "translate Dhivehi Latin to English", "input_text": "Bihloorigandu thalhaalumugai...", "target_text": "The suspects in the embezzlement case have been released"}
{"prefix": "translate English to Dhivehi Latin", "input_text": "The suspects have been released", "target_text": "Bihloorigandu thalhaalumugai..."}
```

**Step D: Deduplicate and filter**
Remove exact duplicates and near-duplicates. Filter out pairs where the length ratio is extreme (e.g., 5 English words vs 50 Latin words), as those are usually alignment errors.

---

## 3. Model Choice for Browser Deployment

Running in a browser means you need a **small, quantized** model. T5-small is actually a reasonable choice, but there are alternatives.

### Option A: T5-small (your current path)
- Size: ~60MB quantized (INT8)
- Pros: Well-supported by Transformers.js, handles text-to-text naturally
- Cons: Can be brittle with low-resource languages if data is noisy

### Option B: OPUS-MT style models (Marian NMT)
Pre-trained translation models that can be fine-tuned and converted to ONNX. They are often better than T5 for pure translation tasks because they are architecturally specialized.

### Option C: mBART-50 or NLLB-200 (Distilled)
- NLLB-200 is explicitly designed for low-resource languages
- The distilled versions can be quantized to ~100MB and run in browser via Transformers.js
- There are already browser demos running NLLB entirely client-side <source-chip title="alexop.dev" url="https://alexop.dev/posts/building-client-side-ai-translator-vue/" />

For Dhivehi specifically, **NLLB-200 actually includes Dhivehi (Thaana)** in its training data. If you fine-tune a distilled NLLB model on your Latin-specific corpus, you may get better results than T5 because it already has some understanding of Dhivehi grammar.

---

## 4. Browser Deployment Architecture

The modern standard for this is **ONNX Runtime Web** or **Transformers.js** with quantized models.

### Recommended Stack
1. **Train in Python**: Fine-tune T5-small, Marian, or NLLB-distilled using Hugging Face
2. **Export to ONNX**: Use `optimum-cli` to convert to ONNX, then quantize to INT8
3. **Run in browser**: Use `@huggingface/transformers` (Transformers.js) or `onnxruntime-web`

### Why This Works
Projects like `multilingual-translator-offline` already prove this works: they run ONNX-quantized OPUS-MT models entirely in the browser, cached in IndexedDB, with no server after the first load. <source-chip title="GitHub - harisnae/multilingual-translator-offline" url="https://github.com/harisnae/multilingual-translator-offline" />

### Size Budget
For a "light" browser model, aim for:
- **Under 80MB total** (INT8 quantized)
- **Sequence length 128** (enough for most sentences)
- **Beam size 1 or 2** at inference (greedy decoding is faster and often sufficient for short sentences)

---

## 5. Training Configuration That Actually Works

Here is a conservative, proven config for low-resource translation fine-tuning:

```python
from transformers import Seq2SeqTrainingArguments

training_args = Seq2SeqTrainingArguments(
    output_dir="dhivehi-latin-translator",
    eval_strategy="epoch",
    learning_rate=3e-4,           # slightly higher for small data
    per_device_train_batch_size=32,
    per_device_eval_batch_size=32,
    weight_decay=0.01,
    save_total_limit=2,
    num_train_epochs=5,           # more epochs for small corpora
    predict_with_generate=True,
    fp16=True,
    generation_max_length=128,
    load_best_model_at_end=True,  # crucial: prevents overfitting
    metric_for_best_model="bleu"
)
```

Key differences from generic tutorials:
- Higher learning rate (low-resource models need stronger updates)
- More epochs with early stopping
- Larger batch size if possible (small data benefits from stable gradients)

---

## 6. Validation Strategy for Dhivehi Latin

Because Dhivehi is low-resource, random 80/20 split is dangerous. Instead:

1. **Split by domain/source**: If you have news data and social media data, put entire sources into train vs test. This tells you if the model generalizes.
2. **Use chrF++ in addition to BLEU**: BLEU is tokenization-sensitive. chrF++ (character n-gram F-score) is often more reliable for languages with agglutinative morphology like Dhivehi.
3. **Manual spot-check**: For 50 random test sentences, manually verify if the Latin output is even spellable in Dhivehi. A model that generates impossible consonant clusters is failing.

---

## 7. Practical Next Steps

If I were rebuilding your project from scratch today, I would do this:

1. **Download** `alakxender/dhivehi-english-translations` and `alakxender/dhivehi-transliteration-pairs`
2. **Build a Thaana→Latin converter** using the transliteration dataset to ensure consistent romanization
3. **Convert the Thaana-English corpus to Latin-English**
4. **Fine-tune `facebook/nllb-200-distilled-600M`** or `t5-small` with proper prefixes
5. **Export to ONNX INT8** using Optimum
6. **Build a minimal web UI** with Transformers.js loading the quantized model into IndexedDB

The transliteration dataset is particularly valuable for your use case because it gives you ~188K examples of how Thaana maps to Latin, which you can use to normalize whatever parallel data you collect. <source-chip title="Hugging Face - Dhivehi Transliteration Pairs" url="https://huggingface.co/datasets/alakxender/dhivehi-transliteration-pairs" />

---

## 8. About the Japanese Comparison

Your observation about Japanese particles and Dhivehi suffixes is linguistically sharp. For model design, this means:

- Both languages are **morphologically rich at the end of nouns**
- A subword tokenizer like SentencePiece (used by T5 and NLLB) will naturally capture particle/suffix boundaries if your training data is large enough
- However, Dhivehi Latin uses ASCII spaces between words, which actually makes it *easier* to tokenize than Japanese (no word segmentation ambiguity)

So training on Dhivehi Latin rather than Thaana may actually be an advantage for small models, because the tokenizer does not need to learn Thaana Unicode ranges or complex word segmentation.

---

You have built something genuinely clever, but you are currently maintaining **two different architectures at once**, and one of them is a dead end for general translation. Here is what to keep, what to kill, and why.

---

## 1. What you should drop

### Drop the semantic frame + realization pipeline
Your `en-realize` and `dv-realize` T5 models are trained on synthetic data built from a curated slot vocabulary of about **sixty content words** (7 subjects, 16 verbs, 12 objects, etc.). That means your translator currently only works for sentences that fit those pre-defined slots. It is essentially a controlled-language demo, not an open translator.

For a practical browser-based tool, this pipeline is over-engineered and under-powered. It cannot handle real-world sentences like *"The parliament passed the amendment yesterday"* unless every noun, verb, and modifier happens to be in your slot list.

**What to remove:**
- `src/core/frames/extract.ts` and the frame extractor logic
- `public/models/en-realize` and `public/models/dv-realize` (the ONNX weights)
- `colab_train_realize.ipynb` (the frame→sentence training notebook)
- The `data/realize/` JSONL files

**What to replace it with:** A single, direct **Latin ↔ English** seq2seq model (T5-small or NLLB-distilled). One model does the job of your entire frame+realize stack.

---

## 2. Do NOT drop the rule-based Thaana ↔ Latin transliterator

**You do not need a neural model for Thaana→Latin.** Your instinct is correct: a rule-based system is superior here.

Why:
- Dhivehi romanization is almost entirely deterministic. A neural model would be slower, larger, and less reliable for a task that is essentially letter-to-letter mapping.
- Your rule-based system runs instantly in the browser with zero model download.
- The only edge cases are loanwords, which are better handled with a small exception dictionary than with a 40MB ONNX model.

**Keep:** `src/core/transliterator/` (or wherever your Thaana→Latin rules live). It is one of the best parts of your stack.

---

## 3. The loanword problem is not a problem

You mentioned that *Instagram* is written as `Instagram` in Thaana, but your rule-based Latin outputs `instagraam`. You worry this is wrong. It is not. It is actually **exactly what you want** for training data consistency.

Here is why:
- Your rule-based Latin is a **single, consistent phonetic representation**.
- If you convert your entire training corpus (Thaana → Latin) using this same rule set, then `އިންސްޓަގްރާމް` always becomes `instagraam` in your Latin training data.
- The neural model will learn that `instagraam` (Dhivehi Latin) maps to `Instagram` (English). That is a clean, learnable mapping.

**Do not** try to make your transliterator output "standard" English spellings for loanwords. That introduces inconsistency. A deterministic phonetic romanization is a feature, not a bug.

If you want to display prettier Latin to users, you can add a small post-processing loanword dictionary for the UI layer, but train the model on the raw phonetic output.

---

## 4. The architecture you should have

This is the minimal, correct pipeline for a browser-based Dhivehi↔English translator:

```
Thaana input
    ↓
[Rule-based transliterator]  ← Keep this
    ↓
Latin intermediate
    ↓
[T5-small ONNX q8]            ← One model, direct Latin↔English
    ↓
English output
```

And reverse:

```
English input
    ↓
[T5-small ONNX q8]
    ↓
Latin intermediate
    ↓
[Rule-based reverse transliterator]  ← Keep this
    ↓
Thaana output
```

**Why this wins:**
- **One neural model** instead of two realization models + a frame extractor.
- **Smaller bundle size**: One T5-small q8 model is ~60MB. Your current two realization models are already ~80MB+ combined and cover far less vocabulary.
- **Actually generalizes**: Trained on real parallel sentences, not 60 synthetic slots.

---

## 5. How to fix your data pipeline (the real reason T5 failed before)

You said your previous T5 attempt failed because of poor database setup. The solution is to use existing Dhivehi-English parallel corpora and normalize them to **your** Latin.

### Step A: Get the data
Use the Hugging Face datasets that already exist:
- `alakxender/dhivehi-english-translations` (~92K sentence pairs, news)
- `alakxender/dhivehi-english-parallel` (cleaned parallel corpus)

### Step B: Convert Thaana → Your Latin
Use your existing rule-based transliterator to convert all Thaana in these datasets to your consistent Latin representation. Now you have ~92K Latin-English parallel pairs where the Latin is 100% consistent.

### Step C: Format for T5
```json
{"prefix": "translate Dhivehi Latin to English", "input_text": "aharen maleah dhaanan", "target_text": "I will go to Male"}
{"prefix": "translate English to Dhivehi Latin", "input_text": "I will go to Male", "target_text": "aharen maleah dhaanan"}
```

### Step D: Train and export
Fine-tune `t5-small` (or `google/flan-t5-small`) for ~3-5 epochs. Export to ONNX with q8 quantization. Drop the single `.onnx` file into `public/models/`.

This is exactly what other Dhivehi MT projects are doing. Models like `Xeolex/nllb-dhivehi-english-cleaned-best` are already trained on `div_Latn` ↔ `eng_Latn`. <source-chip title="Hugging Face - NLLB Dhivehi-English" url="https://huggingface.co/Xeolex/nllb-dhivehi-english-cleaned-best" />

---

## 6. What to absolutely keep from your current repo

| Component | Verdict | Why |
|---|---|---|
| Rule-based Thaana↔Latin | **Keep** | Fast, correct, zero-dependency |
| Dictionary lookup (`lookup.ts`) | **Keep** | Powers your Breakdown screen and word-level glosses. Even with a neural translator, users love seeing word-by-word analysis. |
| React UI + GitHub Pages setup | **Keep** | Deployment works. |
| Honorifics / register detection | **Keep** | Nice differentiator for Dhivehi. Can tag output. |
| Frame extractor + realize models | **Drop** | Controlled vocabulary dead end. |

---

## 7. Summary

1. **Drop** the semantic frame system and both realization models. They are a research curiosity, not a product.
2. **Keep** the rule-based transliterator. Do not train a neural model for Thaana→Latin.
3. **Use** your transliterator to normalize existing Thaana-English parallel corpora into your Latin system.
4. **Train one direct T5-small** on Latin↔English sentence pairs.
5. **Export to a single ONNX q8 model** and load it with `@xenova/transformers` in the browser.

Your transliterator is not the problem. It is the solution. The frame-based pipeline is what is holding you back.

If you want, I can write you a Python script that downloads the Hugging Face Dhivehi-English datasets, runs them through your Latin conversion rules, and outputs clean T5 training data in the correct prefix format.