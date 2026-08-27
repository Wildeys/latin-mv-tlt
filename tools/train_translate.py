#!/usr/bin/env python3
"""Fine-tune the direct translation model (M-3, R-9.1, R-9.2, R-8.5).

Adapted from tools/train_t5_realize.py rather than written fresh — the dataset
class there is content-agnostic (`row["input"]` / `row["target"]`), so prefixed
translation pairs need no change to it at all. What did change, and why:

  Trainer → Seq2SeqTrainer
      The old script could not express R-9.2. `predict_with_generate` exists only
      on the seq2seq trainer, and without it there is no way to compute a
      generation metric — so v0.1 evaluated on validation *loss* alone.

  learning_rate 5e-5 → 1e-4
      R-9.2. 3e-4 is available via --lr as a recorded ablation if 1e-4 underfits.

  weight_decay 0.0 → 0.01
      R-9.2. The old script never set it, so it silently used the HF default.

  load_best_model_at_end=True, metric_for_best_model="chrf"
      R-8.5. This fixes a silent bug: with `save_strategy="epoch"` and no
      `load_best_model_at_end`, `trainer.save_model()` saved the LAST epoch, not
      the best. An overfitting run therefore shipped its worst checkpoint.

  compute_metrics scored PER DIRECTION
      One mixed average can hide a direction that has collapsed entirely, and
      this model serves both from one set of weights.

  padding="max_length" → DataCollatorForSeq2Seq
      Padding every sequence to 128 wastes most of each batch on pad tokens.

    python tools/train_translate.py \
        --train data/parallel/train.jsonl \
        --valid data/parallel/valid.jsonl \
        --out models/dv-en-translate
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Heavy imports are deferred so `--help` works on a machine without the training
# stack. The corpus is built locally (it needs Node for the transliterator) but
# training runs on Colab, so those two environments are deliberately different.
try:
    import numpy as np
    import torch
    from torch.utils.data import Dataset
    from transformers import (
        AutoModelForSeq2SeqLM,
        AutoTokenizer,
        DataCollatorForSeq2Seq,
        Seq2SeqTrainer,
        Seq2SeqTrainingArguments,
        set_seed,
    )
except ImportError as exc:  # noqa: BLE001
    print(
        f"training dependencies are missing ({exc.name}).\n"
        "  pip install -r tools/requirements.txt\n"
        "This script is meant to run on Colab or a local GPU box; the corpus "
        "builder runs elsewhere and does not need torch.",
        file=sys.stderr,
    )
    Dataset = object  # keep the class body importable for --help
    _MISSING_DEPS = True
else:
    _MISSING_DEPS = False


class PairDataset(Dataset):
    """Prefixed translation pairs.

    Unchanged in substance from FrameDataset in train_t5_realize.py — it never
    cared what the strings meant. Padding moved out to the collator so batches
    pad to their own longest member rather than to max_len.
    """

    def __init__(self, path: Path, tokenizer, max_len: int = 128):
        self.rows = [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        if not self.rows:
            raise SystemExit(f"{path} is empty")
        self.tokenizer = tokenizer
        self.max_len = max_len

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, idx):
        row = self.rows[idx]
        model_inputs = self.tokenizer(row["input"], truncation=True, max_length=self.max_len)
        labels = self.tokenizer(text_target=row["target"], truncation=True, max_length=self.max_len)
        model_inputs["labels"] = labels["input_ids"]
        return model_inputs

    def directions(self) -> list[str]:
        return [row.get("direction", "unknown") for row in self.rows]


def build_metrics(tokenizer, directions: list[str]):
    """BLEU and chrF++, overall and per direction (R-8.4).

    chrF++ is `word_order=2`. Bare CHRF() is chrF, which is a different metric —
    R-8.4 requires chrF++ specifically, and this is the easiest place in the
    project to be quietly wrong.
    """
    import sacrebleu

    bleu = sacrebleu.BLEU()
    chrf = sacrebleu.CHRF(word_order=2)

    def compute(eval_pred):
        preds, labels = eval_pred
        if isinstance(preds, tuple):
            preds = preds[0]

        preds = np.where(preds != -100, preds, tokenizer.pad_token_id)
        labels = np.where(labels != -100, labels, tokenizer.pad_token_id)
        decoded_preds = [p.strip() for p in tokenizer.batch_decode(preds, skip_special_tokens=True)]
        decoded_labels = [l.strip() for l in tokenizer.batch_decode(labels, skip_special_tokens=True)]

        results = {
            "bleu": bleu.corpus_score(decoded_preds, [decoded_labels]).score,
            "chrf": chrf.corpus_score(decoded_preds, [decoded_labels]).score,
        }

        # Per direction. A mixed average can look acceptable while one direction
        # produces nothing usable.
        if len(directions) == len(decoded_preds):
            for name in ("dv-en", "en-dv"):
                idx = [i for i, d in enumerate(directions) if d == name]
                if not idx:
                    continue
                p = [decoded_preds[i] for i in idx]
                r = [decoded_labels[i] for i in idx]
                results[f"bleu_{name}"] = bleu.corpus_score(p, [r]).score
                results[f"chrf_{name}"] = chrf.corpus_score(p, [r]).score

        return {k: round(v, 4) for k, v in results.items()}

    return compute


def check_resume_layout(ckpt: Path, run_dir: Path) -> None:
    """Fail before the GPU time, not after it.

    Two ways a resumed run quietly produces the wrong artefact. Both are caused
    by checkpoints that were parked in Drive and copied back somewhere else, and
    neither announces itself until the run is already finished:

      the checkpoint is not under output_dir
          The trainer resumes from wherever it is pointed but writes *new*
          checkpoints under output_dir. Rotation, best-checkpoint recovery and a
          later `--resume auto` all read output_dir, so the run ends up split
          across two directories that each look incomplete.

      the best checkpoint was left behind
          trainer_state.json records the best checkpoint as an absolute path
          belonging to the session that wrote it. transformers repairs that path
          on every save, but only by looking for `checkpoint-<best_global_step>`
          under output_dir; if that directory is missing it logs a warning and
          carries on, and `save_model()` then writes the LAST step instead of the
          best one — reinstating exactly the bug `load_best_model_at_end` is here
          to prevent, on a run that otherwise looks successful.
    """
    state = json.loads((ckpt / "trainer_state.json").read_text(encoding="utf-8"))
    print(
        f"resuming {ckpt.name}: step {state.get('global_step')}/{state.get('max_steps')}, "
        f"epoch {state.get('epoch')}"
    )

    if ckpt.resolve().parent != run_dir.resolve():
        raise SystemExit(
            "checkpoint is not inside the output directory\n"
            f"  checkpoint: {ckpt.resolve()}\n"
            f"  output_dir: {run_dir.resolve()}\n"
            "  New checkpoints go to output_dir, so resuming from elsewhere splits the run "
            "across two directories.\n"
            f"  Move it into {run_dir}, or pass --out {run_dir.parent} so that <out>/runs is "
            "where the checkpoints already are."
        )

    best = state.get("best_model_checkpoint")
    if not best:
        return
    # best_global_step is what transformers rebuilds the path from; older
    # checkpoints predate the field, so fall back to the recorded basename.
    name = (
        f"checkpoint-{state['best_global_step']}"
        if state.get("best_global_step")
        else Path(best).name
    )
    if (run_dir / name).is_dir():
        print(f"best so far: {name}, chrf++ {state.get('best_metric')}")
        return
    raise SystemExit(
        f"the interrupted run's best checkpoint is missing: {run_dir / name}\n"
        f"  trainer_state.json scored it {state.get('best_metric')} chrf++, and "
        f"recorded it at {best}.\n"
        "  transformers only warns about this, and save_model() then ships the last step "
        "rather than the best one.\n"
        f"  Copy {name} back from Drive alongside {ckpt.name} before resuming."
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--train", type=Path, required=True)
    ap.add_argument("--valid", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--model", default="t5-small", help="t5-small or google/flan-t5-small")
    ap.add_argument("--epochs", type=float, default=4.0, help="R-9.2: 3–5")
    # R-9.2. Batch 32 assumes t5-small at seq len 128 in fp16 on a T4;
    # flan-t5-base (250M) needs 8–16.
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=1e-4, help="R-9.2. 3e-4 only as a recorded ablation")
    ap.add_argument("--weight-decay", type=float, default=0.01)
    ap.add_argument("--max-len", type=int, default=128, help="R-3.5")
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--smoke", action="store_true", help="tiny wiring check, not a real run")
    # Colab sessions get terminated. Without this, a dropped run restarts from
    # epoch 0 and the ~730 MB per-epoch checkpoints under --out/runs are dead
    # weight. "auto" takes the latest checkpoint in that directory.
    ap.add_argument(
        "--resume",
        default=None,
        metavar="CHECKPOINT|auto",
        help="resume from a checkpoint directory, or 'auto' for the latest under --out/runs",
    )
    # Saving once per epoch is ~15,000 steps at batch 32 on this corpus, so a
    # session that dies at step 50,000 throws away everything since step 45,003.
    # This bounds that loss to N steps.
    ap.add_argument(
        "--save-steps",
        type=int,
        default=None,
        metavar="N",
        help="checkpoint and evaluate every N steps instead of once per epoch",
    )
    args = ap.parse_args()

    if _MISSING_DEPS:
        return 1

    if args.lr > 1.5e-4:
        print(
            f"note: lr={args.lr} is above R-9.2's 1e-4. Record this as an ablation "
            "and say so alongside any published score.",
        )

    set_seed(args.seed)

    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForSeq2SeqLM.from_pretrained(args.model)

    train_ds = PairDataset(args.train, tokenizer, args.max_len)
    valid_ds = PairDataset(args.valid, tokenizer, args.max_len)

    if args.smoke:
        train_ds.rows = train_ds.rows[:64]
        valid_ds.rows = valid_ds.rows[:16]
        args.epochs = 1

    args.out.mkdir(parents=True, exist_ok=True)
    run_dir = args.out / "runs"

    # load_best_model_at_end requires eval_strategy == save_strategy, and
    # save_steps to be a multiple of eval_steps, so the two move together.
    cadence = (
        {
            "eval_strategy": "steps",
            "save_strategy": "steps",
            "eval_steps": args.save_steps,
            "save_steps": args.save_steps,
        }
        if args.save_steps
        else {"eval_strategy": "epoch", "save_strategy": "epoch"}
    )

    training = Seq2SeqTrainingArguments(
        output_dir=str(run_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        per_device_eval_batch_size=args.batch,
        learning_rate=args.lr,
        weight_decay=args.weight_decay,
        **cadence,
        # R-8.5: validation metrics at every `cadence` boundary, best checkpoint
        # selected on the metric. Training without a validation metric is not
        # acceptable.
        predict_with_generate=True,
        generation_max_length=args.max_len,
        generation_num_beams=1,  # greedy, matching inference (R-3.5)
        load_best_model_at_end=True,
        metric_for_best_model="chrf",
        greater_is_better=True,
        save_total_limit=2,
        fp16=torch.cuda.is_available(),
        seed=args.seed,
        logging_steps=100,
        report_to=[],
    )

    trainer = Seq2SeqTrainer(
        model=model,
        args=training,
        train_dataset=train_ds,
        eval_dataset=valid_ds,
        processing_class=tokenizer,
        data_collator=DataCollatorForSeq2Seq(tokenizer, model=model, label_pad_token_id=-100),
        compute_metrics=build_metrics(tokenizer, valid_ds.directions()),
    )

    # A typo here silently trains from scratch for four hours, which is the worst
    # possible way to find out about it — so the path is resolved and checked
    # here rather than handed to the trainer as-is.
    resume = args.resume
    if resume is not None:
        if resume == "auto":
            from transformers.trainer_utils import get_last_checkpoint

            found = get_last_checkpoint(str(run_dir)) if run_dir.is_dir() else None
            if found is None:
                raise SystemExit(
                    f"--resume auto found no checkpoint under {run_dir}\n"
                    "  A Colab disk does not survive the session that made it. Copy the "
                    "checkpoint-* directories back from Drive into that path, or point "
                    "--out at the Drive directory that already holds them."
                )
            ckpt = Path(found)
        else:
            ckpt = Path(resume)
            if not (ckpt / "trainer_state.json").exists():
                raise SystemExit(
                    f"not a checkpoint directory: {ckpt}\n"
                    "  expected trainer_state.json inside it. Pass --resume auto to use the "
                    f"latest under {run_dir}."
                )
        check_resume_layout(ckpt, run_dir)
        resume = str(ckpt)

    trainer.train(resume_from_checkpoint=resume)

    # With load_best_model_at_end=True this is the best checkpoint, not the last.
    trainer.save_model(str(args.out))
    tokenizer.save_pretrained(str(args.out))

    history = [h for h in trainer.state.log_history if "eval_chrf" in h]
    (args.out / "training_stats.json").write_text(
        json.dumps(
            {
                "generatedBy": "tools/train_translate.py",
                "baseModel": args.model,
                "epochs": args.epochs,
                "batch": args.batch,
                "learningRate": args.lr,
                "weightDecay": args.weight_decay,
                "maxLen": args.max_len,
                "seed": args.seed,
                "smoke": args.smoke,
                "resumedFrom": args.resume,
                "saveSteps": args.save_steps,
                "trainRows": len(train_ds),
                "validRows": len(valid_ds),
                "perEpoch": history,
                "bestMetric": trainer.state.best_metric,
                "bestCheckpoint": trainer.state.best_model_checkpoint,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"\nbest chrf++ {trainer.state.best_metric}")
    print(f"saved       {args.out}")
    if args.smoke:
        print("\nSMOKE RUN — R-8.3: do not evaluate or demo this checkpoint as a result.")
    else:
        print("\nNext: tools/export_onnx.py to quantize and check the 80 MB budget (M-4).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
