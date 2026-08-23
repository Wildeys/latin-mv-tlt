export type RealizationStatus = 'not_loaded' | 'loading' | 'ready' | 'error';

export type RealizationResult = {
  status: RealizationStatus;
  text: string | null;
  modelId: string | null;
  error?: string;
};
