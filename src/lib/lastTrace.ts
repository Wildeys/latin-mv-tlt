import type { PipelineResult } from '../core/pipeline/types';

const KEY = 'latin-mv-tlt:last-result';

export function saveLastResult(result: PipelineResult) {
  sessionStorage.setItem(KEY, JSON.stringify(result));
}

export function loadLastResult(): PipelineResult | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PipelineResult;
  } catch {
    return null;
  }
}
