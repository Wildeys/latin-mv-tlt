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
    const controller = new AbortController();
    fetch('./data/benchmarks.json', { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setFile(data as BenchmarksFile | null))
      .catch(() => setFile(null));
    return () => controller.abort();
  }, []);

  // Only render counters the stats file actually carries. The Thaana count is
  // gone: the shipped lexicon is Latin only (Context/PROJECT.md).
  const liveKeys: Array<[string, string]> = [
    ['rawDbRows', 'Raw DB rows'],
    ['uniqueLatin', 'Unique Latin'],
    ['entriesWithEnglish', 'Entries with English'],
    ['finalExportedEntries', 'Final exported entries'],
    ['invertedFlipped', 'Inverted rows repaired'],
    ['quarantined', 'Rows quarantined'],
    ['keysRecovered', 'Lookup keys recovered'],
  ];
  const live = stats
    ? liveKeys
        .filter(([key]) => stats[key] !== undefined)
        .map(([key, name]) => ({
          group: 'DICTIONARY',
          name,
          value: String(stats[key]),
          source: 'build script',
        }))
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
