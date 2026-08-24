import { describe, expect, it } from 'vitest';
import { loadDictionaryFromData } from '../dictionary/lookup';
import { translateDvToEn, translateDvToEnSentence } from './dvToEn';
import { translateEnToDv, translateEnToDvSentence } from './enToDv';

const AHAREN = '\u0787\u07A6\u0780\u07A6\u0783\u07AC\u0782\u07B0';
const MALE = '\u0789\u07A7\u078D\u07AC';
const DHAANAN = '\u078B\u07A7\u0782\u07A6\u0782\u07B0';

describe('pipelines without a realization model', () => {
  it('DV to EN produces a frame and leaves the final translation unavailable', async () => {
    loadDictionaryFromData([
      { latin: 'aharen', english: ['I'], pos: 'pronoun', frequency: 10 },
      { latin: 'male', english: ['Male'], pos: 'noun', frequency: 8 },
    ]);
    const trace = await translateDvToEnSentence(`${AHAREN} ${MALE} ${DHAANAN}`);
    expect(trace.latin.toLowerCase()).toContain('aharen');
    expect(trace.frameString).toBeTruthy();
    expect(trace.englishFrame.subject).toBeTruthy();
    expect(trace.englishFrame.location || trace.englishFrame.action || trace.englishFrame.residue.length).toBeTruthy();
    expect(trace.realization.status).toBe('not_configured');
    expect(trace.output).toBeNull();
    expect(trace.stages.final).toBe('unavailable');
    expect(trace.stages.frame).toBe('done');
  });

  it('EN to DV extracts an English frame then a Latin frame', async () => {
    loadDictionaryFromData([]);
    const trace = await translateEnToDvSentence('I will go to Male.');
    expect(trace.englishFrame.subject).toBe('I');
    expect(trace.englishFrame.action).toBe('go');
    expect(trace.latinFrame?.subject).toBe('aharen');
    expect(trace.latinFrame?.action).toBe('dhaa');
    expect(trace.latinFrameString).toContain('SUBJECT=aharen');
    expect(trace.realization.status).toBe('not_configured');
    expect(trace.output).toBeNull();
  });

  it('reports empty input as unavailable, not as a successful empty translation', async () => {
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
    expect(trace.latin).not.toMatch(/[\u0780-\u07BF]/);
    expect(trace.thaanaPreserved).toEqual([]);
  });

  it('records paste-in Thaana on the DV to EN trace', async () => {
    loadDictionaryFromData([
      { latin: 'aharen', english: ['I'], pos: 'pronoun', frequency: 10 },
    ]);
    const thaana = await translateDvToEnSentence(`${AHAREN} ${MALE} ${DHAANAN}`);
    expect(thaana.thaana).toMatch(/[\u0780-\u07BF]/);
    expect(thaana.latin.toLowerCase()).toContain('aharen');
    expect(thaana.output).toBeNull();

    const latin = await translateDvToEnSentence('aharen male dhaanan');
    expect(latin.thaana).toBeNull();
  });
});
