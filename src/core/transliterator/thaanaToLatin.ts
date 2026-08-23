import {
  GEMINATE_CONSONANTS,
  PRENASALIZED_STOPS,
  SUKUN_SPECIAL,
  THAANA_CONSONANTS,
  THAANA_VOWELS,
} from './mappings';

export function transliterateThaana(text: string): string {
  const result: string[] = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const char = text[i];

    if (
      /\s/.test(char) ||
      (!(char in THAANA_CONSONANTS) && !(char in THAANA_VOWELS))
    ) {
      result.push(char);
      i += 1;
      continue;
    }

    if (i + 1 < n && char === 'ނ') {
      const nextChar = text[i + 1];
      const cons = THAANA_CONSONANTS[nextChar] ?? '';
      if (cons in PRENASALIZED_STOPS) {
        result.push(PRENASALIZED_STOPS[cons]);
        i += 2;
        continue;
      }
    }

    if (char in THAANA_CONSONANTS) {
      const cons = THAANA_CONSONANTS[char];
      i += 1;

      if (i < n && text[i] in THAANA_VOWELS && text[i] !== 'ް') {
        const vowel = THAANA_VOWELS[text[i]];
        result.push(cons ? cons + vowel : vowel);
        i += 1;
        continue;
      }

      if (i < n && text[i] === 'ް') {
        i += 1;
        const nextChar = i < n ? text[i] : '';

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

    if (char === 'އ' && i + 1 < n && text[i + 1] in THAANA_VOWELS && text[i + 1] !== 'ް') {
      result.push(THAANA_VOWELS[text[i + 1]]);
      i += 2;
      continue;
    }

    if (char in THAANA_VOWELS && char !== 'ް') {
      result.push(THAANA_VOWELS[char]);
      i += 1;
      continue;
    }

    result.push(char);
    i += 1;
  }

  return result.join('');
}

export function transliterateWord(word: string): string {
  return transliterateThaana(word.trim());
}
