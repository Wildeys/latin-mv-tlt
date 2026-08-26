import { GEMINATE_CONSONANTS, PRENASALIZED_STOPS, THAANA_VOWELS } from './mappings';

/**
 * Latin → Thaana.
 *
 * This is the inverse of `transliterateThaana`, and under v0.2 it is load-bearing
 * in a way it was not under v0.1: every training pair passes through the forward
 * direction, so the round-trip error rate is a hard ceiling on translation
 * quality (REQUIREMENTS §6.8, R-1.8). Three forward rules previously had no
 * inverse at all and are implemented below — geminates, prenasalized stops and
 * the `iy` sukun special. See `docs/REQUIREMENTS.md` R-1.8 for the measured
 * classes that remain irreducible.
 */

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

const THAANA_FOR_LATIN: Record<string, string> = Object.fromEntries(CORE_LATIN_TO_THAANA);

const LATIN_TO_THAANA_VOWELS: Record<string, string> = Object.fromEntries(
  Object.entries(THAANA_VOWELS)
    .filter(([, latin]) => latin)
    .map(([thaana, latin]) => [latin, thaana]),
);

const SUKUN = 'ް';
const ALIFU = 'އ';
const THAA = 'ތ';
const SHAVIYANI = 'ށ';
const NOONU = 'ނ';
const LETTER_OR_DIGIT = /[A-Za-z0-9]/;
const VOWEL_LETTER = /[aeiou]/;

/**
 * `n'b`, `n'dh`, … → the noonu + stop pair that produced them.
 * Derived from PRENASALIZED_STOPS rather than retyped, so the two directions
 * cannot drift. Longest first: `n'dh` must be tried before `n'd`.
 */
const PRENASALIZED_REVERSE: [string, string][] = Object.entries(PRENASALIZED_STOPS)
  .map(([base, latin]) => [latin, base] as [string, string])
  .sort((a, b) => b[0].length - a[0].length);

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
      // `ey` is a vowel (ޭ) but also spells vowel + onset y (ެ + ޔ). If a vowel
      // follows, the `y` must be carrying it, so the digraph reading is wrong:
      // `keyo` is ކެޔޮ, not ކޭއޮ. Greedy 2-char matching got this backwards.
      if (substring.length === 2 && substring[1] === 'y' && isVowelAt(word, i + 2)) {
        continue;
      }
      return [substring, LATIN_TO_THAANA_VOWELS[substring]];
    }
  }
  return null;
}

function isVowelAt(word: string, i: number): boolean {
  return i < word.length && VOWEL_LETTER.test(word[i]);
}

function matchPrenasalized(word: string, i: number): [string, string] | null {
  for (const [latin, base] of PRENASALIZED_REVERSE) {
    if (word.startsWith(latin, i)) return [latin, base];
  }
  return null;
}

export type LatinToThaanaResult = {
  thaana: string;
  preserved: string[];
};

function convertLatinWordDetailed(word: string): LatinToThaanaResult {
  if (!word) return { thaana: '', preserved: [] };

  const folded = foldMaleLatin(word).toLowerCase();
  const result: string[] = [];
  const preserved: string[] = [];
  let i = 0;
  const n = folded.length;

  /** Emit a consonant, absorbing a following vowel or falling back to sukun. */
  const pushWithVowel = (thaana: string, next: number): number => {
    const vow = matchVowel(folded, next);
    if (vow) {
      result.push(thaana + vow[1]);
      return next + vow[0].length;
    }
    result.push(thaana + SUKUN);
    return next;
  };

  while (i < n) {
    // Prenasalized stops: `n'b` → ނބ. The forward direction emits the apostrophe
    // form from noonu + stop; without this the `'` fell through to the preserve
    // branch and the noonu was lost entirely.
    const nasal = matchPrenasalized(folded, i);
    if (nasal) {
      const [latin, base] = nasal;
      i = pushWithVowel(NOONU + THAANA_FOR_LATIN[base], i + latin.length);
      continue;
    }

    const cons = matchConsonant(folded, i);

    // Geminates: `bb` → އްބ. The forward direction writes alifu + sukun before a
    // doubled consonant, so a doubled Latin consonant must restore it. Only the
    // consonants the forward direction is willing to double qualify, which is
    // why GEMINATE_CONSONANTS is shared rather than re-listed.
    if (
      cons &&
      GEMINATE_CONSONANTS.has(cons[0]) &&
      folded.startsWith(cons[0], i + cons[0].length) &&
      // …but only if the repeat really is the same consonant. In `ddh` the
      // second `d` opens `dh`, so this is ޑް + ދ, not a doubled ޑ. Without this
      // guard the greedy match swallowed the `d` of every `dh` that followed one.
      matchConsonant(folded, i + cons[0].length)?.[0] === cons[0]
    ) {
      result.push(ALIFU + SUKUN);
      i = pushWithVowel(cons[1], i + cons[0].length * 2);
      continue;
    }

    // Sukun special `iy` → ތް, but only where a consonant could not follow —
    // that is, at word end or before another consonant. Before a vowel the `y`
    // is an onset (އިޔަ …), so the generic path is correct there.
    //
    // Ambiguous by construction: އިޔް also reads out as `iy`. ތް is chosen as the
    // canonical inverse because it is far the commoner Dhivehi word-final shape.
    // R-1.2 requires one convention, so the alternative is deliberately lost and
    // is reported by tools/measure_roundtrip.py as a declared class.
    if (folded.startsWith('iy', i) && !matchVowel(folded, i + 2)) {
      result.push(THAA + SUKUN);
      i += 2;
      continue;
    }

    // A coda `h` — one that follows a vowel and is not itself carrying a vowel —
    // is ށް. This covers the dative/terminative ending both word-finally
    // (`maleah`) and before a following consonant (`kamakah dhiya`, `kahdevi`),
    // which is where most of it occurs in running text. An `h` *followed* by a
    // vowel is an onset ހ and takes the generic path.
    //
    // Ambiguous by construction: SUKUN_SPECIAL maps both ށ and އ to `h` under
    // sukun, and ހް is a third reading. Measured over data/dictionary_full.json,
    // ށް accounts for 59% of the ambiguous cases against 41% for އް — and that
    // understates it, because headwords under-represent the inflected datives
    // that dominate running text. R-1.2 permits only one convention, so އް is
    // the declared loss and measure_roundtrip.py reports it.
    if (
      folded[i] === 'h' &&
      i > 0 &&
      VOWEL_LETTER.test(folded[i - 1]) &&
      !isVowelAt(folded, i + 1)
    ) {
      result.push(SHAVIYANI + SUKUN);
      i += 1;
      continue;
    }

    if (cons) {
      i = pushWithVowel(cons[1], i + cons[0].length);
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
