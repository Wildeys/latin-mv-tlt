/**
 * The canonical T5 task prefixes (R-2.5).
 *
 * This file is the single source of truth for both halves of the system:
 *
 *   - the browser pipeline imports these constants directly;
 *   - the Python corpus builder reads them via `node tools/transliterate.mjs --prefixes`.
 *
 * That matters because R-2.5 requires the direction to be explicit at training
 * time *and* at inference time. If the corpus is built with one literal and the
 * app prompts with another, the model sees an unfamiliar prefix at inference and
 * silently degrades — there is no error, just worse output. Hardcoding the
 * strings in `build_translation_pairs.py` would make that drift possible, so it
 * is deliberately not done.
 *
 * The trailing `": "` is part of the prefix. T5's convention is
 * `"<task>: <input>"`, and the spec text for R-2.5 omits the separator; two
 * characters of disagreement between corpus and runtime is exactly the failure
 * described above.
 */

export const DV_EN_PREFIX = 'translate Dhivehi Latin to English: ';
export const EN_DV_PREFIX = 'translate English to Dhivehi Latin: ';

export type TranslationDirection = 'dv-en' | 'en-dv';

/** The prefix for a direction. Kept as a function so callers cannot typo a key. */
export function prefixFor(direction: TranslationDirection): string {
  return direction === 'dv-en' ? DV_EN_PREFIX : EN_DV_PREFIX;
}

/** Build the exact string handed to the model. */
export function buildModelInput(direction: TranslationDirection, source: string): string {
  return prefixFor(direction) + source;
}

/** Shape emitted by `tools/transliterate.mjs --prefixes`, consumed by Python. */
export const PREFIXES = {
  'dv-en': DV_EN_PREFIX,
  'en-dv': EN_DV_PREFIX,
} as const;
