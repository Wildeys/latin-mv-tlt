import { describe, expect, it, vi } from 'vitest';
import { loadDictionaryFromData } from '../dictionary/lookup';
import { translateEnToDvSentence } from './enToDv';

/**
 * The one place a "ready" model is simulated, so the en→dv asymmetry can be
 * asserted: the model emits **Latin**, and Thaana is produced from it by the
 * rule-based reverse transliterator. The model never emits Thaana.
 *
 * That split is what makes the Latin-IR hypothesis testable — get it backwards
 * and the model would be learning Thaana orthography after all.
 */
vi.mock('../translate/runner', () => ({
  translateText: vi.fn(async () => ({
    status: 'ready',
    text: 'aharen maleah dhaanan',
    modelId: 'dv-en-translate',
  })),
  ensureTranslationModel: vi.fn(async () => 'ready'),
  getTranslationStatus: () => 'ready',
  getTranslationError: () => undefined,
  getConfiguredModel: () => 'dv-en-translate',
  onLoadProgress: () => () => {},
}));

describe('EN to DV application output', () => {
  it('converts model Latin to Thaana for the user, keeping Latin on the trace', async () => {
    loadDictionaryFromData([]);
    const trace = await translateEnToDvSentence('I will go to Male.');
    expect(trace.latin).toBe('aharen maleah dhaanan');
    expect(trace.latin).not.toMatch(/[ހ-޿]/);
    expect(trace.thaana).toMatch(/[ހ-޿]/);
    expect(trace.output).toBe(trace.thaana);
    expect(trace.thaanaPreserved).toEqual([]);
  });

  it('reports the raw model output separately from the final Thaana', async () => {
    // R-6.2 requires the raw output on the Breakdown. It must be the model's
    // own string, not the back-transliterated result.
    loadDictionaryFromData([]);
    const trace = await translateEnToDvSentence('I will go to Male.');
    expect(trace.modelOutput).toBe('aharen maleah dhaanan');
    expect(trace.modelOutput).not.toBe(trace.output);
    expect(trace.stages.translation).toBe('done');
    expect(trace.stages.backTransliteration).toBe('done');
    expect(trace.stages.final).toBe('done');
  });

  it('round-trips the dative through the reverse transliterator', async () => {
    // `maleah` is the dative -ah, which before v0.2 reverse-mapped to ހް rather
    // than ށް. It is pervasive in the corpus, so a regression here would be
    // visible in almost every en→dv output.
    loadDictionaryFromData([]);
    const trace = await translateEnToDvSentence('I will go to Male.');
    expect(trace.thaana).toContain('ށް');
  });
});
