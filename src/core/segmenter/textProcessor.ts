import { transliterateThaana } from '../transliterator/thaanaToLatin';

const THAANA = /[\u0780-\u07BF]/;
const PUNCTUATION = /[.,;:!?()[\]{}"'\u060C\u061B\u061F\u0640]/;
const WORD = /([\u0780-\u07BF]+|[a-zA-Z]+(?:['-][a-zA-Z]+)*|\d+|[.,;:!?()[\]{}"'\u060C\u061B\u061F\u0640])/g;
const SENTENCE_END = /[.!?\u061F]/;

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

export function identifyScript(text: string): Record<string, number> {
  if (!text) return {};
  const total = text.length;
  const count = (re: RegExp) => {
    const flags = re.global ? re.flags : `${re.flags}g`;
    return [...text.matchAll(new RegExp(re.source, flags))].length;
  };
  return {
    thaana: (count(/[\u0780-\u07BF]/g) / total) * 100,
    latin: (count(/[a-zA-Z]/g) / total) * 100,
    digits: (count(/\d/g) / total) * 100,
    punctuation: (count(PUNCTUATION) / total) * 100,
    whitespace: (count(/\s/g) / total) * 100,
  };
}

export function hasThaana(text: string): boolean {
  return /[\u0780-\u07BF]/.test(text);
}

export function prepareSentence(sentence: string) {
  const words = extractWordsOnly(sentence);
  const script = identifyScript(sentence);
  const latin =
    (script.thaana ?? 0) > 0 ? extractWordsOnly(transliterateThaana(sentence)) : words;
  return {
    original: sentence,
    words,
    latinWords: latin,
    script,
    transliterated: (script.thaana ?? 0) > 0 ? transliterateThaana(sentence) : sentence,
  };
}
