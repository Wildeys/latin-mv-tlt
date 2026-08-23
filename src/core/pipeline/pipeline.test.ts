import { describe, expect, it } from 'vitest';
import { loadDictionaryFromData } from '../dictionary/lookup';
import { translateDvToEnSentence } from './dvToEn';
import { translateEnToDvSentence } from './enToDv';

const AHAREN = '\u0787\u07A6\u0780\u07A6\u0783\u07AC\u0782\u07B0';
const MALE = '\u0789\u07A7\u078D\u07AC';
const DHAANAN = '\u078B\u07A7\u0782\u07A6\u0782\u07B0';

describe('pipelines without a realization model', () => {
  it('DV to EN produces a frame and leaves the final translation unavailable', async () => {
    loadDictionaryFromData([
      { dhivehi: AHAREN, latin: 'aharen', english: ['I'], pos: 'pronoun', frequency: 10 },
      { dhivehi: MALE, latin: 'male', english: ['Male'], pos: 'noun', frequency: 8 },
    ]);
    const trace = await translateDvToEnSentence(`${AHAREN} ${MALE} ${DHAANAN}`);
    expect(trace.latin.toLowerCase()).toContain('aharen');
    expect(trace.frameString).toBeTruthy();
    expect(trace.englishFrame.subject).toBeTruthy();
    expect(trace.englishFrame.location || trace.englishFrame.action || trace.englishFrame.residue.length).toBeTruthy();
    expect(trace.realization.status).toBe('not_loaded');
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
    expect(trace.realization.status).toBe('not_loaded');
    expect(trace.output).toBeNull();
  });
});
