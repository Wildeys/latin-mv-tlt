import { translateWord, type WordTranslation } from '../dictionary';
import { extractDvFrame } from '../frames/extractDv';
import { serializeFrame } from '../frames/serialize';
import { detectRegister } from '../morphology/honorifics';
import { realizeEnglish } from '../realization/runner';
import { hasThaana, prepareSentence, segmentSentences } from '../segmenter/textProcessor';
import { normalise } from '../normalize';
import type { PipelineResult, PipelineTrace } from './types';

function lookupWords(latinWords: string[]): WordTranslation[] {
  return latinWords.map((word) => translateWord(word, 'dhivehi'));
}

export async function translateDvToEnSentence(sentence: string): Promise<PipelineTrace> {
  const source = normalise(sentence);
  const prepared = prepareSentence(source);
  // prepared.transliterated is already the Thaana-to-Latin conversion when the
  // source is Thaana, and the source itself otherwise. Do not recompute it.
  const latin = prepared.transliterated;
  const latinWords = prepared.latinWords;
  const dictionary = lookupWords(latinWords);
  const englishFrame = extractDvFrame(latinWords, dictionary);
  const frameString = serializeFrame(englishFrame);
  const realization = await realizeEnglish(frameString);
  const loaded = realization.status === 'ready' && Boolean(realization.text);
  const register = detectRegister([
    ...dictionary.map((d) => d.stem || d.transliteration || d.input),
    ...latinWords,
  ]);

  return {
    direction: 'dv-en',
    input: source,
    latin,
    thaana: hasThaana(source) ? source : null,
    thaanaPreserved: [],
    dictionary,
    englishFrame,
    latinFrame: null,
    frameString,
    latinFrameString: null,
    realization,
    output: loaded ? realization.text : null,
    register,
    stages: {
      original: 'done',
      transliteration: latin ? 'done' : 'empty',
      dictionary: dictionary.length ? 'done' : 'empty',
      frame: frameString ? 'done' : 'empty',
      realization: loaded ? 'done' : 'not_loaded',
      final: loaded ? 'done' : 'unavailable',
    },
  };
}

export async function translateDvToEn(text: string): Promise<PipelineResult> {
  const sentences = segmentSentences(normalise(text));
  const traces: PipelineTrace[] = await Promise.all(
    sentences.map((sentence) => translateDvToEnSentence(sentence)),
  );
  // `[].every(...)` is vacuously true, which reported empty input as a
  // successful translation with an empty output. Require at least one sentence.
  const available = traces.length > 0 && traces.every((t) => t.output);
  return {
    input: text,
    output: available ? traces.map((t) => t.output).join(' ') : null,
    available,
    traces,
  };
}
