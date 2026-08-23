"""Score pipeline outputs against evaluation/gold_sentences.json once a model exists.

Until realization models are loaded this script can still print frame strings
by calling the pair builder's extractor. It does not invent BLEU numbers.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_frame_pairs import extract_en, serialize

ROOT = Path(__file__).resolve().parents[1]
GOLD = ROOT / "evaluation" / "gold_sentences.json"


def main() -> None:
    gold = json.loads(GOLD.read_text(encoding="utf-8"))
    print(gold.get("notes", ""))
    print("\nEN gold frames (rule extractor, not model output):")
    for item in gold.get("en_dv", []):
        frame = extract_en(item["source"])
        print(f"  {item['source']}")
        print(f"    frame: {serialize(frame)}")
        print(f"    reference: {item['reference']}")
    print("\nBLEU/chrF: not measured. Realization model is not part of this script.")


if __name__ == "__main__":
    main()
