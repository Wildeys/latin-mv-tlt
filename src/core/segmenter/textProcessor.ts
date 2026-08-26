import { transliterateThaana } from '../transliterator/thaanaToLatin';

const THAANA = /[\u0780-\u07BF]/;
const PUNCTUATION = /[.,;:!?()[\]{}"'\u060C\u061B\u061F\u0640\u06D4]/;
const WORD = /([\u0780-\u07BF]+|[a-zA-Z]+(?:['-][a-zA-Z]+)*|\d+|[.,;:!?()[\]{}"'\u060C\u061B\u061F\u0640\u06D4])/g;
/**
 * Sentence terminators, script-aware (R-5.7).
 *
 * `\u06D4` (\u06D4, Arabic full stop) is used in Dhivehi text and was previously not
 * a boundary at all, so a whole Thaana paragraph arrived at the model as one
 * "sentence". `\u061F` is the Arabic question mark.
 */
const SENTENCE_END = /[.!?\u061F\u06D4]/;
/** Closing marks that belong to the sentence they follow, not the next one. */
const TRAILING_CLOSER = /["'\u2019\u201D)\]\u00BB]/;
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
 * implementation's habit of emitting bare `"."` fragments \u2014 `"a... b"` came back
 * as `["a.", ".", ".", "b"]` \u2014 is now a correctness *and* a cost problem: three
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
 * Abbreviations (`Dr. Smith`) and decimals (`3.14`) are deliberately still split
 * \u2014 see Context/STATUS.md. Fixing those needs an abbreviation lexicon and is out
 * of scope for this change.
 */
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

export function extractWordsOnly(text: string): string[] {
  return tokenizeWords(text).filter(
    (token) => THAANA.test(token[0] ?? '') || /^[a-zA-Z]+$/.test(token),
  );
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
