import { normalise } from '../normalize';
import { stemWord } from '../morphology/suffixParser';
import { transliterateThaana } from '../transliterator/thaanaToLatin';
import { ENGLISH_TO_LATIN, LATIN_TO_ENGLISH } from './closedClass';
import type {
  DictionaryEntry,
  DictionaryStats,
  LookupHit,
  SearchMatchKind,
  SearchQuery,
  SearchResponse,
  SearchResult,
  SearchSide,
  WordTranslation,
} from './types';

const MIN_PREFIX_LEN = 4;
const MAX_PARTIAL = 5;
/** Hard bound on how many prefix candidates are collected before ranking. */
const MAX_PREFIX_SCAN = 500;
const MAX_CACHE = 5000;

/**
 * Browse limits (R-4.8), deliberately separate from the four above.
 *
 * `MIN_PREFIX_LEN`, `MAX_PARTIAL` and `MAX_PREFIX_SCAN` bound the *translation*
 * gloss path: they stop it guessing a gloss from a three-letter stub and stop a
 * trace carrying more than five candidates. A browse screen has neither duty, so
 * `searchDictionary` reads none of them — which is also why adding it cannot
 * change pipeline behaviour or any existing test.
 */
const SEARCH_LIMIT = 50;
const SEARCH_LIMIT_MAX = 200;
/** Matched keys recorded per side, for the "why did this row appear" column. */
const MAX_MATCHED_KEYS = 3;

/**
 * Local, so `core/dictionary` gains no new cross-module dependency. The same
 * block `segmenter` uses; this module already detects script for itself in
 * `translateWordUncached`.
 */
const THAANA_BLOCK = /[\u0780-\u07BF]/;

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
    // Thaana index: the shipped lexicon is Latin only. See Context/PROJECT.md.
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

// ---------------------------------------------------------------- browse (R-4.8)

const KIND_RANK: Record<SearchMatchKind, number> = { exact: 0, prefix: 1, contains: 2 };

type Accumulator = {
  entry: DictionaryEntry;
  kind: SearchMatchKind;
  sides: Set<SearchSide>;
  matchedKeys: { side: SearchSide; key: string }[];
  perSide: Record<SearchSide, number>;
};

/** Classify a hit from where in the key it landed. */
function kindFor(key: string, query: string, at: number): SearchMatchKind {
  if (at > 0) return 'contains';
  return key.length === query.length ? 'exact' : 'prefix';
}

function record(
  seen: Map<DictionaryEntry, Accumulator>,
  entry: DictionaryEntry,
  side: SearchSide,
  kind: SearchMatchKind,
  key: string,
): boolean {
  const existing = seen.get(entry);
  if (!existing) {
    seen.set(entry, {
      entry,
      kind,
      sides: new Set([side]),
      matchedKeys: [{ side, key }],
      perSide: { latin: side === 'latin' ? 1 : 0, english: side === 'english' ? 1 : 0 },
    });
    return true; // newly counted toward `total`
  }
  if (KIND_RANK[kind] < KIND_RANK[existing.kind]) existing.kind = kind;
  existing.sides.add(side);
  if (existing.perSide[side] < MAX_MATCHED_KEYS) {
    existing.perSide[side] += 1;
    existing.matchedKeys.push({ side, key });
  }
  return false;
}

/** Browse ranking. Total and deterministic — see the `frequency` note below. */
function compareResults(a: Accumulator, b: Accumulator): number {
  const byKind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
  if (byKind) return byKind;

  // A headword hit outranks a gloss-only hit of the same kind. Without this the
  // next tiebreak compares two incomparable things: for a gloss match, the
  // *headword's* length says nothing about how well the query matched. Searching
  // `fen` put the inverted row `see` (glossed "fenun") above `fenu` purely
  // because "see" is one character shorter.
  const aLatin = a.sides.has('latin') ? 0 : 1;
  const bLatin = b.sides.has('latin') ? 0 : 1;
  if (aLatin !== bLatin) return aLatin - bLatin;

  const byLength = a.entry.latin.length - b.entry.latin.length;
  if (byLength) return byLength;
  return a.entry.latin < b.entry.latin ? -1 : a.entry.latin > b.entry.latin ? 1 : 0;
}

/**
 * Select the best `limit` accumulators without sorting the whole matched set.
 *
 * A one-character query matches ~14,500 of the 15,528 entries. Sorting that many
 * costs 13–18 ms; keeping only the best `limit` by bounded insertion costs a
 * fraction of it, because the comparator never revisits rows that already lost.
 */
function topK(seen: Iterable<Accumulator>, limit: number): Accumulator[] {
  const best: Accumulator[] = [];
  for (const candidate of seen) {
    if (best.length === limit && compareResults(candidate, best[best.length - 1]) >= 0) {
      continue;
    }
    let i = best.length - 1;
    while (i >= 0 && compareResults(candidate, best[i]) < 0) i -= 1;
    best.splice(i + 1, 0, candidate);
    if (best.length > limit) best.pop();
  }
  return best;
}

function emptyQuery(raw: string): SearchQuery {
  return { raw, script: 'empty', latin: '', transliterated: false };
}

/**
 * Search the lexicon for browsing (R-4.8, R-6.12).
 *
 * This is NOT the translation lookup. Three things separate them, each
 * deliberate:
 *
 *   - **It scans exhaustively.** `lookupLatin` binary-searches and breaks at the
 *     first non-matching key, which is right for its job but can only ever
 *     report "at least N". The browse screen's contract is "showing 50 of 762",
 *     and that sentence is only true if everything was looked at. One `indexOf`
 *     per key over ~32k keys measures under 7 ms even for the pathological
 *     one-character query, so the exact denominator is cheap.
 *   - **It does not touch `cache`.** `translateWord` stops *accepting* entries at
 *     `MAX_CACHE` rather than evicting, so a browse path sharing the cache would
 *     fill all 5,000 slots after a few hundred keystrokes and silently disable
 *     memoisation for the whole translation pipeline.
 *   - **It does not rank by `frequency`.** 14,576 of 15,528 rows (93.9%) sit on
 *     the placeholder constants 50 or 1, and only 759 carry a `freqSource`.
 *     Ranking a browse list on a field that is constant for 94% of it is fake
 *     precision. Headword length then alphabetical is total and reproducible.
 *     `lookupLatin`'s own frequency tiebreak is untouched.
 *
 * Thaana input is transliterated and searches Latin headwords only; ASCII input
 * searches Latin headwords AND English glosses, and each result says which.
 */
export function searchDictionary(input: string, limit = SEARCH_LIMIT): SearchResponse {
  const capped = Math.max(0, Math.min(limit, SEARCH_LIMIT_MAX));
  const cleaned = normalise(input ?? '').trim();

  if (!cleaned) {
    return {
      query: emptyQuery(input ?? ''),
      results: [],
      total: 0,
      limit: capped,
      corpusSize: entries.length,
    };
  }

  const isThaana = THAANA_BLOCK.test(cleaned);
  const needle = (isThaana ? transliterateThaana(cleaned) : cleaned).trim().toLowerCase();
  const query: SearchQuery = {
    raw: input ?? '',
    script: isThaana ? 'thaana' : 'ascii',
    latin: needle,
    transliterated: isThaana,
  };

  if (!needle) {
    return { query, results: [], total: 0, limit: capped, corpusSize: entries.length };
  }

  const seen = new Map<DictionaryEntry, Accumulator>();
  let total = 0;

  for (const key of sortedLatinKeys) {
    const at = key.indexOf(needle);
    if (at < 0) continue;
    const kind = kindFor(key, needle, at);
    for (const entry of byLatin.get(key) ?? []) {
      if (record(seen, entry, 'latin', kind, key)) total += 1;
    }
  }

  // Thaana in means the user is asking about a Dhivehi headword, so the English
  // gloss index is not searched on that path.
  if (!isThaana) {
    for (const [key, matches] of byEnglish) {
      const at = key.indexOf(needle);
      if (at < 0) continue;
      const kind = kindFor(key, needle, at);
      for (const entry of matches) {
        if (record(seen, entry, 'english', kind, key)) total += 1;
      }
    }
  }

  const results: SearchResult[] = topK(seen.values(), capped).map((acc) => ({
    // A copy, so a caller holding a result cannot desynchronise the indexes —
    // the same promise `loadDictionaryFromData` makes about `entries`.
    entry: { ...acc.entry, english: [...acc.entry.english] },
    kind: acc.kind,
    sides: [...acc.sides],
    matchedKeys: acc.matchedKeys,
  }));

  return { query, results, total, limit: capped, corpusSize: entries.length };
}
