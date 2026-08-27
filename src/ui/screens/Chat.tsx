import { useEffect, useRef, useState } from 'react';
import { translateDvToEn, translateEnToDv } from '../../core/pipeline';
import { hasThaana } from '../../core/segmenter/textProcessor';
import { completeEnglish } from '../../llm/adapter';
import { loadSettings, saveSettings } from '../../llm/storage';
import type { ChatMessage, LlmSettings } from '../../llm/types';
import { useThaanaIme } from '../hooks/useThaanaIme';

export default function Chat() {
  const [settings, setSettings] = useState<LlmSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ime = useThaanaIme(true);
  /**
   * The LLM call had no abort path, so a hung endpoint left `busy` true forever:
   * the send button stayed disabled and the only recovery was a page reload.
   */
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  function cancel() {
    inFlight.current?.abort();
    inFlight.current = null;
    setBusy(false);
    setError('Cancelled.');
  }

  function persist(next: LlmSettings) {
    setSettings(next);
    saveSettings(next);
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    if (!settings.apiKey && settings.provider === 'api') {
      setError('No API key. Open Model settings, or use the Translator without an LLM.');
      return;
    }
    setBusy(true);
    setError(null);
    setDraft('');
    ime.reset();
    const userId = crypto.randomUUID();
    const userMsg: ChatMessage = {
      id: userId,
      role: 'user',
      thaana: hasThaana(text) ? text : undefined,
      latin: hasThaana(text) ? undefined : text,
    };
    setMessages((m) => [...m, userMsg]);
    try {
      const inbound = await translateDvToEn(text);
      // No fallback: if the translation is unavailable there is no English, and
      // Chat refuses below. R-6.3 says only English may reach the LLM, and with
      // the frame string gone there is no longer any path by which it could not.
      const englishIn = inbound.available ? (inbound.output ?? '') : '';
      const inboundLatin = inbound.traces.map((t) => t.latin).filter(Boolean).join(' ');
      setMessages((m) =>
        m.map((msg) =>
          msg.id === userId
            ? { ...msg, english: englishIn, latin: inboundLatin || msg.latin }
            : msg,
        ),
      );

      if (!inbound.available) {
        throw new Error(
          'The translation model is not loaded, so there is no English to send to an LLM. Use Translator / Breakdown to inspect the transliteration and glosses.',
        );
      }

      const controller = new AbortController();
      inFlight.current = controller;
      const englishOut = await completeEnglish(settings, englishIn, controller.signal);
      const outbound = await translateEnToDv(englishOut);
      const assistant: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        english: englishOut,
        thaana: outbound.available ? (outbound.output ?? undefined) : undefined,
        latin: outbound.traces.map((t) => t.latin).filter(Boolean).join(' ') || undefined,
      };
      setMessages((m) => [...m, assistant]);
    } catch (err) {
      // `cancel` has already set the message and cleared `busy`.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      inFlight.current = null;
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
            Type Male Latin (aharen). It converts to Thaana. The translator produces English, an optional LLM replies in
            English, then the reverse pipeline returns Thaana. Without the translation model, Chat will refuse rather
            than invent a sentence.
          </p>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`max-w-[85%] ${msg.role === 'user' ? 'ml-auto' : ''}`}>
            <div
              className={`rounded-2xl px-4 py-2 text-sm ${
                msg.role === 'user' ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800'
              }`}
            >
              {msg.thaana && <p className="font-thaana">{msg.thaana}</p>}
              {msg.latin && (
                <p className={`text-xs mt-1 font-mono ${msg.thaana ? 'opacity-80' : ''}`}>
                  {msg.thaana ? `Latin: ${msg.latin}` : msg.latin}
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
          onChange={(e) => ime.onChange(e, draft, setDraft)}
          onKeyDown={(e) => {
            ime.onKeyDown(e, draft, setDraft);
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) send();
          }}
          onBeforeInput={(e) => ime.onBeforeInput(e, draft, setDraft)}
          placeholder="Type Male Latin (aharen)..."
          className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-thaana"
        />
        {busy ? (
          // Reachable while the request is in flight, so a hung endpoint no
          // longer needs a page reload to recover from.
          <button
            onClick={cancel}
            className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-medium"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={send}
            disabled={!draft.trim()}
            className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-medium disabled:opacity-50"
          >
            Send
          </button>
        )}
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
