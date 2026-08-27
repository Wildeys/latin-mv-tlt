import { transliterateThaana } from '../transliterator/thaanaToLatin';

const THAANA = /[ހ-޿]/;
const PUNCTUATION = /[.,;:!?()[\]{}"'،؛؟ـ۔]/;
/**
 * Token classes, longest-first within each alternative.
 *
 * `\d+(?:[.,]\d+)+` precedes bare `\d+` so `3.14` and `1,000` survive as one
 * token, which R-5.8 requires. Before this, `tokenizeWords('3.14')` returned `['3', '.', '14']`, which
 * put a bare `.` into the word list and made the number unrecoverable downstream.
 *
 * The Latin class carries the accented vowels because Malé Latin place names
 * (`Malé`, `Hulhumalé`) arrive unfolded from an English source; folding happens
 * at the transliterator edge, not here.
 */
const WORD =
  /([ހ-޿]+|[a-zA-ZÁÉÍÓÚáéíóú]+(?:['-][a-zA-ZÁÉÍÓÚáéíóú]+)*|\d+(?:[.,]\d+)+|\d+|[.,;:!?()[\]{}"'،؛؟ـ۔])/g;

/** A token that is a word rather than punctuation or a bare number (R-5.8). */
const WORD_TOKEN = /^(?:[ހ-޿]+|[a-zA-ZÁÉÍÓÚáéíóú]+(?:['-][a-zA-ZÁÉÍÓÚáéíóú]+)*)$/;

/**
 * English abbreviations whose full stop is not a sentence boundary.
 *
 * Deliberately short and English-only: Dhivehi terminates with `۔` (U+06D4) and
 * does not use `.`-abbreviations, so a Dhivehi list would be inventing a problem.
 * Matching is case-insensitive on the letters before the stop.
 */
const ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr', 'st', 'rev', 'hon', 'gen', 'col',
  'capt', 'sgt', 'vs', 'etc', 'no', 'nos', 'fig', 'vol', 'pp', 'approx', 'dept',
  'univ', 'inc', 'ltd', 'co', 'est', 'min', 'max', 'al',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sept', 'sep', 'oct', 'nov', 'dec',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
]);

/** `e.g.`, `i.e.`, `U.S.`, `a.m.` — a run of single letters each followed by a stop. */
const DOTTED_INITIALISM = /(?:^|[\s("'])(?:[A-Za-z]\.){1,}$/;
const CAPITAL_INITIAL = /(?:^|[\s("'])[A-Z]\.$/;
/**
 * Sentence terminators, script-aware (R-5.7).
 *
 * `۔` (۔, Arabic full stop) is used in Dhivehi text and was previously not
 * a boundary at all, so a whole Thaana paragraph arrived at the model as one
 * "sentence". `؟` is the Arabic question mark.
 */
const SENTENCE_END = /[.!?؟۔]/;
/** Closing marks that belong to the sentence they follow, not the next one. */
const TRAILING_CLOSER = /["'’”)\]»]/;
/** A segment worth translating contains at least one letter or digit. */
const HAS_CONTENT = /[\p{L}\p{N}]/u;
const LATIN_LETTER = /[a-zA-Z]/;
const DIGIT = /\d/;
const WHITESPACE = /\s/;

export function tokenizeWords(text: string): string[] {
  const cleaned = text.trim().replace(/\s+/g, ' ');
  return [...cleaned.matchAll(WORD)].map((m) => m[0]).filter((t) => t.trim());
}

/**
 * Split text into sentences, deterministically and script-aware (R-5.7).
 *
 * Under v0.1 this fed a rule-based frame extractor and a bad split was merely
 * untidy. Under v0.2 each segment costs one model inference, so the previous
 * implementation's habit of emitting bare `"."` fragments — `"a... b"` came back
 * as `["a.", ".", ".", "b"]` — is now a correctness *and* a cost problem: three
 * of those four segments contain nothing to translate, and each would be
 * prefixed and pushed through the decoder.
 *
 * Three rules, in the order they matter:
 *   1. A run of terminators (`...`, `?!`) is one boundary, not one per mark.
 *   2. Closing quotes and brackets stay with the sentence they close.
 *   3. A segment with no letter or digit is never emitted.
 *
 * Line breaks are hard boundaries: a newline ends a sentence whether or not it
 * is punctuated, which is how headline-and-body text actually arrives.
 *
 * Two further exceptions were added once the abbreviation lexicon existed
 * (R-5.7). Both suppress the boundary rather than move it:
 *
 *   - a `.` between two digits is a decimal point, so `3.14 is pi.` is one
 *     sentence and not `['3.', '14 is pi.']`;
 *   - a `.` closing a known abbreviation, a capitalised initial (`J. Smith`) or a
 *     dotted initialism (`e.g.`, `U.S.`) does not end the sentence.
 *
 * Both are checked only when the next character is *not* itself a terminator, so
 * a run like `a... b` still splits on the run rule above and is unaffected. The
 * initial rule requires a capital, which is what keeps lowercase `a.` splitting.
 */
/** `3.14` — a stop flanked by digits is a decimal point, not a boundary. */
function isDecimalPoint(text: string, i: number): boolean {
  return DIGIT.test(text[i - 1] ?? '') && DIGIT.test(text[i + 1] ?? '');
}

/**
 * True when the `.` just appended to `current` closes an abbreviation rather than
 * a sentence. `current` ends with that stop.
 */
function closesAbbreviation(current: string): boolean {
  if (DOTTED_INITIALISM.test(current) || CAPITAL_INITIAL.test(current)) return true;
  const word = /([A-Za-z]+)\.$/.exec(current);
  return word ? ABBREVIATIONS.has(word[1].toLowerCase()) : false;
}

export function segmentSentences(text: string): string[] {
  if (!text) return [];

  const result: string[] = [];
  let current = '';

  const flush = () => {
    const trimmed = current.trim();
    if (HAS_CONTENT.test(trimmed)) result.push(trimmed);
    current = '';
  };

  let i = 0;
  const n = text.length;

  while (i < n) {
    const char = text[i];

    if (char === '\n' || char === '\r') {
      flush();
      i += 1;
      continue;
    }

    current += char;

    if (SENTENCE_END.test(char)) {
      // A `.` that is not part of a terminator run may still belong to the
      // sentence rather than end it. `char` is already appended to `current`.
      if (char === '.' && !SENTENCE_END.test(text[i + 1] ?? '')) {
        if (isDecimalPoint(text, i) || closesAbbreviation(current)) {
          i += 1;
          continue;
        }
      }

      let j = i + 1;
      while (j < n && SENTENCE_END.test(text[j])) current += text[j++];
      while (j < n && TRAILING_CLOSER.test(text[j])) current += text[j++];
      flush();
      i = j;
      continue;
    }

    i += 1;
  }

  flush();
  return result;
}

/**
 * The single word tokenizer for the whole system (R-5.8).
 *
 * Both pipeline directions route through this. `enToDv` previously split English
 * on its own `/[^A-Za-z…'-]+/` regex, so the Breakdown's dictionary panel could
 * show a different word list than the one that was actually analysed — the same
 * sentence tokenized two ways in two places.
 *
 * The previous filter was `/^[a-zA-Z]+$/`, which silently dropped every
 * contraction and hyphenated form: `don't` and `well-known` tokenize as one token
 * each and were then discarded, so they never reached the lexicon at all.
 */
export function extractWordsOnly(text: string): string[] {
  return tokenizeWords(text).filter((token) => WORD_TOKEN.test(token));
}

/**
 * Single pass over the string. The previous implementation rebuilt five RegExp
 * objects and materialised five match arrays per call, once per sentence.
 */
export function identifyScript(text: string): Record<string, number> {
  if (!text) return {};
  let thaana = 0;
  let latin = 0;
  let digits = 0;
  let punctuation = 0;
  let whitespace = 0;
  for (const char of text) {
    if (THAANA.test(char)) thaana += 1;
    else if (LATIN_LETTER.test(char)) latin += 1;
    else if (DIGIT.test(char)) digits += 1;
    else if (WHITESPACE.test(char)) whitespace += 1;
    if (PUNCTUATION.test(char)) punctuation += 1;
  }
  const total = text.length;
  return {
    thaana: (thaana / total) * 100,
    latin: (latin / total) * 100,
    digits: (digits / total) * 100,
    punctuation: (punctuation / total) * 100,
    whitespace: (whitespace / total) * 100,
  };
}

export function hasThaana(text: string): boolean {
  return THAANA.test(text);
}

export function prepareSentence(sentence: string) {
  const words = extractWordsOnly(sentence);
  const script = identifyScript(sentence);
  const isThaana = (script.thaana ?? 0) > 0;
  const transliterated = isThaana ? transliterateThaana(sentence) : sentence;
  return {
    original: sentence,
    words,
    latinWords: isThaana ? extractWordsOnly(transliterated) : words,
    script,
    transliterated,
  };
}
