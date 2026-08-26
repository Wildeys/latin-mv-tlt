/**
 * R-3.8: exactly four states, and the underlying error surfaced on failure.
 *
 * v0.1 carried a fifth, `not_configured`, for a remote-model path this build
 * never had. It was dead in the runner and only ever appeared in a test mock, so
 * it is dropped — a state that cannot occur is a state the UI renders wrong.
 */
export type TranslationStatus = 'not_loaded' | 'loading' | 'ready' | 'error';

export type TranslationResult = {
  status: TranslationStatus;
  /** The model's raw output, or null when it did not produce one (R-3.9). */
  text: string | null;
  modelId: string;
  error?: string;
};

/** Weight-download progress, for R-6.10. */
export type LoadProgress = {
  file: string;
  loaded: number;
  total: number;
  /** 0–100. */
  progress: number;
};
