import { extractEnFrame } from '../frames/extractEn';
import { mapEnglishFrameToLatin } from '../frames/mapSlots';
import { serializeFrame } from '../frames/serialize';
import { realizeDhivehiLatin } from '../realization/runner';
import { segmentSentences } from '../segmenter/textProcessor';
import { latinToThaana } from '../transliterator/latinToThaana';
import { translateWord, type WordTranslation } from '../dictionary';
import { normalise } from '../normalize';
import type { PipelineResult, PipelineTrace } from './types';

function dictionaryForEnglish(text: string): WordTranslation[] {
  return text
    .split(/[^A-Za-zÁÉÍÓÚáéíóú'-]+/)
    .filter(Boolean)
    .map((word) => translateWord(word, 'english'));
}

export async function translateEnToDvSentence(sentence: string): Promise<PipelineTrace> {
  const source = normalise(sentence);
  const englishFrame = extractEnFrame(source);
  const latinFrame = mapEnglishFrameToLatin(englishFrame);
  const frameString = serializeFrame(englishFrame);
  const latinFrameString = serializeFrame(latinFrame);
  const dictionary = dictionaryForEnglish(source);
  const realization = await realizeDhivehiLatin(latinFrameString);
  const loaded = realization.status === 'ready' && Boolean(realization.text);
  const latin = loaded ? realization.text! : '';
  const thaana = loaded ? latinToThaana(latin) : null;

  return {
    direction: 'en-dv',
    input: source,
    latin,
    dictionary,
    englishFrame,
    latinFrame,
    frameString,
    latinFrameString,
    realization,
    output: loaded ? thaana : null,
    thaana,
    register: 'neutral',
    stages: {
      original: 'done',
      transliteration: loaded ? 'done' : 'unavailable',
      dictionary: dictionary.length ? 'done' : 'empty',
      frame: frameString ? 'done' : 'empty',
      realization: loaded ? 'done' : 'not_loaded',
      final: loaded ? 'done' : 'unavailable',
    },
  };
}

export async function translateEnToDv(text: string): Promise<PipelineResult> {
  const sentences = segmentSentences(normalise(text));
  const traces = [];
  for (const sentence of sentences) {
    traces.push(await translateEnToDvSentence(sentence));
  }
  const available = traces.every((t) => t.output);
  return {
    input: text,
    output: available ? traces.map((t) => t.output).join(' ') : null,
    available,
    traces,
  };
}
