import {
  GEMINATE_CONSONANTS,
  PRENASALIZED_STOPS,
  SUKUN_SPECIAL,
  THAANA_CONSONANTS,
  THAANA_VOWELS,
} from './mappings';

export type ThaanaToLatinResult = {
  latin: string;
  /** Characters passed through unconverted, de-duplicated. */
  preserved: string[];
};

/**
 * Thaana → Latin, reporting what could not be converted.
 *
 * The reverse direction has always reported preserved segments (R-1.3), but this
 * direction pushed unmapped characters through silently. R-1.8's round-trip
 * metric needs to attribute failures to a class, and "there was a character we
 * had no rule for" is one of them — invisible without this.
 */
/**
 * A branch for `އ` + vowel used to sit after the consonant branch below. It was
 * unreachable: `އ` IS in THAANA_CONSONANTS (mapped to the empty string), so the
 * consonant branch always claimed it first and emitted the identical result
 * through `cons ? cons + vowel : vowel`. It is gone rather than kept as a
 * comment-free duplicate of live logic.
 */
export function transliterateThaanaDetailed(text: string): ThaanaToLatinResult {
  const result: string[] = [];
  const preserved: string[] = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const char = text[i];

    if (
      /\s/.test(char) ||
      (!(char in THAANA_CONSONANTS) && !(char in THAANA_VOWELS))
    ) {
      result.push(char);
      // Whitespace and ASCII punctuation are passed through by design; only
      // Thaana-block characters we have no rule for are a real gap.
      if (/[ހ-޿]/.test(char)) preserved.push(char);
      i += 1;
      continue;
    }

    // A prenasalized stop is ONE Latin unit spelled from TWO Thaana consonants,
    // but the diacritic that follows still belongs to the second of them. This
    // used to `continue` straight after emitting the digraph, so the stop's own
    // vowel or sukun was left for the next iteration to meet with no consonant in
    // front of it: `ނބް` came out as `n'b` + a raw U+07B0 in the Latin. Falling
    // into the shared diacritic handling below is what makes the pair behave
    // exactly like any other consonant (R-1.8).
    let cons: string | null = null;

    if (i + 1 < n && char === 'ނ') {
      const stop = THAANA_CONSONANTS[text[i + 1]] ?? '';
      if (stop in PRENASALIZED_STOPS) {
        cons = PRENASALIZED_STOPS[stop];
        i += 2;
      }
    }

    if (cons === null && char in THAANA_CONSONANTS) {
      cons = THAANA_CONSONANTS[char];
      i += 1;
    }

    if (cons !== null) {
      if (i < n && text[i] in THAANA_VOWELS && text[i] !== 'ް') {
        const vowel = THAANA_VOWELS[text[i]];
        result.push(cons ? cons + vowel : vowel);
        i += 1;
        continue;
      }

      if (i < n && text[i] === 'ް') {
        i += 1;
        const nextChar = i < n ? text[i] : '';

        // Geminates are an alifu-carried rule, so they cannot follow a
        // prenasalized pair — `char` is ނ there, never އ.
        if (char === 'އ' && nextChar in THAANA_CONSONANTS) {
          const nextCons = THAANA_CONSONANTS[nextChar];
          if (GEMINATE_CONSONANTS.has(nextCons)) {
            result.push(nextCons + nextCons);
            i += 1;
            continue;
          }
        }

        result.push(SUKUN_SPECIAL[char] ?? cons);
        continue;
      }

      if (cons) result.push(cons);
      continue;
    }

    if (char in THAANA_VOWELS && char !== 'ް') {
      result.push(THAANA_VOWELS[char]);
      i += 1;
      continue;
    }

    result.push(char);
    if (/[ހ-޿]/.test(char)) preserved.push(char);
    i += 1;
  }

  return { latin: result.join(''), preserved: [...new Set(preserved)] };
}

export function transliterateThaana(text: string): string {
  return transliterateThaanaDetailed(text).latin;
}

export function transliterateWord(word: string): string {
  return transliterateThaana(word.trim());
}
