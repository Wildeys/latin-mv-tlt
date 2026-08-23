import { useState } from 'react';
import { translate } from '../../core/pipeline';
import type { Direction, PipelineResult } from '../../core/pipeline/types';
import { saveLastResult } from '../../lib/lastTrace';

const SAMPLE_DV = 'އަހަރެން މާލެ ދާނަން';
const SAMPLE_EN = 'I will go to Malé.';

export default function Translator({ onOpenBreakdown }: { onOpenBreakdown: () => void }) {
  const [direction, setDirection] = useState<Direction>('dv-en');
  const [input, setInput] = useState(SAMPLE_DV);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);

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
            onChange={(e) => setInput(e.target.value)}
            rows={6}
            dir={direction === 'dv-en' ? 'rtl' : 'ltr'}
            className={`w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-sm ${
              direction === 'dv-en' ? 'font-thaana text-lg' : ''
            }`}
          />
        </label>
        <div className="space-y-2">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Output</span>
          <div className="min-h-[10rem] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-sm">
            {result?.available ? (
              <p className={direction === 'en-dv' ? 'font-thaana text-lg' : ''} dir={direction === 'en-dv' ? 'rtl' : 'ltr'}>
                {result.output}
              </p>
            ) : result ? (
              <div className="space-y-2">
                <p className="text-amber-700 dark:text-amber-300 font-medium">Final translation: Unavailable</p>
                <p className="text-xs text-slate-500">
                  Realization model is not loaded. The extracted frame is shown below — that is the honest output of the
                  current pipeline.
                </p>
                <p className="font-mono text-xs">{trace?.frameString}</p>
              </div>
            ) : (
              <p className="text-slate-400">Translate to see the frame and, if a model is loaded, the sentence.</p>
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
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
