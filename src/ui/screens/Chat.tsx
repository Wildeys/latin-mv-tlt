import { useState } from 'react';
import { translateDvToEn, translateEnToDv } from '../../core/pipeline';
import { completeEnglish } from '../../llm/adapter';
import { loadSettings, saveSettings } from '../../llm/storage';
import type { ChatMessage, LlmSettings } from '../../llm/types';

export default function Chat() {
  const [settings, setSettings] = useState<LlmSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function persist(next: LlmSettings) {
    setSettings(next);
    saveSettings(next);
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setDraft('');
    const user: ChatMessage = { id: crypto.randomUUID(), role: 'user', thaana: text };
    setMessages((m) => [...m, user]);
    try {
      const inbound = await translateDvToEn(text);
      const englishIn = inbound.available
        ? inbound.output!
        : inbound.traces.map((t) => t.frameString).join('\n');
      user.english = englishIn;

      if (!settings.apiKey && settings.provider === 'api') {
        throw new Error('No API key. Open Model settings, or use the Translator without an LLM.');
      }
      if (!inbound.available) {
        throw new Error(
          'Realization model is not loaded, so there is no fluent English to send to an LLM. Use Translator / Breakdown to inspect the frame.',
        );
      }

      const englishOut = await completeEnglish(settings, englishIn);
      const outbound = await translateEnToDv(englishOut);
      const assistant: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        english: englishOut,
        thaana: outbound.available ? outbound.output! : undefined,
      };
      setMessages((m) => [...m, assistant]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-3xl mx-auto">
      <div className="flex justify-end mb-3">
        <button onClick={() => setShowSettings((s) => !s)} className="text-sm text-brand-600 font-medium">
          Model settings
        </button>
      </div>
      {showSettings && <SettingsForm settings={settings} onChange={persist} />}
      <div className="flex-1 overflow-y-auto space-y-3 rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900">
        {messages.length === 0 && (
          <p className="text-sm text-slate-500">
            Type Dhivehi. The translator produces English, an optional LLM replies in English, then the reverse
            pipeline returns Dhivehi. Without a realization model, Chat will refuse rather than invent a sentence.
          </p>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`max-w-[85%] ${msg.role === 'user' ? 'ml-auto' : ''}`}>
            <div
              className={`rounded-2xl px-4 py-2 text-sm ${
                msg.role === 'user' ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800'
              }`}
            >
              {msg.thaana && (
                <p className="font-thaana text-base" dir="rtl">
                  {msg.thaana}
                </p>
              )}
              {msg.english && <p className="text-xs opacity-80 mt-1">{msg.english}</p>}
            </div>
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="މިތަނުގައި ލިޔޭ..."
          dir="rtl"
          className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-thaana"
        />
        <button
          onClick={send}
          disabled={busy}
          className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-medium disabled:opacity-50"
        >
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function SettingsForm({
  settings,
  onChange,
}: {
  settings: LlmSettings;
  onChange: (s: LlmSettings) => void;
}) {
  return (
    <div className="mb-4 rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 bg-white dark:bg-slate-900 text-sm">
      <div className="flex gap-3">
        {(['api', 'ollama', 'browser'] as const).map((p) => (
          <label key={p} className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={settings.provider === p}
              onChange={() =>
                onChange({
                  ...settings,
                  provider: p,
                  apiUrl: p === 'ollama' ? 'http://localhost:11434/v1' : settings.apiUrl,
                })
              }
            />
            {p === 'api' ? 'API' : p === 'ollama' ? 'Ollama' : 'Browser model'}
          </label>
        ))}
      </div>
      <label className="block">
        API URL
        <input
          value={settings.apiUrl}
          onChange={(e) => onChange({ ...settings, apiUrl: e.target.value })}
          className="mt-1 w-full rounded-lg border px-3 py-2 dark:bg-slate-950 dark:border-slate-700"
        />
      </label>
      <label className="block">
        Model
        <input
          value={settings.model}
          onChange={(e) => onChange({ ...settings, model: e.target.value })}
          className="mt-1 w-full rounded-lg border px-3 py-2 dark:bg-slate-950 dark:border-slate-700"
        />
      </label>
      <label className="block">
        API key
        <input
          type="password"
          value={settings.apiKey}
          onChange={(e) => onChange({ ...settings, apiKey: e.target.value })}
          className="mt-1 w-full rounded-lg border px-3 py-2 dark:bg-slate-950 dark:border-slate-700"
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={settings.remember}
          onChange={(e) => onChange({ ...settings, remember: e.target.checked })}
        />
        Remember on this device
      </label>
      <p className="text-xs text-slate-500">
        Keys stay in sessionStorage unless you tick remember. They are never written to git or CSV exports.
      </p>
    </div>
  );
}
