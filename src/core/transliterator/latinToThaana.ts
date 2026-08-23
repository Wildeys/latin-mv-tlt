import { THAANA_VOWELS } from './mappings';

const CORE_LATIN_TO_THAANA: [string, string][] = [
  ['lh', 'ޅ'],
  ['sh', 'ށ'],
  ['th', 'ތ'],
  ['dh', 'ދ'],
  ['gn', 'ޏ'],
  ['ch', 'ޗ'],
  ['h', 'ހ'],
  ['n', 'ނ'],
  ['r', 'ރ'],
  ['b', 'ބ'],
  ['k', 'ކ'],
  ['v', 'ވ'],
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
];

const LATIN_TO_THAANA_VOWELS: Record<string, string> = Object.fromEntries(
  Object.entries(THAANA_VOWELS)
    .filter(([, latin]) => latin)
    .map(([thaana, latin]) => [latin, thaana]),
);

const SUKUN = 'ް';
const ALIFU = 'އ';

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

export function convertLatinWordToThaana(word: string): string {
  if (!word) return '';

  const result: string[] = [];
  let i = 0;
  const n = word.length;

  while (i < n) {
    const cons = matchConsonant(word, i);
    if (cons) {
      const [latin, consonant] = cons;
      i += latin.length;
      const vow = matchVowel(word, i);
      if (vow) {
        result.push(consonant + vow[1]);
        i += vow[0].length;
      } else {
        result.push(consonant + SUKUN);
      }
      continue;
    }

    const vow = matchVowel(word, i);
    if (vow) {
      result.push(ALIFU + vow[1]);
      i += vow[0].length;
      continue;
    }

    i += 1;
  }

  return result.join('');
}

export function latinToThaana(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (![...word].some((c) => /[A-Za-z]/.test(c))) return word;
      return convertLatinWordToThaana(word.toLowerCase());
    })
    .join(' ');
}
