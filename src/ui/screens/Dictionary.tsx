import { useDeferredValue, useMemo, useState } from 'react';
// `res.corpusSize` already carries the live entry count, so the screen never
// reads `dictionary_stats.json` — that file is stale (it reports 15,302 where
// the shipped array holds 15,528) and its `source` key is an absolute path from
// the original author's machine.
import { isKnownLatin, searchDictionary } from '../../core/dictionary/lookup';
import type { SearchResult } from '../../core/dictionary/types';
import { stemWord } from '../../core/morphology/suffixParser';
import { latinToThaana } from '../../core/transliterator/latinToThaana';
import { useThaanaIme } from '../hooks/useThaanaIme';

/**
 * R-6.12. A search-first browser over the shipped lexicon.
 *
 * Search-first, not an A–Z listing, for a measured reason: the file is sorted by
 * headword and its first two entries are inverted rows — `a goal in sport →
 * lan'du jehun` — so an alphabetical default would open on the worst data in the
 * lexicon. An empty query shows an empty state instead.
 *
 * This is the only screen that renders shipped data with no pipeline in front of
 * it, so it takes the same posture Benchmarks takes toward unmeasured metrics:
 * where a value is a placeholder rather than evidence, it says so.
 */

type Mode = 'latin' | 'thaana';

const EXAMPLES = ['fen', 'water', 'aharen'];

function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'brand' }) {
  const cls =
    tone === 'brand'
      ? 'bg-brand-50 text-brand-700 dark:bg-brand-700/30 dark:text-brand-100'
      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  return <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${cls}`}>{children}</span>;
}

function Row({ row }: { row: SearchResult & { thaana: string } }) {
  const { entry } = row;
  return (
    <tr className="border-t border-slate-100 dark:border-slate-800 align-top">
      <td className="px-3 py-2 font-mono">{entry.latin}</td>
      <td className="px-3 py-2">
        {/* `.font-thaana` carries `direction: rtl; text-align: right`. On a <td>
            that flips the whole column, so it goes on an inline <bdi>, whose
            default `unicode-bidi: isolate` is exactly what a Thaana run sitting
            between LTR cells needs. */}
        <bdi className="font-thaana">{row.thaana}</bdi>
      </td>
      <td className="px-3 py-2 text-slate-500">
        {entry.pos && entry.pos !== 'unknown' ? entry.pos : <span className="text-slate-400">—</span>}
      </td>
      <td className="px-3 py-2">{entry.english.join(' · ')}</td>
      <td className="px-3 py-2 space-x-1 whitespace-nowrap">
        {row.sides.map((side) => (
          <Badge key={side} tone={side === 'latin' ? 'brand' : 'slate'}>
            {side === 'latin' ? 'Latin' : 'English'}
          </Badge>
        ))}
        <Badge>{row.kind}</Badge>
      </td>
      <td className="px-3 py-2 font-mono text-slate-500" title={entry.freqSource ?? undefined}>
        {/* 93.9% of shipped rows carry a placeholder frequency. Showing it only
            where a source counted it is the same honesty Benchmarks applies to
            unmeasured metrics. */}
        {entry.freqSource ? entry.frequency : '—'}
      </td>
    </tr>
  );
}

export default function Dictionary({ initialQuery = '' }: { initialQuery?: string }) {
  const [mode, setMode] = useState<Mode>('latin');
  // Seed only. A gloss clicked on the Breakdown opens this screen already
  // searched; from then on the field is the user's, so the prop is an initial
  // value rather than a controlled one.
  const [q, setQ] = useState(initialQuery);
  const [limit, setLimit] = useState(50);
  const ime = useThaanaIme(mode === 'thaana');

  // The input must stay responsive while the table renders. The search itself is
  // 1–9 ms for any realistic query and ~22 ms for a single character on a 2016
  // laptop; the 50-row table is the slower half. useDeferredValue lets React drop
  // intermediate renders instead of adding latency to every keystroke, which a
  // debounce would.
  const deferred = useDeferredValue(q);
  const res = useMemo(() => searchDictionary(deferred, limit), [deferred, limit]);

  // Generated once per query, not per render — the lexicon ships no Thaana
  // column, so every cell is a transliterator call.
  const rows = useMemo(
    () => res.results.map((r) => ({ ...r, thaana: latinToThaana(r.entry.latin) })),
    [res],
  );

  // Only useful when the query is NOT a headword: every result row already is
  // one, so stemming a row would always return the row itself.
  const stem = useMemo(() => {
    if (!res.query.latin) return null;
    if (res.results.some((r) => r.kind === 'exact' && r.sides.includes('latin'))) return null;
    const analysis = stemWord(res.query.latin, isKnownLatin);
    return analysis && analysis.root !== res.query.latin ? analysis : null;
  }, [res]);

  function reset(next: string) {
    setQ(next);
    ime.reset();
    setLimit(50);
  }

  const truncated = res.total > res.results.length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        The shipped lexicon as it is, not a cleaned view of it. Some rows are{' '}
        <strong>inverted</strong> — the English sits in the headword column and the Dhivehi in the
        glosses, so the lexicon holds both <span className="font-mono">a&apos;zum → ambition</span>{' '}
        and <span className="font-mono">ambition → azum</span> as separate entries. Thaana here is{' '}
        <strong>generated</strong> from the Latin headword by the rule-based transliterator, never
        stored, so an inverted row transliterates an English word and means nothing — searching{' '}
        <bdi className="font-thaana">ވެން</bdi> returns <span className="font-mono">venom</span>.
        These rows are not flagged: every automatic test for them also flags correct entries.
      </p>

      <div className="flex flex-wrap gap-2">
        {(['latin', 'thaana'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              reset('');
            }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              mode === m
                ? 'bg-brand-600 text-white'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700'
            }`}
          >
            {m === 'latin' ? 'Latin / English' : 'Thaana (IME)'}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => ime.onChange(e, q, setQ)}
          onKeyDown={(e) => ime.onKeyDown(e, q, setQ)}
          onBeforeInput={(e) => ime.onBeforeInput(e, q, setQ)}
          aria-label="Search the lexicon"
          placeholder={mode === 'thaana' ? 'Type Male Latin — it becomes Thaana' : 'fen · water · aharen'}
          className={`flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 ${
            mode === 'thaana' ? 'font-thaana' : 'text-sm'
          }`}
        />
        <button
          onClick={() => reset('')}
          disabled={!q}
          className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-sm font-medium disabled:opacity-50"
        >
          Clear
        </button>
      </div>

      <p className="text-xs text-slate-500" role="status" aria-live="polite">
        {res.query.script === 'empty' ? (
          <>{res.corpusSize.toLocaleString()} entries indexed. Type Male Latin, English or Thaana.</>
        ) : (
          <>
            {res.query.transliterated && (
              <>
                <bdi className="font-thaana">{res.query.raw}</bdi>
                <span className="font-mono"> → {res.query.latin}</span> ·{' '}
              </>
            )}
            {truncated
              ? `Showing ${res.results.length} of ${res.total.toLocaleString()} matches, ranked by match quality.`
              : `${res.total.toLocaleString()} ${res.total === 1 ? 'match' : 'matches'}.`}
          </>
        )}
      </p>

      {stem && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          <span className="font-mono">{res.query.latin}</span> is not a headword. It stems to{' '}
          <button onClick={() => reset(stem.root)} className="font-mono underline font-medium">
            {stem.root}
          </button>
          {stem.suffixes.length > 0 && <> + {stem.suffixes.map((s) => `-${s}`).join(' + ')}</>}
          {stem.englishHints.length > 0 && <> ({stem.englishHints.join(' ')})</>}.
        </p>
      )}

      {res.query.script === 'empty' ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-sm text-slate-500 space-y-3">
          <p>Search {res.corpusSize.toLocaleString()} entries by Dhivehi headword or English gloss.</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                onClick={() => reset(example)}
                className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-600 font-mono text-xs"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-sm text-slate-500">
          No entry matches <span className="font-mono">{res.query.latin}</span>. Searched every Latin
          headword and every English gloss.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Headword</th>
                  <th className="px-3 py-2 font-medium">Thaana (generated)</th>
                  <th className="px-3 py-2 font-medium">POS</th>
                  <th className="px-3 py-2 font-medium">English</th>
                  <th className="px-3 py-2 font-medium">Matched</th>
                  <th className="px-3 py-2 font-medium">Freq (counted only)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Row key={row.entry.latin} row={row} />
                ))}
              </tbody>
            </table>
          </div>
          {truncated && limit < 200 && (
            <button
              onClick={() => setLimit(200)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm font-medium"
            >
              Show up to 200
            </button>
          )}
        </>
      )}
    </div>
  );
}
