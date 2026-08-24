/**
 * `not_configured` means no model id is set in the environment at all;
 * `not_loaded` means one is configured but has not been fetched yet.
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
