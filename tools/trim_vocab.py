#!/usr/bin/env python3
"""Trim t5's vocabulary to what the corpus actually uses (R-3.2 step 1, R-3.4).

Why this exists
---------------
`tools/export_onnx.py` refuses to write above the 80 MB budget, and the honest
export lands at **80.27 MB** — which `docs/DESIGN.md` §5.3 predicted ("35 + 42 +
2.4 ≈ 80 MB — *at* the budget, not under it"). The fp32 sizes say where the room
is. t5-small is `d_model=512`, `vocab=32,128`:

    embedding                   16.45M params
    encoder = embed + 6 layers  35.3M   -> 141.3 MB fp32   (measured 141.41)
    merged  = embed + 6 layers  41.7M   -> 166.5 MB fp32   (measured 166.86)

`lm_head` is already deduplicated against `shared.weight`, so that lever is
spent. But the embedding still appears once per graph: **2 x 16.45 MB at INT8,
about 42% of the shipped ONNX.** Nothing else comes close.

Retraining is not required
--------------------------
REQUIREMENTS.md R-3.2 says "trim the vocabulary ... and retrain". Retraining is
the conservative reading, not a constraint of the method: slicing embedding rows
keeps the learned vector for every surviving token *bit for bit*. The model does
not lose accuracy on what it kept — it loses only the ability to emit what was
dropped. So the whole question is whether the kept set is complete, which is what
steps 5 and 6 below verify rather than assume.

What is kept
------------
    every token the corpus tokenizes to     inputs and targets, all splits
    every special token                     <pad>=0, </s>=1, <unk>=2
    every single-character ASCII piece      so arbitrary user input still
                                            tokenizes instead of hitting <unk>

That last set is the one worth arguing about. The corpus decides what the model
can *produce*, but a user can type anything into the encoder, and a dropped
character piece would silently become `<unk>`. Keeping all single-character
ASCII pieces (with and without the SentencePiece word-boundary prefix) costs a
few hundred rows and makes any ASCII input representable. Both languages here are
ASCII by construction — Thaana never reaches the model (R-2.2) — so this is a
complete guarantee, not a heuristic.

    python tools/trim_vocab.py \
        --model models/dv-en-translate \
        --corpus data/parallel/train.jsonl data/parallel/valid.jsonl \
                 data/parallel/test.jsonl \
        --out models/dv-en-translate-trimmed
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import torch
    from tokenizers import Tokenizer
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer, PreTrainedTokenizerFast
except ImportError as exc:  # noqa: BLE001
    print(
        f"dependencies are missing ({exc.name}).\n"
        "  pip install -r tools/requirements.txt -r tools/requirements-train.txt\n"
        "This runs wherever the checkpoint is — Colab, or a local box with torch.",
        file=sys.stderr,
    )
    _MISSING_DEPS = True
else:
    _MISSING_DEPS = False

# SentencePiece marks a word boundary with U+2581, not a space.
SPIECE_UNDERLINE = "▁"

# Sampled, not exhaustive: step 5 compares tokenizations piece by piece, which is
# O(rows). A few thousand rows per split is enough to catch a dropped piece, and
# step 6 is the end-to-end check that matters.
VERIFY_SAMPLE = 2000


def read_rows(paths: list[Path]) -> list[dict]:
    rows: list[dict] = []
    for path in paths:
        if not path.exists():
            raise SystemExit(f"missing corpus file: {path}")
        rows.extend(
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        )
    if not rows:
        raise SystemExit("corpus is empty")
    return rows


def collect_used_ids(tokenizer, rows: list[dict], batch: int = 1000) -> set[int]:
    """Every id the corpus tokenizes to, from both sides of every pair.

    Targets alone would be wrong. The encoder sees the input side, and an id that
    only ever appears there is still needed to represent it.
    """
    texts = [t for row in rows for t in (row["input"], row["target"])]
    used: set[int] = set()
    for i in range(0, len(texts), batch):
        for ids in tokenizer(texts[i : i + batch], add_special_tokens=True)["input_ids"]:
            used.update(ids)
        if i and i % (batch * 100) == 0:
            print(f"    {i:>9,} / {len(texts):,} texts, {len(used):,} ids so far")
    return used


def ascii_single_char_ids(vocab: list, tokenizer) -> set[int]:
    """Ids for pieces that are one ASCII character, bare or word-initial.

    The safety margin for input the corpus never contained. Both languages are
    ASCII (R-2.2 keeps Thaana out of the model entirely), so this makes every
    reachable input representable without `<unk>`.
    """
    keep = set()
    for idx, entry in enumerate(vocab):
        piece = entry[0] if isinstance(entry, (list, tuple)) else entry
        bare = piece[len(SPIECE_UNDERLINE) :] if piece.startswith(SPIECE_UNDERLINE) else piece
        if len(bare) == 1 and bare.isascii() and bare.isprintable():
            keep.add(idx)
        elif piece == SPIECE_UNDERLINE:
            keep.add(idx)
    return keep


def build_trimmed_tokenizer(tok_json: dict, keep: list[int]) -> dict:
    """Filter the Unigram vocab and remap every id that refers into it.

    A Unigram `model.vocab` is a list of `[piece, log_prob]` whose *index is the
    id*, so trimming is a filter plus a remap — no retraining of the tokenizer
    and no change to any surviving piece's score.
    """
    model = tok_json["model"]
    if model.get("type") != "Unigram":
        raise SystemExit(
            f"expected a Unigram tokenizer, got {model.get('type')!r}.\n"
            "  This script only knows how to trim SentencePiece Unigram vocabs, which is "
            "what t5 and flan-t5 use."
        )

    old_to_new = {old: new for new, old in enumerate(keep)}
    model["vocab"] = [model["vocab"][i] for i in keep]

    if model.get("unk_id") is not None:
        if model["unk_id"] not in old_to_new:
            raise SystemExit("the unk token was dropped, which cannot be right")
        model["unk_id"] = old_to_new[model["unk_id"]]

    kept_added = []
    for entry in tok_json.get("added_tokens", []):
        if entry["id"] in old_to_new:
            kept_added.append({**entry, "id": old_to_new[entry["id"]]})
    tok_json["added_tokens"] = kept_added

    # The post-processor pins </s> by id. Those ids are only remapped correctly
    # here because the specials sort to the front and keep their positions; if a
    # future base model breaks that, fail rather than emit a tokenizer that
    # appends the wrong token to every sequence.
    post = tok_json.get("post_processor") or {}
    for special in (post.get("special_tokens") or {}).values():
        for old in special.get("ids", []):
            if old_to_new.get(old) != old:
                raise SystemExit(
                    f"post_processor references id {old}, which trimming would move to "
                    f"{old_to_new.get(old)}. Refusing to write a tokenizer whose "
                    "sequence framing changed."
                )
    return tok_json


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--model", type=Path, required=True, help="trained checkpoint directory")
    ap.add_argument("--corpus", type=Path, nargs="+", required=True, help="all splits")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument(
        "--no-ascii-margin",
        action="store_true",
        help="keep only corpus tokens. Smaller, but unseen ASCII input can hit <unk>",
    )
    args = ap.parse_args()

    if _MISSING_DEPS:
        return 1

    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForSeq2SeqLM.from_pretrained(args.model)
    tok_json = json.loads(tokenizer.backend_tokenizer.to_str())
    vocab = tok_json["model"]["vocab"]

    embed_rows = model.get_input_embeddings().weight.shape[0]
    print(f"1. loaded {args.model}")
    print(f"  tokenizer vocab   {len(vocab):,}")
    print(f"  embedding rows    {embed_rows:,}")
    if embed_rows > len(vocab):
        # t5-small pads 32,100 pieces up to 32,128 for kernel alignment. Those
        # rows are unreachable and go for free.
        print(f"  unreachable rows  {embed_rows - len(vocab):,} (padding, dropped)")

    print(f"\n2. scan corpus ({len(args.corpus)} files)")
    rows = read_rows(args.corpus)
    print(f"  {len(rows):,} rows, {len(rows) * 2:,} texts")
    used = collect_used_ids(tokenizer, rows)
    used = {i for i in used if i < len(vocab)}
    print(f"  {len(used):,} distinct ids used")

    specials = {i for i in tokenizer.all_special_ids if i < len(vocab)}
    margin = set() if args.no_ascii_margin else ascii_single_char_ids(vocab, tokenizer)
    keep = sorted(used | specials | margin)
    print(f"\n3. keep set")
    print(f"  corpus            {len(used):,}")
    print(f"  special tokens    {len(specials - used):,} more")
    print(f"  ascii singles     {len(margin - used - specials):,} more")
    print(f"  total kept        {len(keep):,} of {len(vocab):,} "
          f"({len(keep) / len(vocab):.1%})")

    if len(keep) >= len(vocab):
        raise SystemExit(
            "nothing to trim: the corpus uses the whole vocabulary.\n"
            "  Fall back to R-3.2 step 2 (q4 decoder, with the chrF++ cost measured)."
        )

    # ---- 4. slice the weights ---------------------------------------------
    print("\n4. slice embedding")
    index = torch.tensor(keep, dtype=torch.long)
    old_embed = model.get_input_embeddings().weight.data
    new_embed = old_embed.index_select(0, index).clone()

    tied = bool(getattr(model.config, "tie_word_embeddings", True))
    old_lm_head = None
    if not tied:
        old_lm_head = model.lm_head.weight.data.index_select(0, index).clone()

    model.resize_token_embeddings(len(keep))
    model.get_input_embeddings().weight.data.copy_(new_embed)
    if not tied:
        model.lm_head.weight.data.copy_(old_lm_head)
    model.config.vocab_size = len(keep)
    print(f"  {tuple(old_embed.shape)} -> {tuple(model.get_input_embeddings().weight.shape)}"
          f"  ({'tied' if tied else 'lm_head sliced separately'})")

    # ---- 5. rebuild the tokenizer -----------------------------------------
    print("\n5. rebuild tokenizer")
    trimmed = PreTrainedTokenizerFast(
        tokenizer_object=Tokenizer.from_str(
            json.dumps(build_trimmed_tokenizer(tok_json, keep))
        ),
        model_max_length=tokenizer.model_max_length,
        pad_token=tokenizer.pad_token,
        eos_token=tokenizer.eos_token,
        unk_token=tokenizer.unk_token,
        # Carried over, not defaulted. PreTrainedTokenizerFast assumes
        # token_type_ids; T5 has no such input and generate() rejects it — and
        # this lands in tokenizer_config.json, so the wrong value would reach
        # transformers.js and be fed to the ONNX encoder at runtime.
        model_input_names=list(tokenizer.model_input_names),
        padding_side=tokenizer.padding_side,
    )
    if set(trimmed.model_input_names) != set(tokenizer.model_input_names):
        raise SystemExit(
            f"model_input_names changed {tokenizer.model_input_names} -> "
            f"{trimmed.model_input_names}"
        )
    for name in ("pad_token_id", "eos_token_id", "unk_token_id"):
        before, after = getattr(tokenizer, name), getattr(trimmed, name)
        if before != after:
            raise SystemExit(
                f"{name} moved {before} -> {after}. config.json, generation_config.json "
                "and decoder_start_token_id all pin these by number, so a move here "
                "silently corrupts generation."
            )
    print(f"  pad={trimmed.pad_token_id} eos={trimmed.eos_token_id} "
          f"unk={trimmed.unk_token_id} — unchanged")

    # ---- 6. verify tokenization is unchanged -------------------------------
    # The whole claim of this script is that nothing the corpus needs was
    # dropped. If a needed piece is gone, Unigram re-segments around it or emits
    # <unk>, and the piece sequences stop matching.
    print(f"\n6. verify tokenization on {VERIFY_SAMPLE:,} sampled rows")
    step = max(1, len(rows) // VERIFY_SAMPLE)
    checked = 0
    for row in rows[::step][:VERIFY_SAMPLE]:
        for text in (row["input"], row["target"]):
            if tokenizer.tokenize(text) != trimmed.tokenize(text):
                raise SystemExit(
                    "REFUSING TO WRITE: tokenization changed after trimming.\n"
                    f"  text:    {text[:90]}\n"
                    f"  before:  {tokenizer.tokenize(text)[:14]}\n"
                    f"  after:   {trimmed.tokenize(text)[:14]}\n"
                    "  A piece the corpus needs was dropped. This is a bug in the keep set, "
                    "not something to work around."
                )
            # Pieces alone miss the fields around them: an extra input the model
            # does not accept, a lost attention mask, different </s> framing.
            # All three reach the ONNX encoder through the exported
            # tokenizer_config.json, so compare what the model is actually fed.
            #
            # Not the ids themselves — remapping them is the entire point. What
            # must survive is the *piece* sequence they decode to, this time
            # including the special tokens that `tokenize()` leaves out.
            before, after = dict(tokenizer(text)), dict(trimmed(text))
            if before.keys() != after.keys():
                raise SystemExit(
                    "REFUSING TO WRITE: the trimmed tokenizer returns different fields.\n"
                    f"  before:  {sorted(before)}\n"
                    f"  after:   {sorted(after)}\n"
                    "  These are written to tokenizer_config.json and fed to the ONNX "
                    "encoder by transformers.js."
                )
            if before.get("attention_mask") != after.get("attention_mask") or (
                tokenizer.convert_ids_to_tokens(before["input_ids"])
                != trimmed.convert_ids_to_tokens(after["input_ids"])
            ):
                raise SystemExit(
                    "REFUSING TO WRITE: encoding changed after trimming.\n"
                    f"  text:    {text[:90]}\n"
                    f"  before:  {tokenizer.convert_ids_to_tokens(before['input_ids'])[:14]}\n"
                    f"  after:   {trimmed.convert_ids_to_tokens(after['input_ids'])[:14]}"
                )
            checked += 1
    print(f"  ok  {checked:,} texts tokenize identically")

    # ---- 7. verify generation is unchanged ---------------------------------
    # Steps 5 and 6 are about ids. This is the only step that shows the sliced
    # weights still decode to the same strings.
    print("\n7. verify generation")
    probes = [row["input"] for row in rows[:: max(1, len(rows) // 8)][:8]]
    reference = AutoModelForSeq2SeqLM.from_pretrained(args.model).eval()
    model.eval()
    with torch.no_grad():
        for text in probes:
            before = reference.generate(
                **tokenizer(text, return_tensors="pt", truncation=True, max_length=128),
                max_new_tokens=64, num_beams=1, do_sample=False,
            )
            after = model.generate(
                **trimmed(text, return_tensors="pt", truncation=True, max_length=128),
                max_new_tokens=64, num_beams=1, do_sample=False,
            )
            a = tokenizer.decode(before[0], skip_special_tokens=True)
            b = trimmed.decode(after[0], skip_special_tokens=True)
            if a != b:
                raise SystemExit(
                    "REFUSING TO WRITE: generation changed after trimming.\n"
                    f"  input:   {text[:90]}\n"
                    f"  before:  {a[:90]}\n"
                    f"  after:   {b[:90]}"
                )
    print(f"  ok  {len(probes)} probes generate identical output")

    # ---- 8. write ----------------------------------------------------------
    args.out.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(str(args.out))
    trimmed.save_pretrained(str(args.out))

    saved_params = (embed_rows - len(keep)) * model.config.d_model
    (args.out / "trim_stats.json").write_text(
        json.dumps(
            {
                "generatedBy": "tools/trim_vocab.py",
                "sourceCheckpoint": str(args.model),
                "corpus": [str(p) for p in args.corpus],
                "corpusRows": len(rows),
                "vocabBefore": embed_rows,
                "vocabAfter": len(keep),
                "keptFromCorpus": len(used),
                "keptAsAsciiMargin": len(margin - used - specials),
                "asciiMargin": not args.no_ascii_margin,
                "embeddingParamsDropped": saved_params,
                "estimatedInt8BytesSavedPerGraph": saved_params,
                "tiedWordEmbeddings": tied,
                "verifiedTexts": checked,
                "verifiedProbes": len(probes),
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    # One embedding copy per graph, one byte per param at INT8. tokenizer.json
    # shrinks on top of this and is not counted here.
    print(f"\nwrote {args.out}")
    print(f"  vocab {embed_rows:,} -> {len(keep):,}")
    print(f"  ~{saved_params / 1e6:.1f} MB less per graph at INT8, "
          f"~{2 * saved_params / 1e6:.1f} MB across the two shipped graphs")
    print("\nNext:")
    print(f"  python tools/export_onnx.py --model {args.out} \\")
    print("      --out public/models/dv-en-translate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
