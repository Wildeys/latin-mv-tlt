"""Build frame → sentence realization pairs.

Sources:
  - tools/english_seed.txt (hand English lines)
  - tools/parallel_seed.txt (`latin | english`)
  - combinatorial expansion from a curated lemma list using Fritz-attested
    Māle endings (SOV, nu + verb, -gai locative, -ah dative, tense forms)

Does not copy old APE `grammar:` pairs or raw corpus paragraphs.
"""

from __future__ import annotations

import json
import random
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "realize"
SEED = ROOT / "tools" / "english_seed.txt"
PARALLEL = ROOT / "tools" / "parallel_seed.txt"
DICTIONARY = ROOT / "public" / "data" / "dictionary.json"

SUBJECTS = [
    ("I", "aharen"),
    ("you", "kaley"),
    ("he", "eyna"),
    ("she", "eyna"),
    ("we", "aharemen"),
    ("they", "emeehun"),
    ("the person", "meehaa"),
]

TIME_WORDS = {
    "today": "miadhu",
    "yesterday": "iyye",
    "tomorrow": "maadhamaa",
    "now": "adhu",
    "later": "fahun",
    "tonight": "mirey",
    "in the evening": "haveeru",
}

# `goal` is the dative (-ah) form and `locative` the -gai form. Three of the
# five entries used to carry a bare stem as `goal` ("Male", "addu",
# "hulhumale"), so most motion sentences taught the model to drop case marking
# entirely -- and "Male" was the only capitalised token in the whole Dhivehi
# corpus. `en` is the slot value the frame carries; `en_phrase` is the surface
# the English sentence uses, which is why Maldives/the Maldives differ.
LOCATIONS = [
    {
        "en": "Male",
        "en_phrase": "Male",
        "latin": "male",
        "goal": "maleah",
        "locative": "malegai",
        "motion_prep": "to",
        "stative_prep": "in",
    },
    {
        "en": "home",
        "en_phrase": "home",
        "latin": "ge",
        "goal": "geah",
        "locative": "gegai",
        "motion_prep": "",
        "stative_prep": "at",
    },
    {
        "en": "Maldives",
        "en_phrase": "the Maldives",
        "latin": "raajje",
        "goal": "raajjeah",
        "locative": "raajjegai",
        "motion_prep": "to",
        "stative_prep": "in",
    },
    {
        "en": "Addu",
        "en_phrase": "Addu",
        "latin": "addu",
        "goal": "adduah",
        "locative": "addugai",
        "motion_prep": "to",
        "stative_prep": "in",
    },
    {
        "en": "Hulhumale",
        "en_phrase": "Hulhumale",
        "latin": "hulhumale",
        "goal": "hulhumaleah",
        "locative": "hulhumalegai",
        "motion_prep": "to",
        "stative_prep": "in",
    },
]

OBJECTS = [
    {"en": "water", "latin": "fen", "article": False, "verbs": {"drink", "give", "take"}},
    {"en": "house", "latin": "ge", "article": True, "verbs": {"see", "find"}},
    {"en": "people", "latin": "meehun", "article": True, "verbs": {"see", "know", "find"}},
    {"en": "food", "latin": "kei", "article": False, "verbs": {"eat", "give", "buy"}},
    {"en": "book", "latin": "foiy", "article": True, "verbs": {"see", "give", "take", "buy", "find", "read", "write"}},
    {"en": "fish", "latin": "mas", "article": False, "verbs": {"eat", "take", "buy"}},
    {"en": "tea", "latin": "sai", "article": False, "verbs": {"drink", "give", "take", "buy"}},
    {"en": "car", "latin": "kaaru", "article": True, "verbs": {"see", "find", "buy", "take"}},
    {"en": "medicine", "latin": "beys", "article": False, "verbs": {"drink", "give", "take", "buy", "find"}},
    {"en": "language", "latin": "bas", "article": True, "verbs": {"know", "read", "write", "see"}},
    {"en": "road", "latin": "magu", "article": True, "verbs": {"see", "find", "know"}},
    {"en": "clock", "latin": "gadi", "article": True, "verbs": {"see", "find", "buy", "give", "take"}},
]

VERBS = {
    "go": {
        "kind": "motion",
        "latin": "dhaa",
        "present": "dhaa",
        "past": "dhiya",
        "future": "dhaanan",
        "en_past": "went",
        "en_third": "goes",
    },
    "come": {
        "kind": "motion",
        "latin": "ann",
        "present": "ann",
        "past": "ai",
        "future": "annan",
        "en_past": "came",
        "en_third": "comes",
    },
    "live": {
        "kind": "stative",
        "latin": "ulhun",
        "present": "ulee",
        "past": "huri",
        "future": "ulhanan",
        "en_past": "lived",
        "en_third": "lives",
    },
    "stay": {
        "kind": "stative",
        "latin": "huri",
        "present": "huri",
        "past": "huri",
        "future": "hunnanan",
        "en_past": "stayed",
        "en_third": "stays",
    },
    "walk": {
        "kind": "motion",
        "latin": "hingun",
        "present": "hingaa",
        "past": "hingai",
        "future": "hinganan",
        "en_past": "walked",
        "en_third": "walks",
    },
    "eat": {
        "kind": "object",
        "latin": "keun",
        "present": "key",
        "past": "kei",
        "future": "keyan",
        "en_past": "ate",
        "en_third": "eats",
    },
    "drink": {
        "kind": "object",
        "latin": "bonun",
        "present": "boni",
        "past": "bonifi",
        "future": "bonan",
        "en_past": "drank",
        "en_third": "drinks",
    },
    "see": {
        "kind": "object",
        "latin": "belun",
        "present": "balaa",
        "past": "belifi",
        "future": "belan",
        "en_past": "saw",
        "en_third": "sees",
    },
    "know": {
        "kind": "object",
        "latin": "engun",
        "present": "engey",
        "past": "engifi",
        "future": "engan",
        "en_past": "knew",
        "en_third": "knows",
    },
    "say": {
        "kind": "bare",
        "latin": "bunun",
        "present": "bunee",
        "past": "bunefi",
        "future": "bunan",
        "en_past": "said",
        "en_third": "says",
    },
    "give": {
        "kind": "object",
        "latin": "dhinun",
        "present": "dhey",
        "past": "dhinifi",
        "future": "dhinan",
        "en_past": "gave",
        "en_third": "gives",
    },
    "take": {
        "kind": "object",
        "latin": "gann",
        "present": "gann",
        "past": "ganifi",
        "future": "gannan",
        "en_past": "took",
        "en_third": "takes",
    },
    "buy": {
        "kind": "object",
        "latin": "gathun",
        "present": "gathaa",
        "past": "gathifi",
        "future": "gathan",
        "en_past": "bought",
        "en_third": "buys",
    },
    "find": {
        "kind": "object",
        "latin": "hoadhun",
        "present": "hoadhaa",
        "past": "hoadhifi",
        "future": "hoadhan",
        "en_past": "found",
        "en_third": "finds",
    },
    "read": {
        "kind": "object",
        "latin": "kiyun",
        "present": "kiyaa",
        "past": "kiyifi",
        "future": "kiyan",
        "en_past": "read",
        "en_third": "reads",
    },
    "write": {
        "kind": "object",
        "latin": "liyun",
        "present": "liyaa",
        "past": "liyifi",
        "future": "liyan",
        "en_past": "wrote",
        "en_third": "writes",
    },
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
    "stay": "huri",
    "walk": "hingun",
    "give": "dhinun",
    "take": "gann",
    "buy": "gathun",
    "find": "hoadhun",
    "read": "kiyun",
    "write": "liyun",
    "malé": "male",
    "male": "male",
    "the maldives": "raajje",
    "maldives": "raajje",
    "addu": "addu",
    "hulhumalé": "hulhumale",
    "hulhumale": "hulhumale",
    "today": "miadhu",
    "yesterday": "iyye",
    "tomorrow": "maadhamaa",
    "now": "adhu",
    "later": "fahun",
    "water": "fen",
    "house": "ge",
    "home": "ge",
    "people": "meehun",
    "food": "kei",
    "book": "foiy",
    "fish": "mas",
    "tea": "sai",
    "car": "kaaru",
    "medicine": "beys",
    "language": "bas",
    "road": "magu",
    "clock": "gadi",
    "tonight": "mirey",
    "in the evening": "haveeru",
    "the person": "meehaa",
    "person": "meehaa",
}

ACTION_EXTRACT = {
    "go": "go",
    "goes": "go",
    "going": "go",
    "went": "go",
    "come": "come",
    "comes": "come",
    "came": "come",
    "eat": "eat",
    "eats": "eat",
    "ate": "eat",
    "see": "see",
    "sees": "see",
    "saw": "see",
    "say": "say",
    "says": "say",
    "said": "say",
    "know": "know",
    "knows": "know",
    "knew": "know",
    "drink": "drink",
    "drinks": "drink",
    "drank": "drink",
    "live": "live",
    "lives": "live",
    "lived": "live",
    "stay": "stay",
    "stays": "stay",
    "stayed": "stay",
    "walk": "walk",
    "walks": "walk",
    "walked": "walk",
    "give": "give",
    "gives": "give",
    "gave": "give",
    "take": "take",
    "takes": "take",
    "took": "take",
    "buy": "buy",
    "buys": "buy",
    "bought": "buy",
    "find": "find",
    "finds": "find",
    "found": "find",
    "read": "read",
    "reads": "read",
    "write": "write",
    "writes": "write",
    "wrote": "write",
}

SUBJECT_SET = {"i", "you", "he", "she", "we", "they"}
TARGET_PER_DIRECTION = 3500


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
        # English has no `eve`, so English frames are always spoken register.
        # It is still emitted so the frame string matches the corpus exactly.
        "register": "spoken",
    }
    if any(t in {"not", "n't", "never"} or t.endswith("n't") for t in tokens):
        frame["polarity"] = "negative"
    if "will" in tokens or "gonna" in tokens:
        frame["tense"] = "future"
    elif any(t in {"did", "was", "were", "went", "saw", "ate", "came", "said", "knew", "drank", "lived"} for t in tokens):
        frame["tense"] = "past"
    for t in tokens:
        if t in SUBJECT_SET and not frame["subject"]:
            frame["subject"] = "I" if t == "i" else t
        if t in ACTION_EXTRACT and not frame["action"]:
            frame["action"] = ACTION_EXTRACT[t]
        if t in TIME_WORDS and not frame["time"]:
            frame["time"] = t
    joined = " ".join(tokens)
    # Longest name first, and match whole tokens. Substring matching on the
    # lowercased text made "Hulhumale" contain "male", so every Hulhumale
    # sentence was labelled LOCATION=Male. Slot values are plain ASCII so the
    # frame string matches the corpus exactly (Context/DATA.md).
    if "hulhumale" in tokens or "hulhumalé" in tokens:
        frame["location"] = "Hulhumale"
    elif "maldives" in tokens:
        frame["location"] = "Maldives"
    elif "male" in tokens or "malé" in tokens:
        frame["location"] = "Male"
    elif "addu" in tokens:
        frame["location"] = "Addu"
    elif "home" in tokens:
        frame["location"] = "home"
    for obj in OBJECTS:
        key = obj["en"]
        if key in tokens and not frame["object"]:
            frame["object"] = key
    if "house" in tokens and frame["location"] == "home":
        frame["object"] = "house"
        if "home" not in joined.replace("the house", ""):
            pass
    return frame


def serialize(frame: dict) -> str:
    order = ["subject", "action", "object", "location", "time", "tense", "polarity", "register"]
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


def third_person(subject: str) -> bool:
    return subject in {"he", "she", "it", "the person"}


def article(obj: dict) -> str:
    return f"the {obj['en']}" if obj["article"] else obj["en"]


def location_en(loc: dict, kind: str) -> str:
    phrase = loc.get("en_phrase", loc["en"])
    if loc["en"] == "home" and kind == "motion":
        return "home"
    prep = loc["motion_prep"] if kind == "motion" else loc["stative_prep"]
    if not prep:
        return phrase
    return f"{prep} {phrase}"


def realize_en(frame: dict, verb: dict, loc: dict | None, obj: dict | None) -> str:
    subject = frame["subject"]
    tense = frame["tense"]
    polarity = frame["polarity"]
    base = frame["action"]
    third = third_person(subject)

    if tense == "future":
        verb_phrase = f"{subject} will not {base}" if polarity == "negative" else f"{subject} will {base}"
    elif tense == "past":
        if polarity == "negative":
            verb_phrase = f"{subject} did not {base}"
        else:
            verb_phrase = f"{subject} {verb['en_past']}"
    else:
        if polarity == "negative":
            aux = "does" if third else "do"
            verb_phrase = f"{subject} {aux} not {base}"
        else:
            form = verb["en_third"] if third else base
            verb_phrase = f"{subject} {form}"

    bits = [verb_phrase]
    if obj:
        bits.append(article(obj))
    if loc:
        bits.append(location_en(loc, verb["kind"] if verb["kind"] in {"motion", "stative"} else "motion"))
    if frame.get("time"):
        bits.append(frame["time"])
    sentence = " ".join(bits).replace("  ", " ").strip()
    if not sentence:
        return ""
    return sentence[0].upper() + sentence[1:] + "."


def verb_form(verb: dict, tense: str) -> str:
    return verb[tense]


def realize_dv(frame: dict, verb: dict, loc: dict | None, obj: dict | None, eve: bool = False) -> str:
    words = [frame["subject"]]
    if loc:
        surface = loc["locative"] if verb["kind"] == "stative" else loc["goal"]
        words.append(surface)
    if obj:
        words.append(obj["latin"])
    if frame.get("time"):
        words.append(TIME_WORDS.get(frame["time"], frame["time"]))
    form = verb_form(verb, frame["tense"])
    if frame.get("polarity") == "negative":
        words.append("nu")
    words.append(form)
    if eve:
        words.append("eve")
    return " ".join(words)


# ACTION is a lemma and the target carries an inflected surface -- `go` is
# realised as "went", `dhaa` as "dhiya" -- so it cannot be substring-checked.
# The slots this guard exists for are the referential ones.
SLOT_SKIP = {"tense", "polarity", "register", "action"}


def slots_present(frame: dict, target: str, latin: bool) -> bool:
    """Reject a row whose sentence contradicts its own frame.

    Five English rows previously read `LOCATION=Male ... -> "They will go to
    Hulhumale."`, which teaches the model that the location slot is noise.
    """
    haystack = target.lower()
    for key, value in frame.items():
        if key in SLOT_SKIP or not isinstance(value, str) or not value:
            continue
        needle = value.lower()
        if latin:
            # Dhivehi surfaces are inflected: male -> maleah / malegai.
            needle = needle[: max(3, len(needle) - 2)]
        elif needle.startswith("the "):
            needle = needle[4:]
        if needle not in haystack:
            return False
    return True


def time_ok(tense: str, time: str | None) -> bool:
    if time is None:
        return True
    if time == "yesterday":
        return tense == "past"
    if time == "tomorrow" or time == "later":
        return tense == "future"
    if time == "now":
        return tense == "present"
    return True


def add_pair(store: dict[str, dict], direction: str, frame: dict, target: str) -> None:
    """One frame string maps to exactly one target.

    Keying on (input, target) used to let the same input appear twice with
    different sentences -- 107 of them, mostly the `eve` register variant --
    which the model cannot learn to predict. REGISTER now distinguishes them,
    so a residual collision is a generator bug and is dropped rather than
    silently trained on.
    """
    payload = {"input": serialize(frame), "target": target, "direction": direction}
    if not payload["target"]:
        return
    store.setdefault(payload["input"], payload)


def load_seed_sentences() -> list[str]:
    if not SEED.exists():
        return []
    return [line.strip() for line in SEED.read_text(encoding="utf-8").splitlines() if line.strip()]


def load_parallel() -> list[tuple[str, str]]:
    if not PARALLEL.exists():
        return []
    pairs = []
    for line in PARALLEL.read_text(encoding="utf-8").splitlines():
        if "|" not in line or not line.strip():
            continue
        latin, english = line.split("|", 1)
        latin, english = latin.strip(), english.strip()
        if latin and english:
            pairs.append((latin, english))
    return pairs


def confirm_lemmas() -> set[str]:
    if not DICTIONARY.exists():
        return set()
    data = json.loads(DICTIONARY.read_text(encoding="utf-8"))
    return {str(row.get("latin") or "").strip().lower() for row in data}


def combinatorial_pairs() -> tuple[dict[str, dict], dict[str, dict], list[dict]]:
    en_store: dict[str, dict] = {}
    dv_store: dict[str, dict] = {}
    rejected: list[dict] = []
    times = [None, "today", "yesterday", "tomorrow", "now", "later", "tonight", "in the evening"]

    for en_subj, dv_subj in SUBJECTS:
        for action, verb in VERBS.items():
            for tense in ("present", "past", "future"):
                for polarity in ("affirmative", "negative"):
                    if verb["kind"] in {"motion", "stative"}:
                        complements = [(loc, None) for loc in LOCATIONS]
                    elif verb["kind"] == "object":
                        complements = [
                            (None, obj) for obj in OBJECTS if action in obj["verbs"]
                        ]
                    else:
                        complements = [(None, None)]

                    for loc, obj in complements:
                        for time in times:
                            if not time_ok(tense, time):
                                continue
                            en_frame = {
                                "subject": en_subj,
                                "action": action,
                                "object": obj["en"] if obj else None,
                                "location": loc["en"] if loc else None,
                                "time": time,
                                "tense": tense,
                                "polarity": polarity,
                                "register": "spoken",
                            }
                            dv_frame = {
                                "subject": dv_subj,
                                "action": verb["latin"],
                                "object": obj["latin"] if obj else None,
                                "location": loc["latin"] if loc else None,
                                "time": TIME_WORDS[time] if time else None,
                                "tense": tense,
                                "polarity": polarity,
                                "register": "spoken",
                            }
                            en_target = realize_en(en_frame, verb, loc, obj)
                            dv_target = realize_dv(dv_frame, verb, loc, obj)
                            if slots_present(en_frame, en_target, latin=False):
                                add_pair(en_store, "en", en_frame, en_target)
                            else:
                                rejected.append({"direction": "en", "input": serialize(en_frame), "target": en_target})
                            if slots_present(dv_frame, dv_target, latin=True):
                                add_pair(dv_store, "dv", dv_frame, dv_target)
                            else:
                                rejected.append({"direction": "dv", "input": serialize(dv_frame), "target": dv_target})
                            if polarity == "affirmative" and tense == "past" and not time:
                                # Written register: the sentence ends in `eve`.
                                # This used to share the affirmative frame
                                # string, so one input carried two targets and
                                # the model could not tell when to emit `eve`.
                                written = {**dv_frame, "register": "written"}
                                add_pair(
                                    dv_store,
                                    "dv",
                                    written,
                                    realize_dv(written, verb, loc, obj, eve=True),
                                )
    return en_store, dv_store, rejected


def split_write(pairs: list[dict], prefix: str) -> tuple[int, int]:
    """Split by frame string, not by row offset.

    Slicing a shuffled list let duplicate inputs straddle the cut, so 21
    Dhivehi and 2 English frame strings appeared in both train and valid.
    Grouping first makes leakage impossible by construction.
    """
    groups: dict[str, list[dict]] = {}
    for pair in pairs:
        groups.setdefault(pair["input"], []).append(pair)
    keys = list(groups)
    random.Random(11).shuffle(keys)
    cut = max(1, int(len(keys) * 0.9))
    train = [row for key in keys[:cut] for row in groups[key]]
    valid = [row for key in keys[cut:] for row in groups[key]]
    if not valid:
        valid = train[-1:]
    (OUT / f"{prefix}_train.jsonl").write_text(
        "\n".join(json.dumps(p, ensure_ascii=False) for p in train) + "\n",
        encoding="utf-8",
    )
    (OUT / f"{prefix}_valid.jsonl").write_text(
        "\n".join(json.dumps(p, ensure_ascii=False) for p in valid) + "\n",
        encoding="utf-8",
    )
    return len(train), len(valid)


def collect(store: dict[str, dict], keep_first: list[dict]) -> list[dict]:
    """Seed rows first, then the whole combinatorial pool.

    There used to be a TARGET_PER_DIRECTION = 3500 cap here that silently
    dropped 2,140 English and 1,435 Dhivehi valid pairs. Nothing justified the
    number, so the pool is taken whole and the counts are reported.
    """
    seen: set[str] = set()
    chosen: list[dict] = []
    for item in keep_first:
        if item["input"] in seen or not item["target"]:
            continue
        seen.add(item["input"])
        chosen.append(item)
    for key, item in store.items():
        if key in seen:
            continue
        seen.add(key)
        chosen.append(item)
    random.Random(7).shuffle(chosen)
    return chosen


def main() -> None:
    lemmas = confirm_lemmas()
    curated = [v["latin"] for v in VERBS.values()]
    curated += [o["latin"] for o in OBJECTS] + [l["latin"] for l in LOCATIONS]
    curated += [dv for _, dv in SUBJECTS] + list(TIME_WORDS.values())
    missing = sorted({item for item in curated if lemmas and item not in lemmas})
    en_store, dv_store, rejected = combinatorial_pairs()

    seed_kept: list[dict] = []
    dv_kept: list[dict] = []
    for sentence in load_seed_sentences():
        frame = extract_en(sentence)
        seed_kept.append({"input": serialize(frame), "target": sentence, "direction": "en"})
        latin = map_latin(frame)
        verb = VERBS.get(frame.get("action") or "", None)
        # Match on the frame's own location. The old `or item["latin"] == ...`
        # could match a different LOCATIONS row than the frame named, which is
        # how "LOCATION=Male" ended up paired with a Hulhumale sentence.
        loc = next((item for item in LOCATIONS if item["en"] == frame.get("location")), None)
        obj = next((item for item in OBJECTS if item["en"] == frame.get("object")), None)
        if verb:
            dv_kept.append(
                {
                    "input": serialize(latin),
                    "target": realize_dv(latin, verb, loc, obj),
                    "direction": "dv",
                }
            )

    for latin_line, english in load_parallel():
        frame = extract_en(english)
        latin = map_latin(frame)
        latin["register"] = "written" if latin_line.split()[-1:] == ["eve"] else "spoken"
        if slots_present(frame, english, latin=False):
            seed_kept.append({"input": serialize(frame), "target": english, "direction": "en"})
        else:
            rejected.append({"direction": "en", "input": serialize(frame), "target": english})
        if slots_present(latin, latin_line, latin=True):
            dv_kept.append({"input": serialize(latin), "target": latin_line, "direction": "dv"})
        else:
            rejected.append({"direction": "dv", "input": serialize(latin), "target": latin_line})

    en_pairs = collect(en_store, seed_kept)
    dv_pairs = collect(dv_store, dv_kept)

    OUT.mkdir(parents=True, exist_ok=True)
    en_train, en_valid = split_write(en_pairs, "en")
    dv_train, dv_valid = split_write(dv_pairs, "dv")

    pair_stats = {
        "englishPairs": len(en_pairs),
        "englishTrain": en_train,
        "englishValid": en_valid,
        "dhivehiPairs": len(dv_pairs),
        "dhivehiTrain": dv_train,
        "dhivehiValid": dv_valid,
        "combinatorialEnglish": len(en_store),
        "combinatorialDhivehi": len(dv_store),
        "englishSeedLines": len(load_seed_sentences()),
        "parallelLines": len(load_parallel()),
        "missingCuratedLemmas": missing,
        "rejectedSlotMismatch": len(rejected),
        "slotVocabulary": {
            "subjects": len(SUBJECTS),
            "verbs": len(VERBS),
            "objects": len(OBJECTS),
            "locations": len(LOCATIONS),
            "times": len(TIME_WORDS),
        },
    }
    if rejected:
        (OUT / "rejected.jsonl").write_text(
            "\n".join(json.dumps(r, ensure_ascii=False) for r in rejected) + "\n",
            encoding="utf-8",
        )
    (OUT / "stats.json").write_text(
        json.dumps(pair_stats, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("Frame pair builder")
    for key, value in pair_stats.items():
        print(f"  {key}: {value}")
    print(f"  Wrote {OUT}")


if __name__ == "__main__":
    main()
