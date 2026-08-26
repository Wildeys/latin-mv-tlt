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
        <textarea value={original} onChange={(e) => setOriginal(e.target.value)} rows={3} className="w-full rounded-xl border p-3 text-sm dark:bg-slate-900 dark:border-slate-700" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Generated</span>
        <textarea value={generated} onChange={(e) => setGenerated(e.target.value)} rows={3} className="w-full rounded-xl border p-3 text-sm dark:bg-slate-900 dark:border-slate-700" />
      </label>
      <Scale label="How accurate is the meaning?" value={meaning} onChange={setMeaning} />
      <Scale label="How natural is the translation?" value={naturalness} onChange={setNaturalness} />
      <label className="block space-y-1">
        <span className="text-sm font-medium">Correct translation (optional)</span>
        <input value={correction} onChange={(e) => setCorrection(e.target.value)} className="w-full rounded-xl border p-3 text-sm dark:bg-slate-900 dark:border-slate-700" />
      </label>
      <div className="flex gap-3">
        <button onClick={onSave} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium">
          Save on this device
        </button>
        <button onClick={downloadFeedbackCsv} className="px-4 py-2 rounded-lg border text-sm font-medium">
          Export CSV
        </button>
      </div>
      {saved && <p className="text-sm text-emerald-700">Saved locally. {count} rating(s) on this device.</p>}
      <p className="text-xs text-slate-500">{count} stored rating(s). Nothing is sent to a server.</p>
    </div>
  );
}

function Scale({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <p className="text-sm font-medium mb-2">{label}</p>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
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
