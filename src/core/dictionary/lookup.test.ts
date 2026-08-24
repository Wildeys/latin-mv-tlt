import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDictionaryStats, loadDictionaryFromData, translateWord } from './lookup';
import type { DictionaryEntry } from './types';

/**
 * A fixture lexicon. The suite used to call `loadDictionaryFromData([])`
 * everywhere, so the prefix path, the English index and the confidence
 * demotion had never actually executed under test.
 */
const FIXTURE: DictionaryEntry[] = [
  { latin: 'kiyavaa', english: ['study'], pos: 'verb', frequency: 900 },
  { latin: 'kiyavaage', english: ['a recitation-house'], pos: 'noun', frequency: 1 },
  { latin: 'kiyavaageri', english: ["a teacher's house"], pos: 'noun', frequency: 1 },
  { latin: 'dhaanan', english: ['will go'], pos: 'verb', frequency: 250 },
  { latin: 'dhaananee', english: ['obscure form'], pos: 'noun', frequency: 1 },
  { latin: 'indhu', english: ['bed'], pos: 'noun', frequency: 120 },
  { latin: 'fen', english: ['water'], pos: 'noun', frequency: 300 },
  { latin: 'meehun', english: ['people'], pos: 'noun', frequency: 200 },
  { latin: 'meehu', english: ['person'], pos: 'noun', frequency: 400 },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('latin lookup', () => {
  it('returns an exact hit at high confidence', () => {
    loadDictionaryFromData(FIXTURE);
    const hit = translateWord('fen', 'dhivehi');
    expect(hit.translations[0].matchType).toBe('exact');
    expect(hit.confidence).toBe('high');
    expect(hit.fallbackUsed).toBeNull();
  });

  it('reports a prefix guess as low confidence, not high', () => {
    loadDictionaryFromData(FIXTURE);
    const hit = translateWord('kiyav', 'dhivehi');
    expect(hit.translations[0].matchType).toBe('prefix');
    expect(hit.confidence).toBe('low');
    expect(hit.fallbackUsed).toBe('prefix');
  });

  it('ranks prefix candidates instead of taking them in file order', () => {
    // `kiyavaage` and `kiyavaageri` precede nothing useful; the shortest
    // extension with the highest frequency should win.
    loadDictionaryFromData([...FIXTURE].reverse());
    const hit = translateWord('kiyav', 'dhivehi');
    expect(hit.translations[0].latin).toBe('kiyavaa');
    expect(hit.translations[0].english[0]).toBe('study');
  });

  it('does not let a prefix guess override a closed-class gloss', () => {
    loadDictionaryFromData(FIXTURE);
    // `dhaa` is closed class. `dhaanan`/`dhaananee` are only prefix matches
    // for it, so the curated gloss must survive.
    const hit = translateWord('dhaa', 'dhivehi');
    expect(hit.translations[0].matchType).toBe('closed_class');
    expect(hit.translations[0].english[0]).toBe('go');
  });

  it('stems an inflected form back to its root', () => {
    loadDictionaryFromData(FIXTURE);
    const hit = translateWord('indhuge', 'dhivehi');
    expect(hit.stem).toBe('indhu');
    expect(hit.translations[0].latin).toBe('indhu');
    expect(hit.confidence).toBe('high');
  });

  it('admits an honest miss rather than guessing', () => {
    loadDictionaryFromData(FIXTURE);
    const hit = translateWord('zzzzqqqq', 'dhivehi');
    expect(hit.confidence).toBe('low');
    expect(hit.fallbackUsed).toBe('transliteration_only');
    expect(hit.translations[0].english[0]).toContain('[unknown:');
  });
});

describe('english lookup', () => {
  it('ranks by gloss position then frequency', () => {
    loadDictionaryFromData(FIXTURE);
    const hit = translateWord('water', 'english');
    expect(hit.translations[0].latin).toBe('fen');
    expect(hit.confidence).toBe('high');
  });

  it('reports an unknown English word as a miss', () => {
    loadDictionaryFromData(FIXTURE);
    const hit = translateWord('quixotic', 'english');
    expect(hit.confidence).toBe('low');
    expect(hit.fallbackUsed).toBe('unknown_english');
  });
});

describe('caching', () => {
  it('returns the memoised object for a repeated lookup', () => {
    loadDictionaryFromData(FIXTURE);
    expect(translateWord('fen', 'dhivehi')).toBe(translateWord('fen', 'dhivehi'));
  });

  it('drops the cache when the dictionary is reloaded', () => {
    loadDictionaryFromData(FIXTURE);
    const before = translateWord('fen', 'dhivehi');
    loadDictionaryFromData(FIXTURE);
    expect(translateWord('fen', 'dhivehi')).not.toBe(before);
  });
});

describe('loadDictionary', () => {
  /** The module keeps its indexes in module scope, so each case needs a fresh copy. */
  async function freshModule() {
    vi.resetModules();
    return import('./lookup');
  }

  it('fetches the dictionary once when called concurrently', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.includes('stats') ? { rawDbRows: 9 } : FIXTURE),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const mod = await freshModule();
    // StrictMode fires the mount effect twice. Without an in-flight promise
    // cache both calls got past `if (loaded)` and re-indexed the whole file.
    await Promise.all([mod.loadDictionary(), mod.loadDictionary(), mod.loadDictionary()]);
    const dictCalls = fetchMock.mock.calls.filter(([url]) => !String(url).includes('stats'));
    expect(dictCalls).toHaveLength(1);
    expect(mod.getEntryCount()).toBe(FIXTURE.length);
  });

  it('reports a 404 instead of a JSON parse error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      })),
    );
    const mod = await freshModule();
    await expect(mod.loadDictionary()).rejects.toThrow(/404/);
  });

  it('keeps the stats object it was given', () => {
    loadDictionaryFromData(FIXTURE, { rawDbRows: 16014, uniqueLatin: 15302 });
    expect(getDictionaryStats()?.uniqueLatin).toBe(15302);
  });
});
