import type { LlmSettings } from './types';

export async function completeEnglish(settings: LlmSettings, prompt: string): Promise<string> {
  if (settings.provider === 'browser') {
    throw new Error('Browser LLM is optional and not configured in this build.');
  }

  const url =
    settings.provider === 'ollama'
      ? (settings.apiUrl || 'http://localhost:11434/v1').replace(/\/$/, '')
      : settings.apiUrl.replace(/\/$/, '');

  const response = await fetch(`${url}/chat/completions`, {
    method: 'POST',
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
