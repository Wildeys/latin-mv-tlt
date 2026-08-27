import { DEFAULT_SETTINGS } from './storage';
import type { LlmSettings } from './types';

const OLLAMA_DEFAULT_URL = 'http://localhost:11434/v1';

/**
 * The endpoint for these settings, tolerant of a stored value that is missing,
 * null or blank.
 *
 * `settings.apiUrl.replace(...)` threw `Cannot read properties of null` for the
 * `api` provider whenever storage held `apiUrl: null` — which any hand-edited or
 * older stored blob could carry, because `loadSettings` spreads the stored object
 * over the defaults and an explicit `null` overwrites the default rather than
 * falling back to it. The failure surfaced as a raw TypeError in the Chat error
 * line, with nothing pointing at the setting that caused it.
 */
function endpointFor(settings: LlmSettings): string {
  const fallback =
    settings.provider === 'ollama' ? OLLAMA_DEFAULT_URL : DEFAULT_SETTINGS.apiUrl;
  const raw = (settings.apiUrl ?? '').trim() || fallback;
  return raw.replace(/\/+$/, '');
}

export async function completeEnglish(
  settings: LlmSettings,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  if (settings.provider === 'browser') {
    throw new Error('Browser LLM is optional and not configured in this build.');
  }

  const url = endpointFor(settings);

  let response: Response;
  try {
    response = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant. Reply in clear, simple English.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
      }),
    });
  } catch (err) {
    // An aborted request is a user action, not a failure to report as one.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error(
      `Could not reach the LLM at ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${detail.slice(0, 240)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('LLM returned an empty response.');
  return text;
}
