export type HonorificEntry = {
  latin: string;
  /** Build-side only. The shipped honorifics.json is Latin + English. */
  thaana?: string;
  english: string[];
  register: string;
  kind: string;
  plainForm: string | null;
};

/**
 * Modern Standard Malé Registers vs Sonja Fritz Vol. II attested registers.
 * - Fritz Vol. II does NOT support a three-level systematic honorific paradigm.
 * - It attests only 8 social honorific (HON) tokens, mostly dialectal:
 *   1. "-fuḷu" as a nominal honorific/diminutive on body parts (Fua Mulaku dialect, e.g. faivān-fuḷu).
 *   2. Plural-for-respect singular "anhenun" (Addu dialect, meaning "wife").
 * - Thus, systematic three-level inflection (reverential / respectful / informal) is an unwired stub.
 * - What IS strongly attested is the written narrative register particle "eve" (އެވެ) vs spoken informal.
 */
export const REGISTERS = ['written', 'spoken', 'neutral'] as const;

let lexicon: Record<string, HonorificEntry> | null = null;
let loading: Promise<Record<string, HonorificEntry>> | null = null;

/**
 * Loads the honorifics database. Under Fritz Vol. II, this contains mostly
 * historical, dialectal, and title lexical items (like "rasgefānu") rather than 
 * systemic grammatical paradigms.
 */
export async function loadHonorifics(url = './data/honorifics.json'): Promise<Record<string, HonorificEntry>> {
  if (lexicon) return lexicon;
  if (loading) return loading;

  loading = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        // Return an empty record gracefully if JSON is missing or in test environment
        return {};
      }
      const rows = (await response.json()) as HonorificEntry[];
      return loadHonorificsSync(rows);
    } catch {
      return {};
    }
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

export function loadHonorificsSync(rows: HonorificEntry[]): Record<string, HonorificEntry> {
  lexicon = Object.fromEntries(
    rows
      .filter((row) => typeof row?.latin === 'string')
      .map((row) => [row.latin.toLowerCase(), row]),
  );
  return lexicon;
}

/**
 * Detects register of a word sequence.
 * Under Fritz Vol. II, the primary detectable register is 'written' (if "eve" or 
 * fused narrative markers are present) versus standard 'spoken' or 'neutral'.
 */
export function detectRegister(words: string[]): string {
  const table = lexicon ?? {};
  let hasWritten = false;

  for (const rawWord of words) {
    const word = rawWord.trim().toLowerCase();
    
    // Check for the highly-attested narrative/written marker "eve" or its fusions
    if (
      word.endsWith('eve') || 
      word.endsWith('eheve') || 
      word.endsWith('ekeve') || 
      word.endsWith('gaeeve')
    ) {
      hasWritten = true;
    }

    // Check lexical entries
    if (table[word]) {
      const entryReg = table[word].register;
      if (entryReg === 'written' || entryReg === 'reverential' || entryReg === 'respectful') {
        return 'written';
      }
    }
  }

  if (hasWritten) return 'written';
  return 'neutral';
}

export function lookupHonorific(word: string): HonorificEntry | undefined {
  return lexicon?.[word.trim().toLowerCase()];
}

/**
 * Fuses the written narrative particle "eve" onto word endings,
 * according to the standard sandhi patterns in Fritz Vol. II & Dhivehi-Tools:
 * - locative "-gai" + "eve" -> "gaeeve"
 * - indefinite "-eh" + "eve" -> "eheve"
 * - dative "-ah" + "eve" -> "aheve"
 * - sukun-final consonant -> replaces sukun with "eve"
 */
export function mergeEve(word: string): string {
  const lower = word.toLowerCase().trim();
  if (!lower) return word;

  if (lower.endsWith('gai')) {
    return word.slice(0, -3) + 'gaeeve';
  }
  if (lower.endsWith('eh')) {
    return word.slice(0, -2) + 'eheve';
  }
  if (lower.endsWith('ek')) {
    return word.slice(0, -2) + 'ekeve';
  }
  if (lower.endsWith('ah')) {
    return word.slice(0, -2) + 'aheve';
  }
  if (lower.endsWith('ash')) {
    return word.slice(0, -3) + 'asheve';
  }
  
  // Sukun-consonant final transitions
  if (lower.endsWith('h') && lower.length > 2) {
    return word.slice(0, -1) + 'eve';
  }

  // Standard vowel endings
  if (lower.endsWith('a') || lower.endsWith('e') || lower.endsWith('i') || lower.endsWith('o') || lower.endsWith('u')) {
    return word + 'eve';
  }

  return word + ' eve';
}
