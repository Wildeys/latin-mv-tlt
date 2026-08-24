import { transliterateThaana } from '../transliterator/thaanaToLatin';

const THAANA = /[\u0780-\u07BF]/;
const PUNCTUATION = /[.,;:!?()[\]{}"'\u060C\u061B\u061F\u0640]/;
const WORD = /([\u0780-\u07BF]+|[a-zA-Z]+(?:['-][a-zA-Z]+)*|\d+|[.,;:!?()[\]{}"'\u060C\u061B\u061F\u0640])/g;
const SENTENCE_END = /[.!?\u061F]/;
const LATIN_LETTER = /[a-zA-Z]/;
const DIGIT = /\d/;
const WHITESPACE = /\s/;

export function tokenizeWords(text: string): string[] {
  const cleaned = text.trim().replace(/\s+/g, ' ');
  return [...cleaned.matchAll(WORD)].map((m) => m[0]).filter((t) => t.trim());
}

export function segmentSentences(text: string): string[] {
  const parts = text.split(/([.!?\u061F])/);
  const result: string[] = [];
  let current = '';
  for (const part of parts) {
    if (SENTENCE_END.test(part) && part.length === 1) {
      current += part;
      if (current.trim()) result.push(current.trim());
      current = '';
    } else {
      current += part;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result.filter(Boolean);
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
