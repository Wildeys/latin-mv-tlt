import { useMemo, useState } from 'react';
import { downloadFeedbackCsv, loadFeedback, saveFeedback } from '../../lib/feedback';
import { loadLastResult } from '../../lib/lastTrace';

export default function Feedback() {
  const last = useMemo(() => loadLastResult(), []);
  const [original, setOriginal] = useState(last?.input ?? '');
  // v0.1 fell back to the frame string here, which meant a rating could be
  // recorded against a rule-based artefact rather than model output. R-8.3
  // forbids reporting those as results, so there is no fallback now.
  const [generated, setGenerated] = useState(last?.output ?? '');
  const [meaning, setMeaning] = useState(3);
  const [naturalness, setNaturalness] = useState(3);
  const [correction, setCorrection] = useState('');
  const [saved, setSaved] = useState(false);
  const [count, setCount] = useState(() => loadFeedback().length);

  /**
   * `saved` used to latch: the confirmation stayed on screen while the fields
   * were edited underneath it, so a second Save on changed text looked like a
   * no-op and silently wrote a duplicate row. Every field goes through this, so
   * the confirmation only ever describes the text that is actually stored.
   */
  function edit<T>(set: (value: T) => void) {
    return (value: T) => {
      setSaved(false);
      set(value);
    };
  }

  function onSave() {
    saveFeedback({
      original,
      generated,
      meaning,
      naturalness,
      correction,
      direction: last?.traces[0]?.direction ?? 'unknown',
    });
    setCount(loadFeedback().length);
    setSaved(true);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <label className="block space-y-1">
        <span className="text-sm font-medium">Original</span>
        <textarea value={original} onChange={(e) => edit(setOriginal)(e.target.value)} rows={3} className="w-full rounded-xl border p-3 text-sm dark:bg-slate-900 dark:border-slate-700" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Generated</span>
        <textarea value={generated} onChange={(e) => edit(setGenerated)(e.target.value)} rows={3} className="w-full rounded-xl border p-3 text-sm dark:bg-slate-900 dark:border-slate-700" />
      </label>
      <Scale label="How accurate is the meaning?" value={meaning} onChange={edit(setMeaning)} />
      <Scale label="How natural is the translation?" value={naturalness} onChange={edit(setNaturalness)} />
      <label className="block space-y-1">
        <span className="text-sm font-medium">Correct translation (optional)</span>
        <input value={correction} onChange={(e) => edit(setCorrection)(e.target.value)} className="w-full rounded-xl border p-3 text-sm dark:bg-slate-900 dark:border-slate-700" />
      </label>
      <div className="flex gap-3">
        <button onClick={onSave} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium">
          Save on this device
        </button>
        <button onClick={downloadFeedbackCsv} className="px-4 py-2 rounded-lg border text-sm font-medium">
          Export CSV
        </button>
      </div>
      <div role="status" aria-live="polite">
        {saved && <p className="text-sm text-emerald-700">Saved locally. {count} rating(s) on this device.</p>}
      </div>
      <p className="text-xs text-slate-500">{count} stored rating(s). Nothing is sent to a server.</p>
    </div>
  );
}

/**
 * The two scales render identical 1–5 buttons. Without a labelled group they are
 * ten buttons called "1".."5" twice over, and nothing — a screen reader or a
 * test — can say which scale a "3" belongs to. `radiogroup` + `radio` is what
 * this control already behaves like: single-select, one of five.
 */
function Scale({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <p className="text-sm font-medium mb-2" id={labelId(label)}>
        {label}
      </p>
      <div className="flex gap-2" role="radiogroup" aria-labelledby={labelId(label)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            onClick={() => onChange(n)}
            className={`w-10 h-10 rounded-lg text-sm font-semibold ${
              value === n ? 'bg-brand-600 text-white' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function labelId(label: string): string {
  return `scale-${label.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`;
}
