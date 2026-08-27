import type { LlmSettings } from './types';

const SESSION_KEY = 'latin-mv-tlt:llm-session';
const LOCAL_KEY = 'latin-mv-tlt:llm-local';

export const DEFAULT_SETTINGS: LlmSettings = {
  provider: 'api',
  apiUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: '',
  remember: false,
};

/**
 * Spreading a stored blob over the defaults lets an explicit `null` *overwrite* a
 * default rather than fall back to it, so `{"apiUrl": null}` in storage produced
 * settings with no URL and the adapter then threw a raw TypeError on it. Drop
 * null and undefined values before the spread, so the defaults survive them.
 */
function withoutNulls(stored: Partial<LlmSettings>): Partial<LlmSettings> {
  return Object.fromEntries(
    Object.entries(stored).filter(([, value]) => value !== null && value !== undefined),
  ) as Partial<LlmSettings>;
}

export function loadSettings(): LlmSettings {
  const raw = localStorage.getItem(LOCAL_KEY) || sessionStorage.getItem(SESSION_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const stored = JSON.parse(raw) as Partial<LlmSettings> | null;
    if (!stored || typeof stored !== 'object') return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...withoutNulls(stored) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: LlmSettings) {
  const payload = JSON.stringify(settings);
  sessionStorage.setItem(SESSION_KEY, payload);
  if (settings.remember) localStorage.setItem(LOCAL_KEY, payload);
  else localStorage.removeItem(LOCAL_KEY);
}
