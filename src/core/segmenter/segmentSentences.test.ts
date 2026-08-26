import { describe, expect, it } from 'vitest';
import { segmentSentences } from './textProcessor';

/**
 * R-5.7. Each of these was a real defect: the ellipsis and empty-fragment cases
 * are recorded in Context/STATUS.md as deliberately-left under v0.1, and Dhivehi
 * punctuation was never a boundary at all.
 *
 * The stakes changed with v0.2. Every segment is one model inference, so a bogus
 * `"."` fragment is no longer cosmetic — it is a wasted decode whose empty output
 * then fails the R-5.4 all-sentences-succeeded guard and marks the whole
 * translation unavailable.
 */
describe('segmentSentences', () => {
  it('splits on Latin terminators', () => {
    expect(segmentSentences('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
  });

  it('treats a run of terminators as one boundary', () => {
    // Was: ['a.', '.', '.', 'b'] — three fragments with nothing to translate.
    expect(segmentSentences('a... b')).toEqual(['a...', 'b']);
    expect(segmentSentences('Really?! Yes.')).toEqual(['Really?!', 'Yes.']);
  });

  it('never emits a segment without a letter or digit', () => {
    for (const segment of segmentSentences('... !! ?? Hello.')) {
      expect(segment).toMatch(/[\p{L}\p{N}]/u);
    }
    expect(segmentSentences('...')).toEqual([]);
    expect(segmentSentences('. . .')).toEqual([]);
  });

  it('splits on Dhivehi punctuation', () => {
    // ۔ (U+06D4) is used in Dhivehi text and was previously not a boundary, so a
    // whole paragraph of Thaana reached the model as a single sentence.
    expect(segmentSentences('އަހަރެން މާލެއަށް ދިޔައީމެވެ۔ އޭނާ ދިޔައެވެ۔')).toEqual([
      'އަހަރެން މާލެއަށް ދިޔައީމެވެ۔',
      'އޭނާ ދިޔައެވެ۔',
    ]);
    expect(segmentSentences('ކިހިނެއް؟ ރަނގަޅު.')).toEqual(['ކިހިނެއް؟', 'ރަނގަޅު.']);
  });

  it('treats line breaks as hard boundaries', () => {
    expect(segmentSentences('Headline\nBody text.')).toEqual(['Headline', 'Body text.']);
    expect(segmentSentences('a\n\n\nb')).toEqual(['a', 'b']);
  });

  it('keeps closing quotes with the sentence they close', () => {
    expect(segmentSentences('He said "go." Then left.')).toEqual(['He said "go."', 'Then left.']);
  });

  it('returns nothing for empty or blank input', () => {
    // Feeds the R-5.4 guard: no sentences means unavailable, never empty success.
    expect(segmentSentences('')).toEqual([]);
    expect(segmentSentences('   ')).toEqual([]);
    expect(segmentSentences('​')).toEqual([]);
  });

  it('keeps unterminated trailing text', () => {
    expect(segmentSentences('One. Two')).toEqual(['One.', 'Two']);
  });
});
