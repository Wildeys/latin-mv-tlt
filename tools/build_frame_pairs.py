"""Build frame → sentence realization pairs.

English pairs come from a monolingual seed plus the same rule-based analyzer
the browser uses (ported here in Python). Dhivehi Latin pairs come from
dictionary roots + suffix generation.

Usage:
    python tools/build_frame_pairs.py
"""

from __future__ import annotations

import json
import random
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "realize"
SEED = ROOT / "tools" / "english_seed.txt"

SUBJECTS = {"i", "you", "he", "she", "we", "they", "it"}
TIME_WORDS = {"today", "yesterday", "tomorrow", "now", "later", "tonight"}
ACTION = {
    "go": "go",
    "goes": "go",
    "going": "go",
    "went": "go",
    "come": "come",
    "came": "come",
    "eat": "eat",
    "ate": "eat",
    "see": "see",
    "saw": "see",
    "say": "say",
    "said": "say",
    "know": "know",
    "drink": "drink",
    "live": "live",
}
EN_TO_LATIN = {
    "i": "aharen",
    "you": "kaley",
    "he": "eyna",
    "she": "eyna",
    "we": "aharemen",
    "they": "emeehun",
    "go": "dhaa",
    "come": "ann",
    "eat": "keun",
    "see": "belun",
    "say": "bunun",
    "know": "engun",
    "drink": "bonun",
    "live": "ulhun",
    "malé": "male",
    "male": "male",
    "today": "miadhu",
    "yesterday": "iyye",
    "tomorrow": "maadhamaa",
    "water": "fen",
    "house": "ge",
}

FUTURE_DV = {
    "dhaa": "dhaanan",
    "ann": "annan",
    "keun": "keyan",
    "belun": "belan",
    "bunun": "bunan",
}


def tokenize(text: str) -> list[str]:
    return [t for t in re.split(r"[^A-Za-z0-9áéíóú'-]+", text.lower()) if t]


def extract_en(text: str) -> dict:
    tokens = tokenize(text)
    frame = {
        "subject": None,
        "action": None,
        "object": None,
        "location": None,
        "time": None,
        "tense": "present",
        "polarity": "affirmative",
    }
    if any(t in {"not", "n't", "never"} or t.endswith("n't") for t in tokens):
        frame["polarity"] = "negative"
    if "will" in tokens or "gonna" in tokens:
        frame["tense"] = "future"
    elif any(t in {"did", "was", "were", "went", "saw", "ate", "came"} for t in tokens):
        frame["tense"] = "past"
    for t in tokens:
        if t in SUBJECTS and not frame["subject"]:
            frame["subject"] = "I" if t == "i" else t
        if t in ACTION and not frame["action"]:
            frame["action"] = ACTION[t]
        if t in TIME_WORDS:
            frame["time"] = t
    for i, t in enumerate(tokens):
        if t in {"to", "in", "at"} and i + 1 < len(tokens) and tokens[i + 1] not in ACTION:
            loc = tokens[i + 1]
            frame["location"] = "Malé" if loc in {"male", "malé"} else loc.capitalize()
            break
    return frame


def serialize(frame: dict) -> str:
    order = ["subject", "action", "object", "location", "time", "tense", "polarity"]
    parts = []
    for key in order:
        value = frame.get(key)
        if value:
            parts.append(f"{key.upper()}={value}")
    return " | ".join(parts)


def map_latin(frame: dict) -> dict:
    mapped = {}
    for key, value in frame.items():
        if key in {"tense", "polarity"}:
            mapped[key] = value
        elif isinstance(value, str):
            mapped[key] = EN_TO_LATIN.get(value.lower(), value.lower())
        else:
            mapped[key] = value
    return mapped


def realize_dv(frame: dict) -> str:
    words = []
    if frame.get("subject"):
        words.append(frame["subject"])
    if frame.get("location"):
        words.append(frame["location"])
    if frame.get("time"):
        words.append(frame["time"])
    action = frame.get("action")
    if action:
        if frame.get("tense") == "future":
            words.append(FUTURE_DV.get(action, action + "nan"))
        else:
            words.append(action)
    if frame.get("polarity") == "negative" and words:
        words[-1] = "nu" + words[-1]
    return " ".join(words)


DEFAULT_SEED = """I will go to Male.
I go to Male.
He went to Male yesterday.
We will drink water.
They live in Male.
She did not go today.
You will come tomorrow.
I eat at home.
I saw the house.
We know the people.
"""


def main() -> None:
    seed_text = SEED.read_text(encoding="utf-8") if SEED.exists() else DEFAULT_SEED
    sentences = [line.strip() for line in seed_text.splitlines() if line.strip()]
    en_pairs = []
    dv_pairs = []
    for sentence in sentences:
        frame = extract_en(sentence)
        en_pairs.append({"input": serialize(frame), "target": sentence, "direction": "en"})
        latin = map_latin(frame)
        dv_pairs.append(
            {"input": serialize(latin), "target": realize_dv(latin), "direction": "dv"}
        )

    random.seed(7)
    random.shuffle(en_pairs)
    random.shuffle(dv_pairs)
    OUT.mkdir(parents=True, exist_ok=True)

    def split_write(pairs: list[dict], prefix: str) -> None:
        cut = max(1, int(len(pairs) * 0.9))
        train, valid = pairs[:cut], pairs[cut:] or pairs[-1:]
        (OUT / f"{prefix}_train.jsonl").write_text(
            "\n".join(json.dumps(p, ensure_ascii=False) for p in train) + "\n",
            encoding="utf-8",
        )
        (OUT / f"{prefix}_valid.jsonl").write_text(
            "\n".join(json.dumps(p, ensure_ascii=False) for p in valid) + "\n",
            encoding="utf-8",
        )

    split_write(en_pairs, "en")
    split_write(dv_pairs, "dv")
    print(f"English pairs: {len(en_pairs)}")
    print(f"Dhivehi Latin pairs: {len(dv_pairs)}")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
