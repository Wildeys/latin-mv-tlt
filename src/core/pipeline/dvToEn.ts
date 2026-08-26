import { translateWord, type WordTranslation } from '../dictionary';
import { detectRegister } from '../morphology/honorifics';
import { buildModelInput } from '../translate/prefixes';
import { translateText } from '../translate/runner';
import { hasThaana, prepareSentence, segmentSentences } from '../segmenter/textProcessor';
import { normalise } from '../normalize';
import type { PipelineResult, PipelineTrace, StageState } from './types';

function lookupWords(latinWords: string[]): WordTranslation[] {
  return latinWords.map((word) => translateWord(word, 'dhivehi'));
}

export async function translateDvToEnSentence(sentence: string): Promise<PipelineTrace> {
  const source = normalise(sentence);
  const prepared = prepareSentence(source);
  // prepared.transliterated is already the Thaana-to-Latin conversion when the
  // source is Thaana, and the source itself otherwise. Do not recompute it (R-5.5).
  const latin = prepared.transliterated;
  const latinWords = prepared.latinWords;

  // R-5.6: glossing runs beside translation, never into it. A dictionary miss
  // must not be able to fail a translation.
  const dictionary = lookupWords(latinWords);

  const modelInput = buildModelInput('dv-en', latin);
  const translation = await translateText(modelInput);
  const loaded = translation.status === 'ready' && Boolean(translation.text);

  const register = detectRegister([
    ...dictionary.map((d) => d.stem || d.transliteration || d.input),
    ...latinWords,
  ]);

  const translationStage: StageState =
    translation.status === 'error' ? 'error' : loaded ? 'done' : 'not_loaded';

  return {
    direction: 'dv-en',
    input: source,
    latin,
    thaana: hasThaana(source) ? source : null,
    thaanaPreserved: [],
    dictionary,
    modelInput,
    modelOutput: translation.text,
    translation,
    // R-3.9: no fabricated sentence when the model is unavailable.
    output: loaded ? translation.text : null,
    register,
    stages: {
      original: 'done',
      transliteration: latin ? 'done' : 'empty',
      dictionary: dictionary.length ? 'done' : 'empty',
      translation: translationStage,
      // dv→en ends in English; nothing goes back to Thaana on this path.
      backTransliteration: 'empty',
      final: loaded ? 'done' : 'unavailable',
    },
  };
}

export async function translateDvToEn(text: string): Promise<PipelineResult> {
  const sentences = segmentSentences(normalise(text));

  // Sequential, not Promise.all. There is one model behind this and ORT runs
  // single-threaded (R-3.11), so concurrent calls would contend for one session
  // rather than going faster.
  const traces: PipelineTrace[] = [];
  for (const sentence of sentences) {
    traces.push(await translateDvToEnSentence(sentence));
  }

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
