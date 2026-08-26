import { translateWord, type WordTranslation } from '../dictionary';
import { buildModelInput } from '../translate/prefixes';
import { translateText } from '../translate/runner';
import { segmentSentences } from '../segmenter/textProcessor';
import { latinToThaanaDetailed } from '../transliterator/latinToThaana';
import { normalise } from '../normalize';
import type { PipelineResult, PipelineTrace, StageState } from './types';

function dictionaryForEnglish(text: string): WordTranslation[] {
  return text
    .split(/[^A-Za-zÁÉÍÓÚáéíóú'-]+/)
    .filter(Boolean)
    .map((word) => translateWord(word, 'english'));
}

export async function translateEnToDvSentence(sentence: string): Promise<PipelineTrace> {
  const source = normalise(sentence);

  // R-5.6: beside the translation, not an input to it.
  const dictionary = dictionaryForEnglish(source);

  const modelInput = buildModelInput('en-dv', source);
  const translation = await translateText(modelInput);
  const text = translation.status === 'ready' ? translation.text : null;
  const loaded = Boolean(text);

  // The asymmetry that `enToDv.output.test.ts` guards: on this direction `latin`
  // is the model's OUTPUT, and Thaana is derived from it by the rule-based
  // reverse transliterator. The model never emits Thaana itself.
  const latin = text ?? '';
  const converted = loaded ? latinToThaanaDetailed(latin) : null;

  const translationStage: StageState =
    translation.status === 'error' ? 'error' : loaded ? 'done' : 'not_loaded';

  return {
    direction: 'en-dv',
    input: source,
    latin,
    thaana: converted?.thaana ?? null,
    thaanaPreserved: converted?.preserved ?? [],
    dictionary,
    modelInput,
    modelOutput: translation.text,
    translation,
    output: converted?.thaana ?? null,
    register: 'neutral',
    stages: {
      original: 'done',
      // en→dv has no source-side transliteration; the input is already Latin script.
      transliteration: 'empty',
      dictionary: dictionary.length ? 'done' : 'empty',
      translation: translationStage,
      backTransliteration: loaded ? 'done' : 'unavailable',
      final: loaded ? 'done' : 'unavailable',
    },
  };
}

export async function translateEnToDv(text: string): Promise<PipelineResult> {
  const sentences = segmentSentences(normalise(text));

  // Sequential for the same reason as dv→en: one model, one WASM thread.
  const traces: PipelineTrace[] = [];
  for (const sentence of sentences) {
    traces.push(await translateEnToDvSentence(sentence));
  }

  const available = traces.length > 0 && traces.every((t) => t.output);
  return {
    input: text,
    output: available ? traces.map((t) => t.output).join(' ') : null,
    available,
    traces,
  };
}
