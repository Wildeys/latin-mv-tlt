import { describe, expect, it } from 'vitest';
import { loadDictionaryFromData } from '../dictionary/lookup';
import { DV_EN_PREFIX, EN_DV_PREFIX } from '../translate/prefixes';
import { translateDvToEn, translateDvToEnSentence } from './dvToEn';
import { translateEnToDv, translateEnToDvSentence } from './enToDv';

const AHAREN = 'އަހަރެން';
const MALE = 'މާލެ';
const DHAANAN = 'ދާނަން';

/**
 * These run with no model at all — `MODE === 'test'` short-circuits the runner
 * before it imports the library, which is what makes NFR-6 true. So "without a
 * model" is not a special case here; it is the only case the test suite sees.
 */
describe('pipelines without a translation model', () => {
  it('DV to EN transliterates, glosses, and leaves the translation unavailable', async () => {
    loadDictionaryFromData([
      { latin: 'aharen', english: ['I'], pos: 'pronoun', frequency: 10 },
      { latin: 'male', english: ['Male'], pos: 'noun', frequency: 8 },
    ]);
    const trace = await translateDvToEnSentence(`${AHAREN} ${MALE} ${DHAANAN}`);

    // The stages that need no model still complete (R-1.4).
    expect(trace.latin.toLowerCase()).toContain('aharen');
    expect(trace.stages.transliteration).toBe('done');
    expect(trace.dictionary.length).toBeGreaterThan(0);

    // The model input is built and shown even when the model cannot run it —
    // that is what the Breakdown displays (R-6.2).
    expect(trace.modelInput.startsWith(DV_EN_PREFIX)).toBe(true);
    expect(trace.modelInput).toContain(trace.latin);

    // R-3.9: unavailable, and nothing invented in its place.
    expect(trace.translation.status).not.toBe('ready');
    expect(trace.modelOutput).toBeNull();
    expect(trace.output).toBeNull();
    expect(trace.stages.final).toBe('unavailable');
  });

  it('EN to DV builds the reverse-direction prefix', async () => {
    loadDictionaryFromData([]);
    const trace = await translateEnToDvSentence('I will go to Male.');

    expect(trace.modelInput.startsWith(EN_DV_PREFIX)).toBe(true);
    expect(trace.modelInput).toContain('I will go to Male.');
    // One model, two prefixes (R-3.1) — the prefixes must differ or the
    // direction is not actually expressed.
    expect(DV_EN_PREFIX).not.toBe(EN_DV_PREFIX);

    expect(trace.translation.status).not.toBe('ready');
    expect(trace.output).toBeNull();
  });

  it('reports empty input as unavailable, not as a successful empty translation', async () => {
    // R-5.4. `[].every(...)` is vacuously true, so before the `traces.length > 0`
    // guard this reported empty input as a successful translation with empty
    // output. The guard is named in the spec as a regression guard; this is it.
    loadDictionaryFromData([]);
    for (const text of ['', '   ', '​']) {
      const dv = await translateDvToEn(text);
      const en = await translateEnToDv(text);
      expect(dv.available).toBe(false);
      expect(dv.output).toBeNull();
      expect(en.available).toBe(false);
      expect(en.output).toBeNull();
    }
  });

  it('exposes Thaana on the EN to DV trace; Latin stays ASCII', async () => {
    loadDictionaryFromData([]);
    const trace = await translateEnToDvSentence('I will go to Male.');
    expect(trace).toHaveProperty('thaana');
    expect(trace.thaana).toBeNull();
    expect(trace.output).toBeNull();
    expect(trace.latin).not.toMatch(/[ހ-޿]/);
    expect(trace.thaanaPreserved).toEqual([]);
  });

  it('records paste-in Thaana on the DV to EN trace', async () => {
    loadDictionaryFromData([{ latin: 'aharen', english: ['I'], pos: 'pronoun', frequency: 10 }]);
    const thaana = await translateDvToEnSentence(`${AHAREN} ${MALE} ${DHAANAN}`);
    expect(thaana.thaana).toMatch(/[ހ-޿]/);
    expect(thaana.latin.toLowerCase()).toContain('aharen');
    expect(thaana.output).toBeNull();

    const latin = await translateDvToEnSentence('aharen male dhaanan');
    expect(latin.thaana).toBeNull();
  });

  it('never sends Thaana to the model', async () => {
    // The whole premise of the architecture (§1.1): Thaana Unicode is removed
    // from the model's problem. If Thaana ever reached modelInput, the Latin-IR
    // hypothesis would not be what was actually tested.
    loadDictionaryFromData([]);
    const trace = await translateDvToEnSentence(`${AHAREN} ${MALE} ${DHAANAN}`);
    expect(trace.modelInput).not.toMatch(/[ހ-޿]/);
  });

  it('translates every sentence of multi-sentence input', async () => {
    loadDictionaryFromData([]);
    const result = await translateEnToDv('One thing. Two things.');
    expect(result.traces).toHaveLength(2);
    // R-5.4: a result is available only if EVERY sentence produced output.
    expect(result.available).toBe(false);
  });
});
