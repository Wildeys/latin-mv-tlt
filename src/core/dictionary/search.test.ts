import { describe, expect, it, beforeEach } from 'vitest';
import { loadDictionaryFromData, searchDictionary, translateWord } from './lookup';
import type { DictionaryEntry } from './types';

/**
 * R-4.8. A separate fixture from `lookup.test.ts`: browse has to cope with the
 * shipped lexicon's actual shape — inverted rows, multi-word glosses, enough
 * near-neighbours to force truncation — none of which belong in the fixture that
 * pins the translation path.
 */
const FIXTURE: DictionaryEntry[] = [
  { latin: 'fen', english: ['water'], pos: 'noun', frequency: 300, freqSource: 'corpus.tsv' },
  { latin: 'fenu', english: ['a kind of water plant'], pos: 'noun', frequency: 50 },
  { latin: 'fengandu', english: ['a body of water'], pos: 'noun', frequency: 50 },
  { latin: 'kiyavaa', english: ['study'], pos: 'verb', frequency: 900 },
  { latin: 'kiyavaage', english: ['a recitation-house'], pos: 'noun', frequency: 1 },
  { latin: 'kiyavaageri', english: ["a teacher's house"], pos: 'noun', frequency: 1 },
  { latin: 'ge', english: ['house'], pos: 'noun', frequency: 400 },
  { latin: 'gos', english: ['go'], pos: 'verb', frequency: 200 },
  // An inverted row of the kind the shipped file still contains: the English
  // sits in the headword column and the Dhivehi in the glosses.
  { latin: 'see', english: ['fenun'], pos: 'verb', frequency: 1 },
];

beforeEach(() => {
  loadDictionaryFromData(FIXTURE);
});

describe('searchDictionary', () => {
  it('orders by kind, then headword hits before gloss hits, then length', () => {
    const res = searchDictionary('fen');
    expect(res.results.map((r) => r.entry.latin)).toEqual([
      'fen', // exact headword
      'fenu', // prefix headword, shorter
      'fengandu', // prefix headword, longer
      'see', // gloss-only: "fenun" also starts with fen, but a headword wins
    ]);
    expect(res.results[0].kind).toBe('exact');
    expect(res.results[3].sides).toEqual(['english']);
  });

  it('ranks a contains-match below a prefix-match', () => {
    const res = searchDictionary('house', 200);
    const kinds = res.results.map((r) => r.kind);
    expect(kinds).toEqual([...kinds].sort((a, b) =>
      ({ exact: 0, prefix: 1, contains: 2 })[a] - ({ exact: 0, prefix: 1, contains: 2 })[b]));
  });

  it('is deterministic across identical calls', () => {
    const a = searchDictionary('ki').results.map((r) => r.entry.latin);
    const b = searchDictionary('ki').results.map((r) => r.entry.latin);
    expect(a).toEqual(b);
  });

  it('reports both sides when a query hits a headword and a gloss', () => {
    // `ge` is a headword; it is also inside "a recitation-house" and "gos"…
    const res = searchDictionary('ge');
    const row = res.results.find((r) => r.entry.latin === 'ge');
    expect(row?.sides).toContain('latin');
    const gloss = res.results.find((r) => r.entry.latin === 'kiyavaage');
    expect(gloss?.sides).toEqual(['latin']);
  });

  it('finds a multi-word English gloss, which a prefix index would miss', () => {
    // 67.8% of the shipped glosses are multi-word; "water" is not the first word
    // of "a kind of water plant".
    const res = searchDictionary('water');
    const found = res.results.map((r) => r.entry.latin);
    expect(found).toContain('fenu');
    expect(found).toContain('fengandu');
    expect(res.results.find((r) => r.entry.latin === 'fen')?.kind).toBe('exact');
  });

  it('reports an EXACT total, not a scan cap', () => {
    const all = searchDictionary('a', 200);
    const capped = searchDictionary('a', 2);
    expect(capped.results).toHaveLength(2);
    // The denominator is the same whether or not the list was truncated —
    // otherwise "showing 2 of N" would be a lie.
    expect(capped.total).toBe(all.total);
    expect(capped.total).toBeGreaterThan(capped.results.length);
  });

  it('counts each entry once even when it matches on both sides', () => {
    const res = searchDictionary('fen', 200);
    const latins = res.results.map((r) => r.entry.latin);
    expect(new Set(latins).size).toBe(latins.length);
    expect(res.total).toBe(latins.length);
  });

  it('transliterates Thaana input and searches Latin headwords only', () => {
    const res = searchDictionary('ފެން');
    expect(res.query.script).toBe('thaana');
    expect(res.query.transliterated).toBe(true);
    expect(res.query.latin).toBe('fen');
    expect(res.results[0].entry.latin).toBe('fen');
    // The inverted row is reachable from the ASCII path, not this one.
    expect(res.results.every((r) => r.sides.every((s) => s === 'latin'))).toBe(true);
  });

  it('names the key that matched, not the query', () => {
    const res = searchDictionary('fen', 200);
    const inverted = res.results.find((r) => r.entry.latin === 'see');
    expect(inverted?.matchedKeys).toContainEqual({ side: 'english', key: 'fenun' });
  });

  it('accepts a one-character query — MIN_PREFIX_LEN does not apply to browse', () => {
    const res = searchDictionary('g');
    expect(res.total).toBeGreaterThan(0);
    expect(res.results.length).toBeGreaterThan(0);
  });

  it('returns an empty response for a blank query', () => {
    for (const blank of ['', '   ', '\n']) {
      const res = searchDictionary(blank);
      expect(res.query.script).toBe('empty');
      expect(res.total).toBe(0);
      expect(res.results).toEqual([]);
    }
  });

  it('reports the live corpus size, not a stats file', () => {
    expect(searchDictionary('fen').corpusSize).toBe(FIXTURE.length);
  });

  it('hands out copies, so a caller cannot desynchronise the index', () => {
    const first = searchDictionary('fen');
    first.results[0].entry.english.push('MUTATED');
    first.results[0].entry.pos = 'MUTATED';
    const second = searchDictionary('fen');
    expect(second.results[0].entry.english).toEqual(['water']);
    expect(second.results[0].entry.pos).toBe('noun');
  });

  it('leaves the translation path untouched', () => {
    // Browse must not change lookup's thresholds, ranking or cache. `kiyav` is
    // the case `lookup.test.ts` pins: a prefix guess, low confidence, capped.
    searchDictionary('kiyav', 200);
    const hit = translateWord('kiyav', 'dhivehi');
    expect(hit.translations[0].matchType).toBe('prefix');
    expect(hit.confidence).toBe('low');
    expect(hit.translations.length).toBeLessThanOrEqual(5);
  });
});
