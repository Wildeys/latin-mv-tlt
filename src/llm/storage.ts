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

export function loadSettings(): LlmSettings {
  const raw = localStorage.getItem(LOCAL_KEY) || sessionStorage.getItem(SESSION_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as LlmSettings) };
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
