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
  /**
   * The three keys the *shipped* `dictionary_stats.json` actually carries.
   * Declared rather than left to the index signature so Benchmarks reads them
   * as `number | undefined` and the file's real shape is visible here.
   */
  shippedBefore?: number;
  shippedAfter?: number;
  frequencyUpdatedFromCorpus?: number;
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

// ---------------------------------------------------------------- browse (R-4.8)

/**
 * How a key matched the query. Deliberately a THREE-member union, distinct from
 * `LookupHit['matchType']`.
 *
 * `matchType` carries `supplement`, `closed_class`, `transliteration` and
 * `unknown` — four states that describe the *translation* lookup's fallback
 * chain and are meaningless when browsing. Reusing it would make a reader check
 * for states that cannot occur, and it flattens onto the entry, leaving nowhere
 * to record that a row matched on both sides at once.
 */
export type SearchMatchKind = 'exact' | 'prefix' | 'contains';

export type SearchSide = 'latin' | 'english';

export type SearchResult = {
  /** A copy. Safe to hold; mutating it cannot desynchronise the indexes. */
  entry: DictionaryEntry;
  /** The best kind across every key that matched this entry. */
  kind: SearchMatchKind;
  /** May be both, when the query hits a headword and a gloss. */
  sides: SearchSide[];
  /** What actually matched, so a surprising row can explain itself. Capped. */
  matchedKeys: { side: SearchSide; key: string }[];
};

export type SearchQuery = {
  raw: string;
  script: 'thaana' | 'ascii' | 'empty';
  /** The term actually searched — Thaana input arrives here transliterated. */
  latin: string;
  transliterated: boolean;
};

export type SearchResponse = {
  query: SearchQuery;
  /** At most `limit` rows. */
  results: SearchResult[];
  /**
   * EXACT count of distinct matching entries, not a scan cap. The screen says
   * "showing 50 of 762", and that sentence is only true if everything was
   * looked at — which is why the browse scan is exhaustive (R-4.8).
   */
  total: number;
  limit: number;
  /** `entries.length`, the live count — never the stale stats file. */
  corpusSize: number;
};
