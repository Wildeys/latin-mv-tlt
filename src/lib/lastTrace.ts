import type { PipelineResult } from '../core/pipeline/types';

// Versioned: a v0.1-shaped trace parses fine but renders as `undefined`, because
// the frame fields the old Breakdown read are gone. Bumping the key retires any
// stale entry left in a tab that was open across the deploy.
const KEY = 'latin-mv-tlt:last-result:v2';

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
