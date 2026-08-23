import { describe, expect, it } from 'vitest';
import { extractEnFrame } from './extractEn';
import { serializeFrame } from './serialize';
import { mapEnglishFrameToLatin } from './mapSlots';
import { loadDictionaryFromData } from '../dictionary/lookup';

describe('English frame extractor', () => {
  it('extracts I will go to Malé', () => {
    const frame = extractEnFrame('I will go to Malé.');
    expect(frame.subject).toBe('I');
    expect(frame.action).toBe('go');
    expect(frame.location).toBe('Malé');
    expect(frame.tense).toBe('future');
    expect(frame.polarity).toBe('affirmative');
    expect(serializeFrame(frame)).toContain('SUBJECT=I');
    expect(serializeFrame(frame)).toContain('ACTION=go');
  });

  it('marks polarity for negation', () => {
    const frame = extractEnFrame('I did not go to Malé.');
    expect(frame.polarity).toBe('negative');
    expect(frame.action).toBe('go');
  });
});

describe('slot mapping', () => {
  it('maps English slots to Dhivehi Latin via the closed class', () => {
    loadDictionaryFromData([]);
    const latin = mapEnglishFrameToLatin(extractEnFrame('I will go to Malé.'));
    expect(latin.subject).toBe('aharen');
    expect(latin.action).toBe('dhaa');
    expect(latin.location).toBe('male');
    expect(latin.tense).toBe('future');
  });
});
