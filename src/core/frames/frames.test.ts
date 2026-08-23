import { describe, expect, it } from 'vitest';
import { extractEnFrame } from './extractEn';
import { extractDvFrame } from './extractDv';
import { serializeFrame } from './serialize';
import { mapEnglishFrameToLatin } from './mapSlots';
import { loadDictionaryFromData, translateWord } from '../dictionary/lookup';

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

describe('Dhivehi frame extractor', () => {
  it('fills subject, location, action, and future for the demo sentence', () => {
    loadDictionaryFromData([]);
    const words = ['aharen', 'maale', 'dhaanan'];
    const lookups = words.map((w) => translateWord(w, 'dhivehi'));
    const frame = extractDvFrame(words, lookups);
    expect(frame.subject).toBe('I');
    expect(frame.location).toBe('Malé');
    expect(frame.action).toBe('go');
    expect(frame.tense).toBe('future');
    expect(frame.residue).toEqual([]);
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
