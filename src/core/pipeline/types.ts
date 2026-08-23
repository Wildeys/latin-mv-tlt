import type { WordTranslation } from '../dictionary/types';
import type { SemanticFrame } from '../frames/types';
import type { RealizationResult } from '../realization/types';

export type Direction = 'dv-en' | 'en-dv';

export type StageState = 'done' | 'empty' | 'not_loaded' | 'unavailable';

export type PipelineTrace = {
  direction: Direction;
  input: string;
  latin: string;
  dictionary: WordTranslation[];
  englishFrame: SemanticFrame;
  latinFrame: SemanticFrame | null;
  frameString: string;
  latinFrameString: string | null;
  realization: RealizationResult;
  output: string | null;
  thaana: string | null;
  register: string;
  stages: {
    original: StageState;
    transliteration: StageState;
    dictionary: StageState;
    frame: StageState;
    realization: StageState;
    final: StageState;
  };
};

export type PipelineResult = {
  input: string;
  output: string | null;
  available: boolean;
  traces: PipelineTrace[];
};
