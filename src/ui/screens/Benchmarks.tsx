import { useEffect, useState } from 'react';
import { getDictionaryStats, getEntryCount } from '../../core/dictionary/lookup';

type BenchmarksFile = {
  notes: string;
  metrics: Array<{ group: string; name: string; value: string; source: string }>;
};

type Row = { group: string; name: string; value: string; source: string };

/**
 * Keys in `dictionary_stats.json` that name a count the build script produced.
 *
 * The previous list asked for `rawDbRows`, `uniqueLatin`, `entriesWithEnglish`,
 * `finalExportedEntries`, `invertedFlipped`, `quarantined` and `keysRecovered` —
 * none of which the shipped file carries. Every row was therefore filtered out
 * and the DICTIONARY group rendered empty, while DESIGN.md §6.1 claimed the
 * screen showed live dictionary counters. This list is the file's actual shape.
 */
const STATS_KEYS: Array<[string, string]> = [
  ['shippedBefore', 'Entries shipped (before frequency merge)'],
  ['shippedAfter', 'Entries shipped (after frequency merge)'],
  ['frequencyUpdatedFromCorpus', 'Frequencies counted from corpus'],
];

/**
 * `source` is an absolute path on the original author's machine
 * (`C:\Users\...\dhivehi_dictionary.db`). It is provenance for whoever ran the
 * build, not a metric, and this page is deployed publicly — so it is excluded by
 * name rather than by happening to fall outside the list above.
 */
const NEVER_RENDER = new Set(['source']);

export default function Benchmarks() {
  const [file, setFile] = useState<BenchmarksFile | null>(null);
  const stats = getDictionaryStats();
  // The live count, from the array the app actually indexed. The Dictionary
  // screen reports the same number from the same place (`res.corpusSize`), so
  // the two screens cannot disagree about how large the lexicon is.
  const liveCount = getEntryCount();

  useEffect(() => {
    const controller = new AbortController();
    fetch('./data/benchmarks.json', { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setFile(data as BenchmarksFile | null))
      .catch(() => setFile(null));
    return () => controller.abort();
  }, []);

  const live: Row[] = [
    {
      group: 'DICTIONARY',
      name: 'Entries indexed (live)',
      value: liveCount.toLocaleString(),
      source: 'data/dictionary.json, counted at load',
    },
  ];

  if (stats) {
    for (const [key, name] of STATS_KEYS) {
      const value = stats[key];
      if (value === undefined || NEVER_RENDER.has(key)) continue;
      live.push({
        group: 'DICTIONARY',
        name,
        value: String(value),
        source: 'data/dictionary_stats.json — build script',
      });
    }
  }

  // The stats file is a build artefact and can fall behind the data file it
  // describes; it currently reports 15,302 where 15,528 entries ship. Saying so
  // is the same posture the rest of this page takes toward its numbers — the
  // alternative is showing two different totals and letting the reader guess.
  const shippedAfter = typeof stats?.shippedAfter === 'number' ? stats.shippedAfter : null;
  const staleBy = shippedAfter !== null && shippedAfter !== liveCount ? liveCount - shippedAfter : null;

  const rows: Row[] = [...live, ...(file?.metrics ?? [])];

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Only metrics produced by this pipeline. Empty or “not measured” cells are honest. Do not invent BLEU or human
        scores.
      </p>
      {file?.notes && <p className="text-xs text-slate-500">{file.notes}</p>}
      {staleBy !== null && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          The build-script figures are stale: <span className="font-mono">dictionary_stats.json</span> reports{' '}
          {shippedAfter?.toLocaleString()} entries where {liveCount.toLocaleString()} ship — a difference of{' '}
          {Math.abs(staleBy).toLocaleString()}. The live count is authoritative; the stats file has not been
          regenerated since the lexicon last changed.
        </p>
      )}
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
