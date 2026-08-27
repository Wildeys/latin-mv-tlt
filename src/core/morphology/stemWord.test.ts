import { describe, expect, it } from 'vitest';
import { stemWord } from './suffixParser';

/**
 * `stemWord` is the depth-limited breadth-first suffix stripper and the most
 * intricate function in the core, but the suffix suite only ever exercised
 * `parseSuffix`. These cases pin its actual contract.
 */
const LEXICON = new Set(['indhu', 'male', 'ge', 'fen', 'meehu', 'beynun', 'kiyavaa']);
const known = (latin: string) => LEXICON.has(latin);

describe('stemWord', () => {
  it('returns the word unchanged when it is already a headword', () => {
    expect(stemWord('indhu', known)).toEqual({ root: 'indhu', suffixes: [], englishHints: [] });
  });

  it('strips a single case suffix', () => {
    const result = stemWord('indhuge', known);
    expect(result?.root).toBe('indhu');
    expect(result?.suffixes).toContain('ge');
  });

  it('strips the locative and the dative', () => {
    expect(stemWord('malegai', known)?.root).toBe('male');
    expect(stemWord('geah', known)?.root).toBe('ge');
  });

  it('gives up honestly on an unknown root', () => {
    expect(stemWord('zzzzqqqqge', known)).toBeNull();
  });

  it('refuses to strip down to a stub root', () => {
    // A one or two character root is not a real stem; MIN_STEM_LEN guards it.
    expect(stemWord('age', known)).toBeNull();
  });

  it('handles an empty or blank input', () => {
    expect(stemWord('', known)).toBeNull();
    expect(stemWord('   ', known)).toBeNull();
  });

  it('composes spelling variants instead of applying them one at a time', () => {
    // `ghaqee` needs BOTH gh→g and q→g. Each rule used to be applied to the
    // original word only, so the composed form the lexicon holds was never tried.
    const lexicon = (latin: string) => latin === 'gagee';
    expect(stemWord('ghaqee', lexicon)?.root).toBe('gagee');
  });

  it('collects the English hints for the suffixes it stripped', () => {
    const result = stemWord('indhuge', known);
    expect(result?.englishHints.join(' ')).toContain('of');
  });
});
