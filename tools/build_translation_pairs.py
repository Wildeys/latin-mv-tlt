#!/usr/bin/env python3
"""Build the v0.2 parallel corpus (M-1, R-2.1 .. R-2.8).

Replaces tools/build_frame_pairs.py. That script generated sentences
combinatorially from a ~60-word slot vocabulary; this one normalises *real*
parallel text, which is the whole point of the v0.2 architecture change.

    python tools/build_translation_pairs.py
    python tools/build_translation_pairs.py --limit 5000     # quick trial run

Outputs, following tools/clean_dictionary.py's three-file convention:

    data/parallel/train.jsonl        {input, target, direction, provenance}
    data/parallel/valid.jsonl
    data/parallel/test.jsonl
    data/parallel/quarantine.jsonl   rejected rows, kept not deleted (R-2.8)
    data/parallel/corpus_stats.json  every counter, committed

The JSONL is gitignored; the stats file is committed, so the numbers behind any
published result stay checkable.

Three things here are load-bearing and easy to get wrong:

1. **Thaana is romanised only through tools/transliterate.mjs**, which wraps the
   app's own transliterator (R-2.2). A Python reimplementation would drift, and
   the drift would be invisible until BLEU came back low.

2. **Splits are by source document, not by row** (R-2.6). Slicing a shuffled row
   list lets two sentences from the same article land on both sides of the cut,
   and the model then scores well by having memorised the article's phrasing.
   build_frame_pairs.py learned this the hard way — its docstring records 21
   inputs that straddled the cut — so the grouping discipline carries over with
   the key changed from frame string to document id.

3. **The script refuses to write** if an invariant breaks, rather than emitting a
   corpus that looks fine. Same posture as clean_dictionary.py.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _transliterate_bridge import Transliterator, load_prefixes  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "parallel"

# R-2.1. The first is the ~92k news corpus; the second is optional and merged
# when available.
SOURCES = [
    {"id": "alakxender/dhivehi-english-translations", "required": True},
    {"id": "alakxender/dhivehi-english-parallel", "required": False},
]

THAANA_RE = re.compile(r"[ހ-޿]")

# R-2.4. Starting thresholds; the final values are whatever this file records.
LEN_RATIO_MIN = 0.4
LEN_RATIO_MAX = 2.5
MIN_CHARS = 2
MAX_CHARS = 600

SPLIT_SEED = 11
VALID_FRACTION = 0.05
TEST_FRACTION = 0.05

# Columns that identify the domain or source a row came from, best first. R-2.6
# splits on this. Getting the detection wrong is not a loud failure — it silently
# degrades to a random row split, which is the exact thing R-2.6 forbids — so the
# script reports which column it used and refuses to continue if it found none.
DOMAIN_COLUMNS = ("topic", "doc_id", "article_id", "url", "category", "domain", "source_doc")

# The `topic` field of alakxender/dhivehi-english-translations is LLM-generated
# free text: 12 clean labels cover 99.3% of rows, trailed by 217 one-off variants
# ("Topic 4: Crime", "Poltics", "Here are the topic classifications for each...").
# Splitting on the raw string would treat each of those as its own domain, so
# they are folded onto a canonical set first.
CANONICAL_DOMAINS = (
    "politics", "local news", "crime", "business", "sports", "international",
    "health", "entertainment", "education", "environment", "religion",
    "technology", "tourism", "society", "law",
)

DOMAIN_ALIASES = {
    "poltics": "politics", "politic": "politics", "poliics": "politics",
    "busines": "business", "entertainement": "entertainment",
    "heath": "health", "loc al news": "local news",
    "internationa l": "international", "internationale": "international",
    "religious": "religion", "legal": "law", "accidents": "accident",
    "social issues": "society", "societal values": "society",
    "arts and culture": "culture", "art and culture": "culture",
}



def rel_to_root(path: Path) -> str:
    """Path relative to the repo root, for stats and log lines.

    `Path.relative_to` compares lexically, so a relative argument raises even
    when it points inside the repo — and it raises *after* the measurement has
    run, discarding the result. Resolve first, and degrade to the path as given
    when it genuinely lies outside the tree.
    """
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)

def canonical_domain(raw: str) -> str:
    """Fold a free-text topic label onto a canonical domain.

    Deliberately conservative: anything that does not clearly resolve becomes
    `other` rather than being guessed into a real domain. A misfiled row costs
    little; a fake domain boundary would make the held-out split meaningless.
    """
    text = (raw or "").strip().lower()
    if not text:
        return "other"

    # "Topic 4: Crime" / "Here are the topic classifications:" -> tail after colon
    if ":" in text:
        text = text.split(":", 1)[1].strip() or text

    # Multi-label ("Crime, Business" / "Religion/Politics"): first label wins.
    for sep in (",", "/", ";", "|", " and ", " or "):
        if sep in text:
            text = text.split(sep, 1)[0].strip()

    # Drop parenthetical hedging: "Tourism (could also be Business)"
    text = re.sub(r"\s*\(.*", "", text).strip()
    text = DOMAIN_ALIASES.get(text, text)

    if text in CANONICAL_DOMAINS:
        return text
    for domain in CANONICAL_DOMAINS:
        if text.startswith(domain):
            return domain
    return "other"


# Typographic and Arabic punctuation -> ASCII. Measured over the real corpus,
# 25.8% of rows were non-ASCII on the Latin side for punctuation reasons ALONE:
# curly quotes, ellipses, en-dashes, and the Arabic comma and question mark that
# Dhivehi text uses. Dropping those rows would discard a quarter of the corpus
# over characters carrying no information the model needs; folding them keeps the
# rows and makes the Latin genuinely ASCII, which is what §1.1 requires.
PUNCTUATION_FOLD = {
    "\u2026": "...",
    "\u201c": '"', "\u201d": '"', "\u201e": '"', "\u00ab": '"', "\u00bb": '"',
    "\u2018": "'", "\u2019": "'", "\u201a": "'",
    "\u2013": "-", "\u2014": "-", "\u2212": "-", "\u2022": "-", "\u00b7": "-",
    "\u00a0": " ", "\u202f": " ", "\u2009": " ",
    # Arabic-script punctuation, used in Dhivehi text.
    "\u060c": ",", "\u061b": ";", "\u061f": "?", "\u06d4": ".", "\u066a": "%",
}
PUNCTUATION_RE = re.compile("|".join(map(re.escape, PUNCTUATION_FOLD)))

ASCII_RE = re.compile(r"^[\x00-\x7f]*$")
LATIN_LETTER_RE = re.compile(r"[A-Za-z]")

# ---- scrape noise (conversational quality) ---------------------------------
# alakxender/dhivehi-english-parallel is 74% of the corpus and is a mixed scrape:
# alongside real prose and dialogue it carries localisation output and site
# furniture. Measured over its 239,405 rows: 4.2% are relative-time strings and
# 0.2% are UI templates. These are not sentences in either language — they teach
# the model to emit clock arithmetic and printf specifiers — so they are dropped
# rather than quarantined-and-forgotten.
TIMESTAMP_RE = re.compile(
    r"^\d+\s+(second|minute|hour|day|week|month|year)s?\s+.*ago\.?$", re.I
)
UI_STRING_RE = re.compile(r"%[sdifg@]|%\d+\$[sdifg@]|\{\d+\}|</?[a-z][a-z0-9]*>")

# Two words or fewer is a fragment ("Nenge", "Part 2 (End)"): no clause, nothing
# for a translation model to learn an alignment from. The cut is deliberately at
# two rather than three — "thank you very much", "how much is this" are three and
# four words and are exactly the everyday register this corpus is short of, so a
# <=3 cut would take ~28k rows to remove noise that a <=2 cut already gets.
MIN_WORDS = 3

# ---- conversational carve-out ----------------------------------------------
# The scrape has no domain labels, so it was treated as one pseudo-domain and
# landed wholly in train. That left every held-out row a news headline, which
# means a score computed on it says nothing about everyday language — the
# register this project is actually meant to demonstrate.
#
# So the scrape is split in two by register. `conversational` is the ~14% of it
# carrying first/second person, a direct question, or quoted speech; the rest
# keeps the pseudo-domain name. `conversational` is then the only group that is
# deliberately present in all three splits (see the split section for why that
# does not violate R-2.6).
CONVERSATIONAL_RE = re.compile(
    r"\b(i|i'm|i'll|i've|me|my|mine|we|we're|our|you|you're|your|yours)\b",
    re.I,
)
QUOTED_SPEECH_RE = re.compile(r'["\u201c\u2018].+["\u201d\u2019]')

# Held out per split, in pairs. ~1,500 of ~33k conversational rows each is ~9%
# of the register's data — enough for a stable chrF++ and cheap enough that the
# model still trains on the overwhelming majority of it.
CONV_HOLDOUT = 1500


def is_conversational(en: str) -> bool:
    """Register test on the English side, which is the reliable one.

    Deliberately loose. A false positive costs one row misfiled between two
    training groups; a false negative leaves a conversational row in the news
    pool, where it is still trained on. Neither is expensive, and being strict
    here would starve the held-out set.
    """
    text = en.strip()
    if not text:
        return False
    return bool(
        text.endswith("?")
        or CONVERSATIONAL_RE.search(text)
        or QUOTED_SPEECH_RE.search(text)
    )


def normalise(text: str) -> str:
    """NFC, strip zero-widths, fold punctuation to ASCII.

    The first two steps mirror src/core/normalize.ts. The punctuation fold is
    corpus-side only: it cleans the source text before transliteration, and the
    app has no equivalent because a user typing a curly quote is not the problem
    this solves.
    """
    text = unicodedata.normalize("NFC", text)
    text = re.sub(r"[\u200b\u200c\u200d\ufeff]", "", text)
    text = PUNCTUATION_RE.sub(lambda m: PUNCTUATION_FOLD[m.group()], text)
    return text.strip()


def load_rows(limit: int) -> list[dict]:
    """Pull the HF datasets. Each row keeps the source it came from (R-2.7)."""
    try:
        from datasets import load_dataset
    except ImportError:
        raise SystemExit(
            "datasets is not installed. pip install -r tools/requirements.txt"
        )

    rows: list[dict] = []
    for source in SOURCES:
        try:
            # Every split, not just "train". The upstream split is random, so
            # reusing it would not satisfy R-2.6; all rows are pooled here and
            # re-split by domain below. For the primary corpus this is 82,583 +
            # 9,176 = 91,759 rows, which is the "~92k" R-2.1 refers to.
            dataset = load_dataset(source["id"])
        except Exception as exc:  # noqa: BLE001
            if source["required"]:
                raise SystemExit(f"could not load required dataset {source['id']}: {exc}")
            print(f"skipping optional dataset {source['id']}: {exc}", file=sys.stderr)
            continue

        for split_name, data in dataset.items():
            columns = set(data.column_names)
            dv_col = next((c for c in ("dv", "dhivehi", "source", "thaana") if c in columns), None)
            en_col = next((c for c in ("en", "english", "target") if c in columns), None)
            if not dv_col or not en_col:
                raise SystemExit(
                    f"{source['id']}: could not find Dhivehi/English columns in {sorted(columns)}"
                )

            domain_col = next((c for c in DOMAIN_COLUMNS if c in columns), None)
            if domain_col is None:
                if source["required"]:
                    raise SystemExit(
                        f"{source['id']}: no domain column found in {sorted(columns)}.\n"
                        "R-2.6 requires splitting by domain or source so evaluation measures "
                        "generalisation rather than memorisation. Falling back to a row split "
                        "would silently defeat that, so this is a hard stop for the primary "
                        "corpus: add the column name to DOMAIN_COLUMNS, or supply a corpus "
                        "that carries one."
                    )
                # R-2.6 permits splitting by domain *or source*. A corpus with no
                # internal domain labels is therefore treated as a single domain
                # named after itself, rather than being dropped or row-split.
                print(
                    f"  {source['id']}[{split_name}]: {len(data)} rows, "
                    f"no domain column — treating the whole source as one domain"
                )
            else:
                print(f"  {source['id']}[{split_name}]: {len(data)} rows, domain column {domain_col!r}")

            for row in data:
                rows.append(
                    {
                        "dv": row[dv_col] or "",
                        "en": row[en_col] or "",
                        "source": source["id"],
                        "rawDomain": str(row[domain_col] or "") if domain_col else "",
                        "domain": (
                            canonical_domain(str(row[domain_col] or ""))
                            if domain_col
                            # R-2.6 permits splitting by source; this source is
                            # split further by register so the held-out sets are
                            # not all news (see is_conversational).
                            else (
                                "conversational"
                                if is_conversational(row[en_col] or "")
                                else f"source:{source['id']}"
                            )
                        ),
                    }
                )
                if limit and len(rows) >= limit:
                    return rows
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--limit", type=int, default=0, help="cap rows read (0 = all)")
    ap.add_argument("--ratio-min", type=float, default=LEN_RATIO_MIN)
    ap.add_argument("--ratio-max", type=float, default=LEN_RATIO_MAX)
    ap.add_argument("--max-tokens", type=int, default=128,
                    help="drop pairs that would truncate at this sequence length (R-3.5); 0 disables")
    ap.add_argument("--tokenizer", default="t5-small",
                    help="tokenizer used for the --max-tokens check; must match training")
    args = ap.parse_args()

    prefixes = load_prefixes()
    rows = load_rows(args.limit)
    if not rows:
        raise SystemExit("no rows loaded")

    dropped: Counter[str] = Counter()
    quarantine: list[dict] = []

    def reject(reason: str, row: dict) -> None:
        dropped[reason] += 1
        # R-2.8: quarantined, not deleted. Capped so a systematic failure does
        # not write a multi-gigabyte file.
        if len(quarantine) < 5000:
            quarantine.append({**row, "reason": reason})

    # ---- clean ------------------------------------------------------------
    kept: list[dict] = []
    for row in rows:
        dv = normalise(row["dv"])
        en = normalise(row["en"])

        if not dv or not en:
            reject("empty_side", row)
            continue
        if not THAANA_RE.search(dv):
            reject("no_thaana_in_source", row)
            continue
        if THAANA_RE.search(en):
            reject("thaana_in_english", row)
            continue
        # The mirror of the check above, which was missing. Latin letters on the
        # Dhivehi side are almost entirely scrape furniture — "Comments on:",
        # "Tag Archives:", "By:", site-name suffixes and bare URLs — because the
        # corpus was crawled from news pages rather than extracted from them.
        #
        # They are worth removing for their own sake, but the measurable reason
        # is R-1.8: a Latin letter has no Thaana inverse, so the transliterator
        # preserves it verbatim and the round trip cannot be stable. Dropping
        # these rows moves Latin-stability on the corpus from 92.96% to 96.19%.
        #
        # The cut is blanket rather than pattern-matched, which does also drop
        # legitimate acronyms (MTCC, COVID-19). That is 3.8% of rows against a
        # corpus already well past its target, and it keeps this check exactly as
        # simple as the `thaana_in_english` one it mirrors.
        if LATIN_LETTER_RE.search(dv):
            reject("latin_in_dhivehi", row)
            continue
        if TIMESTAMP_RE.match(en):
            reject("timestamp_fragment", row)
            continue
        if UI_STRING_RE.search(en):
            reject("ui_string", row)
            continue
        if len(en.split()) < MIN_WORDS:
            reject("too_few_words", row)
            continue
        if not (MIN_CHARS <= len(dv) <= MAX_CHARS and MIN_CHARS <= len(en) <= MAX_CHARS):
            reject("length_bounds", row)
            continue
        kept.append({**row, "dv": dv, "en": en})

    # ---- romanise (R-2.2) -------------------------------------------------
    with Transliterator() as tr:
        sha = tr.sha256
        latins = tr.thaana_to_latin_many([r["dv"] for r in kept])
    for row, latin in zip(kept, latins):
        row["latin"] = latin

    # ---- length-ratio filter (R-2.4) --------------------------------------
    ratio_kept: list[dict] = []
    for row in kept:
        if not row["latin"]:
            reject("empty_after_transliteration", row)
            continue

        # §1.1: the model is handed "ASCII, space-delimited text in one canonical
        # romanization". That premise is enforced here rather than assumed.
        # What survives punctuation folding and still is not ASCII is genuinely
        # foreign content — Quranic Arabic quotations (~3.5% of rows), stray
        # Thaana the transliterator had no rule for (~0.3%), and assorted symbols
        # (~0.3%). Quarantined with the offending characters recorded, so the
        # decision is checkable rather than silent (R-2.8).
        if not ASCII_RE.match(row["latin"]):
            leftover = sorted({c for c in row["latin"] if not c.isascii()})
            reject("non_ascii_latin", {**row, "nonAscii": leftover})
            continue
        ratio = len(row["latin"]) / max(1, len(row["en"]))
        if not (args.ratio_min <= ratio <= args.ratio_max):
            reject("length_ratio", {**row, "ratio": round(ratio, 3)})
            continue
        ratio_kept.append(row)

    # ---- dedup (R-2.3) ----------------------------------------------------
    # Exact on the pair, then near-duplicate on a case- and space-folded key, so
    # the same sentence reprinted with different spacing counts once.
    seen_exact: set[tuple[str, str]] = set()
    seen_near: set[tuple[str, str]] = set()
    deduped: list[dict] = []
    for row in ratio_kept:
        exact = (row["latin"], row["en"])
        if exact in seen_exact:
            reject("duplicate_exact", row)
            continue
        near = (
            re.sub(r"\s+", " ", row["latin"].lower()),
            re.sub(r"[^a-z0-9 ]+", "", re.sub(r"\s+", " ", row["en"].lower())),
        )
        if near in seen_near:
            reject("duplicate_near", row)
            continue
        seen_exact.add(exact)
        seen_near.add(near)
        deduped.append(row)

    if not deduped:
        raise SystemExit("every row was filtered out; refusing to write an empty corpus")

    # ---- sequence-length filter (R-3.5) -----------------------------------
    # Measured on this corpus, ~16% of pairs exceed 128 tokens under t5-small's
    # SentencePiece: Dhivehi Latin fragments to ~5.8 subwords per word against
    # English's ~1.3, so the Dhivehi side dominates the budget.
    #
    # Truncation is not an error at training time — it is silent. The model would
    # be taught to map a half-sentence to a complete translation on the dv→en
    # side, and to stop early on en→dv. Dropping those pairs costs rows the
    # corpus can afford (it clears R-2.1b's 200k target several times over) and
    # buys a training set with no invisible damage in it.
    if args.max_tokens:
        try:
            from transformers import AutoTokenizer
        except ImportError:
            raise SystemExit(
                "transformers is needed for the --max-tokens check "
                "(pip install -r tools/requirements.txt), or pass --max-tokens 0."
            )
        tok = AutoTokenizer.from_pretrained(args.tokenizer, use_fast=True)

        def lengths_of(texts: list[str]) -> list[int]:
            """Batched, because one encode() per string is ~1.6M calls here."""
            out: list[int] = []
            for start in range(0, len(texts), 2000):
                chunk = texts[start : start + 2000]
                encoded = tok(chunk, add_special_tokens=True)["input_ids"]
                out.extend(len(ids) for ids in encoded)
            return out

        # All four sequences each pair produces: both directions, input and target.
        dv_in = lengths_of([prefixes["dv-en"] + r["latin"] for r in deduped])
        en_tg = lengths_of([r["en"] for r in deduped])
        en_in = lengths_of([prefixes["en-dv"] + r["en"] for r in deduped])
        dv_tg = lengths_of([r["latin"] for r in deduped])

        fits: list[dict] = []
        for row, a, b, c, d in zip(deduped, dv_in, en_tg, en_in, dv_tg):
            longest = max(a, b, c, d)
            if longest > args.max_tokens:
                reject("over_max_tokens", {**row, "tokens": longest})
                continue
            fits.append(row)
        print(f"  sequence filter: {len(deduped) - len(fits)} pairs over {args.max_tokens} tokens")
        deduped = fits
        if not deduped:
            raise SystemExit("every pair exceeded --max-tokens; refusing to write")

    # ---- split by domain (R-2.6, R-8.8) ------------------------------------
    # Whole domains are held out, not a sample from each. That is the strong
    # reading of "measure generalisation rather than memorisation": the test set
    # is subject matter the model has never seen, so it cannot score well by
    # having memorised journalistic phrasing. It also makes the test set
    # genuinely "from a source or domain excluded from training" (R-8.8).
    #
    # The cost is real and worth stating: scores will be lower than a random
    # split would give, and noisier, because whole vocabularies are absent. That
    # is the honest number, and it is the one the spec asks for.
    groups: dict[str, list[dict]] = {}
    for row in deduped:
        groups.setdefault(row["domain"], []).append(row)

    keys = sorted(groups)
    if len(keys) < 3:
        raise SystemExit(
            f"only {len(keys)} domain(s) after canonicalisation: {keys}. "
            "Cannot hold out a domain without emptying training. Check "
            "canonical_domain(), or raise --limit if this was a trial run."
        )

    # Smallest domains first, so holding out ~5% of rows costs as few domains as
    # possible and the big ones stay in training.
    #
    # `other` is excluded from the held-out pool: it is the bucket for labels that
    # would not canonicalise, so it is a grab-bag rather than a domain. Holding it
    # out would test nothing about domain generalisation, and its rows may well be
    # about the same subjects as training rows that merely carried a cleaner label.
    total_rows = len(deduped)
    by_size = sorted(
        (k for k in keys if k not in ("other", "conversational")),
        key=lambda k: (len(groups[k]), k),
    )

    def take(target: float, pool: list[str]) -> list[str]:
        chosen, acc = [], 0
        for key in pool:
            if acc >= target * total_rows and chosen:
                break
            chosen.append(key)
            acc += len(groups[key])
        return chosen

    test_keys = take(TEST_FRACTION, by_size)
    remaining = [k for k in by_size if k not in set(test_keys)]
    valid_keys = take(VALID_FRACTION, remaining)
    train_keys = [
        k for k in keys
        if k not in set(test_keys) | set(valid_keys) and k != "conversational"
    ]

    if not train_keys:
        raise SystemExit(
            f"holding out {test_keys + valid_keys} leaves no training domains. "
            "The corpus is too domain-concentrated to split this way."
        )

    # `conversational` is held out by ROW, not as a whole domain, and is the one
    # group deliberately present in all three splits. That is a considered
    # exception to R-2.6, not an oversight:
    #
    #   - Holding it out whole would remove the entire register from training,
    #     which is the opposite of the goal — the model would be evaluated on
    #     everyday language it had never been taught.
    #   - Leaving it wholly in train (the previous behaviour) means no held-out
    #     row is conversational, so no score describes everyday language at all.
    #
    # A row-level holdout is the only option that both trains and measures the
    # register. Its scores are therefore in-domain and read as such: they are not
    # comparable to the news splits, which stay strictly domain-held-out, and the
    # stats file records the distinction rather than blurring the two together.
    conv_rows = list(groups.get("conversational", []))
    random.Random(SPLIT_SEED).shuffle(conv_rows)
    conv_valid = conv_rows[:CONV_HOLDOUT]
    conv_test = conv_rows[CONV_HOLDOUT : CONV_HOLDOUT * 2]
    conv_train = conv_rows[CONV_HOLDOUT * 2 :]

    if conv_rows and len(conv_rows) < CONV_HOLDOUT * 4:
        print(
            f"  warning: only {len(conv_rows)} conversational rows; holding out "
            f"{len(conv_valid)}+{len(conv_test)} leaves {len(conv_train)} for training",
            file=sys.stderr,
        )

    def rows_for(keys_subset: list[str]) -> list[dict]:
        return [row for key in keys_subset for row in groups[key]]

    def emit(rows_subset: list[dict]) -> list[dict]:
        out: list[dict] = []
        for row in rows_subset:
            # R-2.5: both directions, prefix explicit, never implicit.
            provenance = {
                "source": row["source"],
                "domain": row["domain"],
                "rawDomain": row["rawDomain"],
                "synthetic": False,
            }
            out.append(
                {
                    "input": prefixes["dv-en"] + row["latin"],
                    "target": row["en"],
                    "direction": "dv-en",
                    "provenance": provenance,
                }
            )
            out.append(
                {
                    "input": prefixes["en-dv"] + row["en"],
                    "target": row["latin"],
                    "direction": "en-dv",
                    "provenance": provenance,
                }
            )
        return out

    splits = {
        "train": emit(rows_for(train_keys) + conv_train),
        "valid": emit(rows_for(valid_keys) + conv_valid),
        "test": emit(rows_for(test_keys) + conv_test),
    }

    # ---- invariants --------------------------------------------------------
    overlap = (set(train_keys) & set(valid_keys)) | (set(train_keys) & set(test_keys))
    if overlap:
        raise SystemExit(f"domains in both train and held-out: {sorted(overlap)}; refusing to write")

    # An identical sentence can appear under two different domains — news wires
    # get reprinted. Domain grouping cannot prevent that, so the duplicates are
    # removed from the held-out sides (never from train) and counted. Aborting
    # here would be wrong: a handful of reprinted sentences is a property of the
    # corpus, not a bug in the split.
    train_inputs = {row["input"] for row in splits["train"]}
    leaked = {}
    for name in ("valid", "test"):
        before = len(splits[name])
        splits[name] = [row for row in splits[name] if row["input"] not in train_inputs]
        leaked[name] = before - len(splits[name])

    # The same reprint problem applies between the two held-out sets: a sentence
    # carried by two domains lands in both valid and test, which quietly couples
    # model selection to the final score. Test is the set that must stay clean,
    # so the duplicates are dropped from valid.
    test_inputs = {row["input"] for row in splits["test"]}
    before = len(splits["valid"])
    splits["valid"] = [row for row in splits["valid"] if row["input"] not in test_inputs]
    leaked["valid_test_overlap"] = before - len(splits["valid"])

    for name in ("valid", "test"):
        if not splits[name]:
            raise SystemExit(f"{name} is empty after removing leaked inputs; refusing to write")
        still = sum(1 for row in splits[name] if row["input"] in train_inputs)
        if still:
            raise SystemExit(f"{still} inputs still shared with train in {name}; refusing to write")

    shared = {r["input"] for r in splits["valid"]} & {r["input"] for r in splits["test"]}
    if shared:
        raise SystemExit(f"{len(shared)} inputs shared between valid and test; refusing to write")

    # ---- write ------------------------------------------------------------
    args.out.mkdir(parents=True, exist_ok=True)
    for name, rows_out in splits.items():
        (args.out / f"{name}.jsonl").write_text(
            "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows_out),
            encoding="utf-8",
        )
    # AC-11 asks for round-trip transliteration measured on the news corpus, not
    # just the dictionary. The corpus itself cannot answer that: it keeps only the
    # romanised Latin, having thrown the Thaana away at the transliteration step.
    # So a sample of KEPT rows is written back out with its original Thaana, which
    # tools/measure_roundtrip.py reads directly (--field dv). Sampled rather than
    # complete because round-tripping 300k sentences through the Node bridge costs
    # far more than the confidence interval is worth.
    roundtrip_sample = list(deduped)
    random.Random(SPLIT_SEED).shuffle(roundtrip_sample)
    (args.out / "roundtrip_sample.jsonl").write_text(
        "".join(
            json.dumps({"dv": r["dv"], "latin": r["latin"], "domain": r["domain"]},
                       ensure_ascii=False) + "\n"
            for r in roundtrip_sample[:5000]
        ),
        encoding="utf-8",
    )

    (args.out / "quarantine.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in quarantine),
        encoding="utf-8",
    )

    real_pairs = len(deduped)
    stats = {
        "generatedBy": "tools/build_translation_pairs.py",
        "sources": [s["id"] for s in SOURCES],
        "transliteratorSha256": sha,
        "prefixes": prefixes,
        "rowsRead": len(rows),
        "pairsKept": real_pairs,
        "dropped": dict(dropped.most_common()),
        "droppedTotal": sum(dropped.values()),
        "quarantined": len(quarantine),
        "lengthRatioBounds": [args.ratio_min, args.ratio_max],
        "maxTokens": args.max_tokens,
        "tokenizer": args.tokenizer,
        "splitSeed": SPLIT_SEED,
        "splitBy": (
            "domain (whole domains held out, R-2.6 / R-8.8); the `conversational` "
            "group is held out by row instead and is present in all three splits"
        ),
        "domainCount": len(keys),
        "domains": {
            "train": sorted(train_keys),
            "valid": sorted(valid_keys),
            "test": sorted(test_keys),
        },
        "domainRowCounts": {k: len(v) for k, v in sorted(groups.items(), key=lambda kv: -len(kv[1]))},
        # Recorded separately because these scores are NOT comparable to the news
        # splits. The news domains are strictly held out, so their scores measure
        # generalisation to unseen subject matter; the conversational rows are a
        # row-level holdout from a register the model does train on, so their
        # scores are in-domain and will read higher. Publishing one number over
        # both would be a misleading average of two different things.
        "conversationalHoldout": {
            "rows": len(conv_rows),
            "assigned": {
                "train": len(conv_train),
                "valid": len(conv_valid),
                "test": len(conv_test),
            },
            # Counted from the written splits, so these reflect what survived
            # leak removal rather than what was originally assigned. Directional
            # rows, i.e. two per pair.
            "written": {
                name: sum(
                    1 for r in rows_out if r["provenance"]["domain"] == "conversational"
                )
                for name, rows_out in splits.items()
            },
            "heldOutBy": "row (seeded shuffle), not domain",
            "note": (
                "Scores on these rows are in-domain and are not comparable to the "
                "domain-held-out news splits. Report them separately."
            ),
        },
        "leakedInputsRemoved": leaked,
        "rows": {name: len(rows_out) for name, rows_out in splits.items()},
        # R-2.1b / AC-13. Stage 1 is the real pairs; Stage 2 adds back-translated
        # ones (R-2.10), which is why `provenance.synthetic` exists from the start.
        "stage": 1,
        "stage1Target": 90_000,
        "stage2Target": 200_000,
        "syntheticPairs": 0,
        "realPairs": real_pairs,
        "meetsStage2Target": real_pairs >= 200_000,
    }
    (args.out / "corpus_stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"rows read            {stats['rowsRead']}")
    print(f"pairs kept           {real_pairs}")
    print(f"dropped              {stats['droppedTotal']}")
    for reason, count in dropped.most_common():
        print(f"  {reason:<28} {count}")
    print(f"domains              {len(keys)}")
    for name, held in (("train", train_keys), ("valid", valid_keys), ("test", test_keys)):
        shown = ", ".join(sorted(held)[:6]) + (" …" if len(held) > 6 else "")
        print(f"  {name:<6} {len(splits[name]):>8} rows  [{shown}]")
    if any(leaked.values()):
        print(f"  leaked inputs removed from held-out sets: {leaked}")
    print(f"\ntransliterator       {sha[:16]}…")
    print(f"wrote                {rel_to_root(args.out)}/")

    if real_pairs < 200_000:
        print(
            f"\nStage 1 corpus: {real_pairs} pairs. R-2.1b targets ≥200,000 for Stage 2 — "
            "see tools/backtranslate.py (R-2.10).",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
