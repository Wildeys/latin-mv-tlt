export type DictionaryEntry = {
  latin: string;
  english: string[];
  pos: string;
  frequency: number;
  /**
   * Provenance of `frequency`. The shipped lexicon uses placeholder constants
   * for most rows, so this is not a corpus count. See Context/DATA.md.
   */
  freqSource?: string;
};

export type LookupHit = DictionaryEntry & {
  matchType: 'exact' | 'prefix' | 'supplement' | 'closed_class' | 'transliteration' | 'unknown';
};

export type WordTranslation = {
  input: string;
  sourceLang: 'dhivehi' | 'english';
  translations: LookupHit[];
  transliteration: string | null;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  fallbackUsed: string | null;
  stem?: string;
  suffixes?: string[];
  caseGloss?: string;
};

/**
 * Mirrors public/data/dictionary_stats.json. The previous five-key type
 * silently dropped every provenance counter the build scripts emit before
 * Benchmarks could read them. All keys are optional so an older stats file
 * still parses.
 */
export type DictionaryStats = {
  rawDbRows?: number;
  uniqueLatin?: number;
  entriesWithEnglish?: number;
  finalExportedEntries?: number;
  newlyAdded?: number;
  englishUnioned?: number;
  posFilled?: number;
  frequencyUpdated?: number;
  invertedFlipped?: number;
  quarantined?: number;
  keysSplit?: number;
  keysRecovered?: number;
  source?: string;
  [key: string]: number | string | undefined;
};
