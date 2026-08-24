import { describe, expect, it, vi } from 'vitest';
import { loadDictionaryFromData } from '../dictionary/lookup';
import { translateEnToDvSentence } from './enToDv';

vi.mock('../realization/runner', () => ({
  realizeDhivehiLatin: vi.fn(async () => ({
    status: 'ready',
    text: 'aharen maleah dhaanan',
    modelId: 'test',
  })),
  realizeEnglish: vi.fn(async () => ({
    status: 'not_configured',
    text: null,
    modelId: null,
  })),
}));

describe('EN to DV application output', () => {
  it('converts T5 Latin to Thaana for the user, keeping Latin on the trace', async () => {
    loadDictionaryFromData([]);
    const trace = await translateEnToDvSentence('I will go to Male.');
    expect(trace.latin).toBe('aharen maleah dhaanan');
    expect(trace.latin).not.toMatch(/[\u0780-\u07BF]/);
    expect(trace.thaana).toMatch(/[\u0780-\u07BF]/);
    expect(trace.output).toBe(trace.thaana);
    expect(trace.thaanaPreserved).toEqual([]);
  });
});
