import { useEffect, useState } from 'react';
import { translate } from '../../core/pipeline';
import type { Direction, PipelineResult } from '../../core/pipeline/types';
import { onLoadProgress } from '../../core/translate/runner';
import type { LoadProgress } from '../../core/translate/types';
import { hasThaana } from '../../core/segmenter/textProcessor';
import { saveLastResult } from '../../lib/lastTrace';
import { useThaanaIme } from '../hooks/useThaanaIme';

const SAMPLE_DV = 'އަހަރެން މާލެއަށް ދާނަން';
const SAMPLE_EN = 'I will go to Male.';

export default function Translator({ onOpenBreakdown }: { onOpenBreakdown: () => void }) {
  const [direction, setDirection] = useState<Direction>('dv-en');
  const [input, setInput] = useState(SAMPLE_DV);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  // R-6.10: the weights are tens of megabytes. A silent multi-second stall is a
  // defect, so the first download reports progress rather than just spinning.
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const ime = useThaanaIme(direction === 'dv-en');

  useEffect(() => onLoadProgress(setProgress), []);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const next = await translate(input, direction);
      setResult(next);
      saveLastResult(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const trace = result?.traces[0];
  const outputIsThaana = Boolean(result?.available && result.output && hasThaana(result.output));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {(['dv-en', 'en-dv'] as Direction[]).map((d) => (
          <button
            key={d}
            onClick={() => {
              setDirection(d);
              setInput(d === 'dv-en' ? SAMPLE_DV : SAMPLE_EN);
              setResult(null);
              ime.reset();
            }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              direction === d
                ? 'bg-brand-600 text-white'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700'
            }`}
          >
            {d === 'dv-en' ? 'Dhivehi → English' : 'English → Dhivehi'}
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Input</span>
          <textarea
            value={input}
            onChange={(e) => ime.onChange(e, input, setInput)}
            onKeyDown={(e) => ime.onKeyDown(e, input, setInput)}
            onBeforeInput={(e) => ime.onBeforeInput(e, input, setInput)}
            rows={6}
            className={`w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 ${
              direction === 'dv-en' ? 'font-thaana' : 'text-sm'
            }`}
          />
          {direction === 'dv-en' && (
            <p className="text-xs text-slate-500">Type Male Latin (aharen). It converts to Thaana.</p>
          )}
        </label>
        <div className="space-y-2">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Output</span>
          <div className="min-h-[10rem] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-sm">
            {result?.available ? (
              <div className="space-y-2">
                <p className={outputIsThaana ? 'font-thaana' : ''}>{result.output}</p>
                {direction === 'en-dv' && trace?.latin && (
                  <p className="text-xs text-slate-500 font-mono">Latin: {trace.latin}</p>
                )}
              </div>
            ) : result ? (
              <div className="space-y-2">
                <p className="text-amber-700 dark:text-amber-300 font-medium">Final translation: Unavailable</p>
                <p className="text-xs text-slate-500">
                  {trace?.translation.status === 'error'
                    ? (trace.translation.error ?? 'The translation model failed to load.')
                    : 'The translation model is not loaded. Nothing is invented in its place — see the Breakdown for the transliteration, glosses and the exact model input.'}
                </p>
                {trace?.modelInput && <p className="font-mono text-xs">{trace.modelInput}</p>}
              </div>
            ) : (
              <p className="text-slate-400">Translate to see the breakdown and, if the model is loaded, the sentence.</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={run}
          disabled={busy || !input.trim()}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Translate'}
        </button>
        <button
          onClick={onOpenBreakdown}
          disabled={!result}
          className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm font-medium disabled:opacity-50"
        >
          View sentence breakdown
        </button>
      </div>
      {progress && (
        <div className="space-y-1" role="status" aria-live="polite">
          <div className="flex justify-between text-xs text-slate-500">
            <span>Downloading model — {progress.file}</span>
            <span>{progress.progress}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-[width] duration-200"
              style={{ width: `${progress.progress}%` }}
            />
          </div>
          <p className="text-xs text-slate-400">
            First load only. The weights are cached afterwards, so later translations need no network.
          </p>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
