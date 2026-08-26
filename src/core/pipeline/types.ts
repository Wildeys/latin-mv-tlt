import type { WordTranslation } from '../dictionary/types';
import type { TranslationResult } from '../translate/types';

export type Direction = 'dv-en' | 'en-dv';

/**
 * R-5.3. `error` is new in v0.2: v0.1 had no such state, so a failed ONNX load
 * rendered identically to "never asked for" — which is wrong on the face of it
 * and contradicts R-3.8's requirement that the underlying error be surfaced.
 */
export type StageState = 'done' | 'empty' | 'not_loaded' | 'unavailable' | 'error';

/**
 * The record of one sentence's journey (R-5.2). This is not a debug artefact —
 * the Breakdown screen is a first-class deliverable (R-6.2), and every field here
 * appears on it.
 *
 * v0.2 removes `englishFrame`, `latinFrame`, `frameString`, `latinFrameString`
 * and `stages.frame`; the semantic frame no longer exists. `modelInput`,
 * `modelOutput` and `translation` replace them. `dictionary`, `latin`, `thaana`,
 * `thaanaPreserved`, `register` and the remaining stages are unchanged, because
 * the glosses and the Latin pivot survive the architecture change intact.
 */
export type PipelineTrace = {
  direction: Direction;
  /** The normalised source sentence. */
  input: string;
  /**
   * dv→en: the transliterated source.
   * en→dv: the model's OUTPUT Latin, not the input. That asymmetry is
   * deliberate — Latin is the pivot, so it sits on whichever side faces Thaana.
   */
  latin: string;
  thaana: string | null;
  /** Latin the reverse transliterator could not map (R-1.3). */
  thaanaPreserved: string[];
  dictionary: WordTranslation[];
  /** Exactly what was handed to the model, prefix included (R-2.5, R-6.2). */
  modelInput: string;
  /** Exactly what came back, before any post-processing (R-6.2). */
  modelOutput: string | null;
  translation: TranslationResult;
  output: string | null;
  register: string;
  stages: {
    original: StageState;
    transliteration: StageState;
    dictionary: StageState;
    translation: StageState;
    backTransliteration: StageState;
    final: StageState;
  };
};

export type PipelineResult = {
  /** The raw, un-normalised full text as the user typed it. */
  input: string;
  output: string | null;
  available: boolean;
  traces: PipelineTrace[];
};
