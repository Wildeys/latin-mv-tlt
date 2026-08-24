import { describe, expect, it } from 'vitest';
import { extractDvFrame } from './extractDv';
import { loadDictionaryFromData, translateWord } from '../dictionary/lookup';
import type { DictionaryEntry } from '../dictionary/types';

const LEXICON: DictionaryEntry[] = [
  { latin: 'aharen', english: ['I', 'me'], pos: 'pronoun', frequency: 800 },
  { latin: 'male', english: ['Male'], pos: 'proper', frequency: 300 },
  { latin: 'nubai', english: ['evil', 'not good'], pos: 'adjective', frequency: 120 },
  { latin: 'dhaanan', english: ['go'], pos: 'verb', frequency: 250 },
];

function frameFor(words: string[]) {
  loadDictionaryFromData(LEXICON);
  return extractDvFrame(
    words,
    words.map((w) => translateWord(w, 'dhivehi')),
  );
}

describe('Dhivehi frame extractor', () => {
  it('reads the standalone particle nu as negation', () => {
    expect(frameFor(['aharen', 'maleah', 'nu', 'dhaanan']).polarity).toBe('negative');
  });

  it('does not flip polarity for a known word that merely begins with nu', () => {
    // `nubai` means "evil". The old prefix test made every nu- word negative,
    // and nothing could reset it. Polarity reversal is the one error the frame
    // contract cannot tolerate.
    expect(frameFor(['aharen', 'nubai']).polarity).toBe('affirmative');
  });

  it('still treats an unknown nu- form as a negated verb', () => {
    expect(frameFor(['aharen', 'nudhaanan']).polarity).toBe('negative');
  });

  it('marks eve as written register rather than dropping it', () => {
    const frame = frameFor(['aharen', 'maleah', 'dhaanan', 'eve']);
    expect(frame.register).toBe('written');
    expect(frame.residue).not.toContain('eve');
  });

  it('defaults to spoken register', () => {
    expect(frameFor(['aharen', 'dhaanan']).register).toBe('spoken');
  });

  it('recognises a dative-marked place as the location slot', () => {
    expect(frameFor(['aharen', 'maleah', 'dhaanan']).location).toBeTruthy();
  });
});
