import { describe, expect, it } from 'vitest';
import { extractWordsOnly, segmentSentences, tokenizeWords } from './textProcessor';

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

  it('does not split a decimal number', () => {
    // Was: ['3.', '14 is pi.'] — two segments, two inferences, and a number that
    // no longer exists in either of them.
    expect(segmentSentences('3.14 is pi.')).toEqual(['3.14 is pi.']);
    expect(segmentSentences('It cost 1.5 million. Really.')).toEqual([
      'It cost 1.5 million.',
      'Really.',
    ]);
  });

  it('does not split a known abbreviation', () => {
    // Was: ['Dr.', 'Smith went.'].
    expect(segmentSentences('Dr. Smith went.')).toEqual(['Dr. Smith went.']);
    expect(segmentSentences('Cats, dogs etc. live here.')).toEqual(['Cats, dogs etc. live here.']);
  });

  it('does not split a capitalised initial or a dotted initialism', () => {
    expect(segmentSentences('J. Smith went.')).toEqual(['J. Smith went.']);
    expect(segmentSentences('e.g. this one.')).toEqual(['e.g. this one.']);
    expect(segmentSentences('The U.S. said no.')).toEqual(['The U.S. said no.']);
  });

  it('still splits on a terminator run even after a single letter', () => {
    // The abbreviation exceptions are checked only when the next character is not
    // itself a terminator, so the run rule is untouched.
    expect(segmentSentences('a... b')).toEqual(['a...', 'b']);
    expect(segmentSentences('a. b')).toEqual(['a. b']);
  });
});

/**
 * R-5.8. Segmentation and tokenization are separate rules over the same text, so
 * they are separate requirements — but the tokenizer had no test at all until the
 * rule existed, which is how three divergent definitions accumulated unnoticed.
 */
describe('tokenizeWords / extractWordsOnly (R-5.8)', () => {
  it('keeps a decimal or thousands-separated number as one token', () => {
    // Was: ['3', '.', '14'] — a bare `.` in the word list, and no number left.
    expect(tokenizeWords('3.14')).toEqual(['3.14']);
    expect(tokenizeWords('1,000')).toEqual(['1,000']);
    expect(tokenizeWords('It cost 1.5 million.')).toEqual([
      'It',
      'cost',
      '1.5',
      'million',
      '.',
    ]);
  });

  it('keeps contractions and hyphenated forms as words', () => {
    // The old `/^[a-zA-Z]+$/` filter discarded both before the lexicon saw them.
    expect(extractWordsOnly("don't")).toEqual(["don't"]);
    expect(extractWordsOnly('a well-known case')).toEqual(['a', 'well-known', 'case']);
  });

  it('drops punctuation and bare numbers from the word list', () => {
    expect(extractWordsOnly('Two cats, 3 dogs!')).toEqual(['Two', 'cats', 'dogs']);
  });

  it('tokenizes Thaana and Latin with the same function', () => {
    expect(extractWordsOnly('އަހަރެން މާލެއަށް')).toEqual(['އަހަރެން', 'މާލެއަށް']);
  });

  it('is the definition both pipeline directions use', async () => {
    // enToDv used to split English on its own regex, so the Breakdown could list
    // different words than the pipeline analysed for the same sentence.
    const { translateEnToDvSentence } = await import('../pipeline/enToDv');
    const trace = await translateEnToDvSentence("I don't like 3.14 cats.");
    expect(trace.dictionary.map((w) => w.input)).toEqual(extractWordsOnly("I don't like 3.14 cats."));
  });
});
