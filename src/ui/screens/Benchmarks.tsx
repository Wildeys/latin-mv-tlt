import { useEffect, useState } from 'react';
import { getDictionaryStats } from '../../core/dictionary/lookup';

type BenchmarksFile = {
  notes: string;
  metrics: Array<{ group: string; name: string; value: string; source: string }>;
};

export default function Benchmarks() {
  const [file, setFile] = useState<BenchmarksFile | null>(null);
  const stats = getDictionaryStats();

  useEffect(() => {
    fetch('./data/benchmarks.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setFile(data as BenchmarksFile | null))
      .catch(() => setFile(null));
  }, []);

  const live = stats
    ? [
        { group: 'DICTIONARY', name: 'Raw DB rows', value: String(stats.rawDbRows), source: 'export script' },
        { group: 'DICTIONARY', name: 'Unique Thaana', value: String(stats.uniqueThaana), source: 'export script' },
        { group: 'DICTIONARY', name: 'Unique Latin', value: String(stats.uniqueLatin), source: 'export script' },
        { group: 'DICTIONARY', name: 'Entries with English', value: String(stats.entriesWithEnglish), source: 'export script' },
        { group: 'DICTIONARY', name: 'Final exported entries', value: String(stats.finalExportedEntries), source: 'export script' },
      ]
    : [];

  const rows = [...live, ...(file?.metrics ?? [])];

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Only metrics produced by this pipeline. Empty or “not measured” cells are honest. Do not invent BLEU or human
        scores.
      </p>
      {file?.notes && <p className="text-xs text-slate-500">{file.notes}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Group</th>
              <th className="px-3 py-2 font-medium">Metric</th>
              <th className="px-3 py-2 font-medium">Value</th>
              <th className="px-3 py-2 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.group}-${row.name}`} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 text-slate-500">{row.group}</td>
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2 font-mono">{row.value}</td>
                <td className="px-3 py-2 text-slate-500">{row.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
