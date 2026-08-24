import { normalise } from '../normalize';
import { stemWord } from '../morphology/suffixParser';
import { transliterateThaana } from '../transliterator/thaanaToLatin';
import { ENGLISH_TO_LATIN, LATIN_TO_ENGLISH } from './closedClass';
import type { DictionaryEntry, DictionaryStats, LookupHit, WordTranslation } from './types';

const MIN_PREFIX_LEN = 4;
const MAX_PARTIAL = 5;
/** Hard bound on how many prefix candidates are collected before ranking. */
const MAX_PREFIX_SCAN = 500;
const MAX_CACHE = 5000;

let entries: DictionaryEntry[] = [];
let byLatin = new Map<string, DictionaryEntry[]>();
let byEnglish = new Map<string, DictionaryEntry[]>();
/** Sorted copy of the byLatin keys, so prefix lookup can binary-search. */
let sortedLatinKeys: string[] = [];
let stats: DictionaryStats | null = null;
let loaded = false;
let loading: Promise<void> | null = null;
const cache = new Map<string, WordTranslation>();

function push(map: Map<string, DictionaryEntry[]>, key: string, entry: DictionaryEntry) {
  const existing = map.get(key);
  if (existing) existing.push(entry);
  else map.set(key, [entry]);
}

function indexEntry(entry: DictionaryEntry) {
  const latinKey = entry.latin.trim().toLowerCase();
  if (latinKey) push(byLatin, latinKey, entry);
  for (const gloss of entry.english) {
    const key = gloss.trim().toLowerCase();
    if (key) push(byEnglish, key, entry);
  }
}

export function loadDictionaryFromData(data: DictionaryEntry[], counted?: DictionaryStats) {
  // Copy so a later mutation by the caller cannot desynchronise the indexes.
  entries = [...data];
  byLatin = new Map();
  byEnglish = new Map();
  cache.clear();
  for (const entry of entries) indexEntry(entry);
  sortedLatinKeys = [...byLatin.keys()].sort();
  stats = counted ?? null;
  loaded = true;
}

export async function loadDictionary(
  dictUrl = './data/dictionary.json',
  statsUrl = './data/dictionary_stats.json',
): Promise<void> {
  if (loaded) return;
  // Memoise the in-flight promise. Without this, StrictMode's double effect
  // fetches and re-indexes the whole dictionary twice on every mount.
  if (loading) return loading;
  loading = (async () => {
    const [dictRes, statsRes] = await Promise.all([
      fetch(dictUrl),
      fetch(statsUrl).catch(() => null),
    ]);
    if (!dictRes.ok) {
      throw new Error(`Could not load ${dictUrl}: ${dictRes.status} ${dictRes.statusText}`);
    }
    const data = (await dictRes.json()) as DictionaryEntry[];
    let counted: DictionaryStats | undefined;
    if (statsRes && statsRes.ok) {
      counted = (await statsRes.json()) as DictionaryStats;
    }
    loadDictionaryFromData(data, counted);
  })();
  try {
    await loading;
  } finally {
    loading = null;
  }
}

export function isDictionaryLoaded(): boolean {
  return loaded;
}

export function getDictionaryStats(): DictionaryStats | null {
  return stats;
}

export function getEntryCount(): number {
  return entries.length;
}

function hitFrom(entry: DictionaryEntry, matchType: LookupHit['matchType']): LookupHit {
  return { ...entry, matchType };
}

export function isKnownLatin(latin: string): boolean {
  return byLatin.has(latin.trim().toLowerCase());
}

/** Index of the first sorted key that is >= target. */
function lowerBound(keys: string[], target: string): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function lookupLatin(word: string): LookupHit[] {
  const key = normalise(word).trim().toLowerCase();
  const exact = byLatin.get(key) ?? [];
  if (exact.length) return exact.map((e) => hitFrom(e, 'exact'));
  if (key.length < MIN_PREFIX_LEN) return [];

  // Binary-search the sorted key list instead of walking all ~16k keys. Keys
  // sharing a prefix form one contiguous run, so the walk stops at the first
  // non-match. MAX_PREFIX_SCAN bounds a pathologically common prefix.
  const candidates: DictionaryEntry[] = [];
  for (let i = lowerBound(sortedLatinKeys, key); i < sortedLatinKeys.length; i += 1) {
    const latin = sortedLatinKeys[i];
    if (!latin.startsWith(key)) break;
    for (const entry of byLatin.get(latin) ?? []) candidates.push(entry);
    if (candidates.length >= MAX_PREFIX_SCAN) break;
  }

  // Rank before truncating. Previously the first five in file order won, so
  // `kiyavaa` resolved to "a recitation-house" while better candidates were
  // discarded unseen. Shorter extensions first, then higher frequency.
  return candidates
    .sort((a, b) => a.latin.length - b.latin.length || (b.frequency || 0) - (a.frequency || 0))
    .slice(0, MAX_PARTIAL)
    .map((e) => hitFrom(e, 'prefix'));
}

function lookupEnglish(word: string): LookupHit[] {
  const query = normalise(word).trim().toLowerCase();
  const matches = byEnglish.get(query) ?? [];
  return matches
    .map((entry) => {
      const rank = entry.english.map((g) => g.toLowerCase()).indexOf(query);
      return { entry, rank: rank < 0 ? 99 : rank };
    })
    .sort((a, b) => a.rank - b.rank || (b.entry.frequency || 0) - (a.entry.frequency || 0))
    .map(({ entry }) => hitFrom(entry, 'exact'));
}

function confidenceFor(hits: LookupHit[]): WordTranslation['confidence'] {
  if (!hits.length) return 'low';
  return hits[0].matchType === 'exact' ||
    hits[0].matchType === 'supplement' ||
    hits[0].matchType === 'closed_class'
    ? 'high'
    : 'low';
}

function downgrade(confidence: WordTranslation['confidence']): WordTranslation['confidence'] {
  if (confidence === 'high') return 'medium';
  if (confidence === 'medium') return 'low';
  return 'low';
}

function isExact(hits: LookupHit[]): boolean {
  return hits.length > 0 && hits[0].matchType === 'exact';
}

/**
 * Cached. The returned object is shared between callers and must be treated as
 * read-only. The cache is cleared whenever the dictionary is (re)loaded.
 */
export function translateWord(word: string, sourceLang: 'dhivehi' | 'english'): WordTranslation {
  const cleaned = normalise(word);
  const cacheKey = `${sourceLang}:${cleaned}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const result = translateWordUncached(cleaned, sourceLang);
  if (cache.size < MAX_CACHE) cache.set(cacheKey, result);
  return result;
}

function translateWordUncached(
  cleaned: string,
  sourceLang: 'dhivehi' | 'english',
): WordTranslation {
  const result: WordTranslation = {
    input: cleaned,
    sourceLang,
    translations: [],
    transliteration: null,
    confidence: 'unknown',
    fallbackUsed: null,
  };

  if (sourceLang === 'english') {
    const closed = ENGLISH_TO_LATIN[cleaned.trim().toLowerCase()];
    if (closed) {
      // Only an exact dictionary hit may replace the curated closed-class
      // gloss. A prefix guess is not authoritative and must not be reported
      // as high confidence.
      const dictHits = lookupLatin(closed);
      const exact = isExact(dictHits);
      result.translations = exact
        ? dictHits
        : [
            {
              latin: closed,
              english: [cleaned],
              pos: 'closed_class',
              frequency: 1,
              matchType: 'closed_class',
            },
          ];
      result.confidence = 'high';
      result.fallbackUsed = exact ? null : 'closed_class';
      result.transliteration = closed;
      return result;
    }
    const matches = lookupEnglish(cleaned);
    if (matches.length) {
      result.translations = matches;
      result.confidence = confidenceFor(matches);
      result.transliteration = matches[0].latin;
      return result;
    }
    result.confidence = 'low';
    result.fallbackUsed = 'unknown_english';
    result.translations = [
      {
        latin: `[unknown: ${cleaned}]`,
        english: [cleaned],
        pos: 'unknown',
        frequency: 0,
        matchType: 'unknown',
      },
    ];
    return result;
  }

  const ascii = [...cleaned].every((c) => c.charCodeAt(0) < 128);
  if (ascii) {
    const closedEn = LATIN_TO_ENGLISH[cleaned.trim().toLowerCase()];
    if (closedEn) {
      const dictHits = lookupLatin(cleaned);
      const exact = isExact(dictHits);
      result.translations = exact
        ? dictHits
        : [
            {
              latin: cleaned,
              english: [closedEn],
              pos: 'closed_class',
              frequency: 1,
              matchType: 'closed_class',
            },
          ];
      result.confidence = 'high';
      result.transliteration = cleaned;
      result.fallbackUsed = exact ? null : 'closed_class';
      return result;
    }
    let matches = lookupLatin(cleaned);
    if (!isExact(matches)) {
      const stemmed = stemWord(cleaned, isKnownLatin);
      if (stemmed && stemmed.root.toLowerCase() !== cleaned.toLowerCase()) {
        const stemHits = lookupLatin(stemmed.root);
        if (isExact(stemHits)) {
          result.stem = stemmed.root;
          result.suffixes = stemmed.suffixes;
          result.caseGloss = stemmed.englishHints.join(' ');
          matches = stemHits;
        }
      }
    }
    if (matches.length) {
      result.translations = matches;
      result.confidence = confidenceFor(matches);
      result.transliteration = result.stem ?? cleaned;
      if (matches[0].matchType === 'prefix') result.fallbackUsed = 'prefix';
      return result;
    }
  } else {
    // Thaana input is normalised to Latin and then looked up. There is no
    // Thaana index: the shipped lexicon is Latin only. See Context/LATIN-CORE.md.
    const latin = transliterateThaana(cleaned);
    result.transliteration = latin;
    const latinHits = lookupLatin(latin);
    if (latinHits.length) {
      result.translations = latinHits;
      result.confidence = downgrade(confidenceFor(latinHits));
      result.fallbackUsed = 'transliteration_lookup';
      return result;
    }
  }

  result.transliteration = ascii ? cleaned : transliterateThaana(cleaned);
  result.confidence = 'low';
  result.fallbackUsed = 'transliteration_only';
  result.translations = [
    {
      latin: result.transliteration ?? cleaned,
      english: [`[unknown: ${result.transliteration}]`],
      pos: 'unknown',
      frequency: 0,
      matchType: 'transliteration',
    },
  ];
  return result;
}

export function englishGloss(hit: WordTranslation): string {
  const first = hit.translations[0];
  if (!first) return hit.input;
  const gloss = first.english[0];
  if (!gloss || gloss.startsWith('[unknown:')) return first.latin || hit.input;
  return gloss;
}

export function latinValue(hit: WordTranslation): string {
  return hit.stem || hit.transliteration || hit.translations[0]?.latin || hit.input;
}
