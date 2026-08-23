"""Fine-tune t5-small for frame → sentence realization.

Designed for Colab or a local GPU. CPU works but is slow.

Example:

    python tools/train_t5_realize.py --train data/realize/en_train.jsonl --valid data/realize/en_valid.jsonl --out models/en_realize

Then push the folder to Hugging Face and set VITE_EN_REALIZE_MODEL.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from torch.utils.data import Dataset
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer, Trainer, TrainingArguments


class FrameDataset(Dataset):
    def __init__(self, path: Path, tokenizer, max_len: int = 128):
        self.rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        self.tokenizer = tokenizer
        self.max_len = max_len

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, idx):
        row = self.rows[idx]
        source = self.tokenizer(row["input"], truncation=True, padding="max_length", max_length=self.max_len)
        target = self.tokenizer(row["target"], truncation=True, padding="max_length", max_length=self.max_len)
        labels = target["input_ids"]
        labels = [token if token != self.tokenizer.pad_token_id else -100 for token in labels]
        return {
            "input_ids": torch.tensor(source["input_ids"]),
            "attention_mask": torch.tensor(source["attention_mask"]),
            "labels": torch.tensor(labels),
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", required=True)
    parser.add_argument("--valid", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--model", default="t5-small")
    parser.add_argument("--epochs", type=float, default=3)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--smoke", action="store_true")
    args = parser.parse_args()

    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForSeq2SeqLM.from_pretrained(args.model)
    train_ds = FrameDataset(Path(args.train), tokenizer)
    valid_ds = FrameDataset(Path(args.valid), tokenizer)
    if args.smoke:
        train_ds.rows = train_ds.rows[:64]
        valid_ds.rows = valid_ds.rows[:16]

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    training = TrainingArguments(
        output_dir=str(out / "runs"),
        num_train_epochs=1 if args.smoke else args.epochs,
        per_device_train_batch_size=args.batch,
        per_device_eval_batch_size=args.batch,
        eval_strategy="epoch",
        save_strategy="epoch",
        learning_rate=5e-5,
        fp16=torch.cuda.is_available(),
        report_to=[],
    )
    trainer = Trainer(
        model=model,
        args=training,
        train_dataset=train_ds,
        eval_dataset=valid_ds,
        processing_class=tokenizer,
    )
    trainer.train()
    trainer.save_model(str(out))
    tokenizer.save_pretrained(str(out))
    print(f"Saved realization model to {out}")


if __name__ == "__main__":
    main()
