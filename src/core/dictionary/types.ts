export type DictionaryEntry = {
  dhivehi: string;
  latin: string;
  english: string[];
  pos: string;
  frequency: number;
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

export type DictionaryStats = {
  rawDbRows: number;
  uniqueThaana: number;
  uniqueLatin: number;
  entriesWithEnglish: number;
  finalExportedEntries: number;
};
