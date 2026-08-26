"""Python side of the transliterator bridge (R-2.2).

Speaks NDJSON to `tools/transliterate.mjs`, which wraps the project's own
TypeScript transliterator. See that file for why the bridge exists rather than a
Python port: a second implementation of the rules would drift silently, and the
symptom would be a worse BLEU score months later rather than an error.

Usage:

    from _transliterate_bridge import Transliterator

    with Transliterator() as tr:
        latin = tr.thaana_to_latin("އަހަރެން")
        rows  = tr.thaana_to_latin_many([...])   # batched, keeps order
        print(tr.sha256)                          # record in corpus_stats.json

The process is long-lived. Spawning node per row would dominate a ~92k-pair
build; `thaana_to_latin_many` writes a whole batch before reading any reply so
the pipe stays full.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "transliterate.mjs"

# Big enough to keep node busy, small enough that neither pipe buffer fills and
# deadlocks (we write a batch, then read exactly that many replies).
BATCH = 512


class TransliteratorError(RuntimeError):
    pass


class Transliterator:
    """A live `node tools/transliterate.mjs` process."""

    def __init__(self, node: str = "node") -> None:
        if not SCRIPT.exists():
            raise TransliteratorError(f"missing {SCRIPT}")
        try:
            self.proc = subprocess.Popen(
                [node, str(SCRIPT)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=None,  # let node's errors reach the terminal
                text=True,
                encoding="utf-8",
                bufsize=1,
                cwd=str(ROOT),
            )
        except FileNotFoundError as exc:  # noqa: TRY003
            raise TransliteratorError(
                f"could not start {node!r}. The bridge needs Node.js; "
                "that is why the corpus build runs locally rather than on Colab."
            ) from exc

        handshake = self._readline()
        ready = json.loads(handshake)
        if not ready.get("ready"):
            raise TransliteratorError(f"unexpected handshake: {handshake!r}")

        #: SHA-256 of the bundled transliterator source. Record this in the
        #: corpus stats so it is always answerable which revision of the rules
        #: produced a given corpus (R-2.7).
        self.sha256: str = ready["sha256"]

    # ---------------------------------------------------------------- plumbing

    def _readline(self) -> str:
        line = self.proc.stdout.readline()
        if not line:
            code = self.proc.poll()
            raise TransliteratorError(
                f"transliterate.mjs exited (code {code}) mid-stream. "
                "Corpus output would be incomplete; not continuing."
            )
        return line

    def _roundtrip(self, requests: list[dict]) -> list[dict]:
        if not requests:
            return []
        payload = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in requests)
        try:
            self.proc.stdin.write(payload)
            self.proc.stdin.flush()
        except BrokenPipeError as exc:  # noqa: TRY003
            raise TransliteratorError("transliterate.mjs closed its stdin") from exc

        out: dict[int, dict] = {}
        for _ in requests:
            reply = json.loads(self._readline())
            out[reply["id"]] = reply
        # Replies come back in order, but key by id so a future async node
        # implementation cannot silently misalign the corpus.
        return [out[r["id"]] for r in requests]

    # ------------------------------------------------------------------- api

    def thaana_to_latin(self, text: str) -> str:
        return self.thaana_to_latin_many([text])[0]

    def latin_to_thaana(self, text: str) -> str:
        return self.latin_to_thaana_many([text])[0][0]

    def thaana_to_latin_many(self, texts: Iterable[str]) -> list[str]:
        texts = list(texts)
        out: list[str] = []
        for start in range(0, len(texts), BATCH):
            chunk = texts[start : start + BATCH]
            replies = self._roundtrip(
                [{"id": i, "mode": "th2la", "text": t} for i, t in enumerate(chunk)]
            )
            for reply, source in zip(replies, chunk):
                if "error" in reply:
                    raise TransliteratorError(f"{source!r}: {reply['error']}")
                out.append(reply["latin"])
        return out

    def latin_to_thaana_many(self, texts: Iterable[str]) -> list[tuple[str, list[str]]]:
        """Returns (thaana, preserved) per input. `preserved` is R-1.3's channel."""
        texts = list(texts)
        out: list[tuple[str, list[str]]] = []
        for start in range(0, len(texts), BATCH):
            chunk = texts[start : start + BATCH]
            replies = self._roundtrip(
                [{"id": i, "mode": "la2th", "text": t} for i, t in enumerate(chunk)]
            )
            for reply, source in zip(replies, chunk):
                if "error" in reply:
                    raise TransliteratorError(f"{source!r}: {reply['error']}")
                out.append((reply["thaana"], reply.get("preserved", [])))
        return out

    # --------------------------------------------------------------- lifecycle

    def close(self) -> None:
        if self.proc.poll() is None:
            try:
                self.proc.stdin.close()
            except (BrokenPipeError, ValueError):
                pass
            self.proc.wait(timeout=10)

    def __enter__(self) -> "Transliterator":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()


def load_prefixes(node: str = "node") -> dict[str, str]:
    """The canonical T5 task prefixes, read from src/core/translate/prefixes.ts.

    Read rather than hardcoded so the corpus and the running app cannot disagree
    about the prefix literal (R-2.5). Two characters of drift here degrade the
    model with no error anywhere.
    """
    result = subprocess.run(
        [node, str(SCRIPT), "--prefixes"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=str(ROOT),
    )
    if result.returncode != 0:
        raise TransliteratorError(f"--prefixes failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


if __name__ == "__main__":
    with Transliterator() as tr:
        print(f"transliterator sha256: {tr.sha256}", file=sys.stderr)
        print(f"prefixes: {load_prefixes()}", file=sys.stderr)
        for line in sys.stdin:
            print(tr.thaana_to_latin(line.rstrip("\n")))
