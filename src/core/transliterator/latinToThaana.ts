import { THAANA_VOWELS } from './mappings';

const CORE_LATIN_TO_THAANA: [string, string][] = [
  ['lh', 'ޅ'],
  ['sh', 'ށ'],
  ['th', 'ތ'],
  ['dh', 'ދ'],
  ['gn', 'ޏ'],
  ['ch', 'ޗ'],
  ['kh', 'ޚ'],
  ['gh', 'ޣ'],
  ['h', 'ހ'],
  ['n', 'ނ'],
  ['r', 'ރ'],
  ['b', 'ބ'],
  ['k', 'ކ'],
  ['v', 'ވ'],
  ['w', 'ޥ'],
  ['m', 'މ'],
  ['f', 'ފ'],
  ['l', 'ލ'],
  ['g', 'ގ'],
  ['s', 'ސ'],
  ['d', 'ޑ'],
  ['z', 'ޒ'],
  ['t', 'ޓ'],
  ['y', 'ޔ'],
  ['p', 'ޕ'],
  ['j', 'ޖ'],
  ['q', 'ޤ'],
];

const LATIN_TO_THAANA_VOWELS: Record<string, string> = Object.fromEntries(
  Object.entries(THAANA_VOWELS)
    .filter(([, latin]) => latin)
    .map(([thaana, latin]) => [latin, thaana]),
);

const SUKUN = 'ް';
const ALIFU = 'އ';
const LETTER_OR_DIGIT = /[A-Za-z0-9]/;

export type LatinToThaanaResult = {
  thaana: string;
  preserved: string[];
};

function foldMaleLatin(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '');
}

function matchConsonant(word: string, i: number): [string, string] | null {
  for (const [latin, thaana] of CORE_LATIN_TO_THAANA) {
    if (word.startsWith(latin, i)) return [latin, thaana];
  }
  return null;
}

function matchVowel(word: string, i: number): [string, string] | null {
  for (const length of [2, 1]) {
    if (i + length > word.length) continue;
    const substring = word.slice(i, i + length);
    if (substring in LATIN_TO_THAANA_VOWELS) {
      return [substring, LATIN_TO_THAANA_VOWELS[substring]];
    }
  }
  return null;
}

function convertLatinWordDetailed(word: string): LatinToThaanaResult {
  if (!word) return { thaana: '', preserved: [] };

  const folded = foldMaleLatin(word).toLowerCase();
  const result: string[] = [];
  const preserved: string[] = [];
  let i = 0;
  const n = folded.length;

  while (i < n) {
    const cons = matchConsonant(folded, i);
    if (cons) {
      const [latin, consonant] = cons;
      i += latin.length;
      const vow = matchVowel(folded, i);
      if (vow) {
        result.push(consonant + vow[1]);
        i += vow[0].length;
      } else {
        result.push(consonant + SUKUN);
      }
      continue;
    }

    const vow = matchVowel(folded, i);
    if (vow) {
      result.push(ALIFU + vow[1]);
      i += vow[0].length;
      continue;
    }

    const ch = folded[i];
    result.push(ch);
    if (LETTER_OR_DIGIT.test(ch)) preserved.push(ch);
    i += 1;
  }

  return { thaana: result.join(''), preserved };
}

export function convertLatinWordToThaana(word: string): string {
  return convertLatinWordDetailed(word).thaana;
}

export function latinToThaanaDetailed(text: string): LatinToThaanaResult {
  const preserved: string[] = [];
  const thaana = foldMaleLatin(text)
    .split(/(\s+)/)
    .map((token) => {
      if (!token || /^\s+$/.test(token)) return token;
      if (![...token].some((c) => /[A-Za-z]/.test(c))) {
        for (const ch of token) {
          if (LETTER_OR_DIGIT.test(ch)) preserved.push(ch);
        }
        return token;
      }
      const converted = convertLatinWordDetailed(token);
      preserved.push(...converted.preserved);
      return converted.thaana;
    })
    .join('');

  return { thaana, preserved: [...new Set(preserved)] };
}

export function latinToThaana(text: string): string {
  return latinToThaanaDetailed(text).thaana;
}
