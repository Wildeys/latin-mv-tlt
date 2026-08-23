import { normalise } from '../normalize';
import { stemWord } from '../morphology/suffixParser';
import { transliterateThaana } from '../transliterator/thaanaToLatin';
import { ENGLISH_TO_LATIN, LATIN_TO_ENGLISH } from './closedClass';
import type { DictionaryEntry, DictionaryStats, LookupHit, WordTranslation } from './types';

const MIN_PREFIX_LEN = 4;
const MAX_PARTIAL = 5;

let entries: DictionaryEntry[] = [];
let byLatin = new Map<string, DictionaryEntry[]>();
let byThaana = new Map<string, DictionaryEntry[]>();
let byEnglish = new Map<string, DictionaryEntry[]>();
let stats: DictionaryStats | null = null;
let loaded = false;

function indexEntry(entry: DictionaryEntry) {
  const latinKey = entry.latin.trim().toLowerCase();
  if (latinKey) {
    const list = byLatin.get(latinKey) ?? [];
    list.push(entry);
    byLatin.set(latinKey, list);
  }
  if (entry.dhivehi) {
    const list = byThaana.get(entry.dhivehi) ?? [];
    list.push(entry);
    byThaana.set(entry.dhivehi, list);
  }
  for (const gloss of entry.english) {
    const key = gloss.trim().toLowerCase();
    if (!key) continue;
    const list = byEnglish.get(key) ?? [];
    list.push(entry);
    byEnglish.set(key, list);
  }
}

export function loadDictionaryFromData(data: DictionaryEntry[], counted?: DictionaryStats) {
  entries = data;
  byLatin = new Map();
  byThaana = new Map();
  byEnglish = new Map();
  for (const entry of data) indexEntry(entry);
  stats = counted ?? null;
  loaded = true;
}

export async function loadDictionary(
  dictUrl = './data/dictionary.json',
  statsUrl = './data/dictionary_stats.json',
): Promise<void> {
  if (loaded) return;
  const [dictRes, statsRes] = await Promise.all([
    fetch(dictUrl),
    fetch(statsUrl).catch(() => null),
  ]);
  const data = (await dictRes.json()) as DictionaryEntry[];
  let counted: DictionaryStats | undefined;
  if (statsRes && statsRes.ok) {
    counted = (await statsRes.json()) as DictionaryStats;
  }
  loadDictionaryFromData(data, counted);
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

function lookupLatin(word: string): LookupHit[] {
  const key = normalise(word).trim().toLowerCase();
  const exact = byLatin.get(key) ?? [];
  if (exact.length) return exact.map((e) => hitFrom(e, 'exact'));
  if (key.length < MIN_PREFIX_LEN) return [];
  const prefix: LookupHit[] = [];
  for (const [latin, list] of byLatin) {
    if (latin.startsWith(key)) {
      for (const entry of list) prefix.push(hitFrom(entry, 'prefix'));
      if (prefix.length >= MAX_PARTIAL) break;
    }
  }
  return prefix.slice(0, MAX_PARTIAL);
}

function lookupThaana(word: string): LookupHit[] {
  const key = normalise(word);
  return (byThaana.get(key) ?? []).map((e) => hitFrom(e, 'exact'));
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

export function translateWord(word: string, sourceLang: 'dhivehi' | 'english'): WordTranslation {
  const cleaned = normalise(word);
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
      const dictHits = lookupLatin(closed);
      result.translations = dictHits.length
        ? dictHits
        : [
            {
              dhivehi: '',
              latin: closed,
              english: [cleaned],
              pos: 'closed_class',
              frequency: 1,
              matchType: 'closed_class',
            },
          ];
      result.confidence = 'high';
      result.fallbackUsed = dictHits.length ? null : 'closed_class';
      result.transliteration = closed;
      return result;
    }
    const matches = lookupEnglish(cleaned);
    if (matches.length) {
      result.translations = matches;
      result.confidence = 'high';
      result.transliteration = matches[0].latin;
      return result;
    }
    result.confidence = 'low';
    result.fallbackUsed = 'unknown_english';
    result.translations = [
      {
        dhivehi: `[unknown: ${cleaned}]`,
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
      result.translations = dictHits.length
        ? dictHits
        : [
            {
              dhivehi: cleaned,
              latin: cleaned,
              english: [closedEn],
              pos: 'closed_class',
              frequency: 1,
              matchType: 'closed_class',
            },
          ];
      result.confidence = 'high';
      result.transliteration = cleaned;
      result.fallbackUsed = dictHits.length ? null : 'closed_class';
      return result;
    }
    let matches = lookupLatin(cleaned);
    if (!matches.length || matches[0].matchType !== 'exact') {
      const stemmed = stemWord(cleaned, isKnownLatin);
      if (stemmed && stemmed.root.toLowerCase() !== cleaned.toLowerCase()) {
        const stemHits = lookupLatin(stemmed.root);
        if (stemHits.length && stemHits[0].matchType === 'exact') {
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
    const thaanaHits = lookupThaana(cleaned);
    if (thaanaHits.length) {
      result.translations = thaanaHits;
      result.confidence = 'high';
      result.transliteration = thaanaHits[0].latin;
      return result;
    }
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
      dhivehi: cleaned,
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
