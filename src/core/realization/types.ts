/**
 * `not_configured` is unused for the local q8 models (they are always named).
 * Tests skip loading ONNX and return `not_loaded`.
 */
export type RealizationStatus =
  | 'not_configured'
  | 'not_loaded'
  | 'loading'
  | 'ready'
  | 'error';

export type RealizationResult = {
  status: RealizationStatus;
  text: string | null;
  modelId: string | null;
  error?: string;
};
