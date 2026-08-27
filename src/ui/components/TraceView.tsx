import type { ReactNode } from 'react';
import { englishGloss, latinValue } from '../../core/dictionary/lookup';
import type { PipelineTrace, StageState } from '../../core/pipeline/types';
import { hasThaana } from '../../core/segmenter/textProcessor';

const LABELS: Record<StageState, string> = {
  done: 'Done',
  not_loaded: 'Not loaded',
  unavailable: 'Unavailable',
  error: 'Error',
  empty: 'Empty',
};

function Badge({ state }: { state: StageState }) {
  const label = LABELS[state] ?? 'Empty';
  const cls =
    state === 'done'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
      : state === 'error'
        ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200'
        : state === 'not_loaded' || state === 'unavailable'
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  return <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>;
}

function Block({ title, state, children }: { title: string; state: StageState; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
        <Badge state={state} />
      </div>
      <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{children}</div>
    </section>
  );
}

/**
 * R-6.2. The Breakdown is a first-class deliverable, not a debug view: it is
 * where the method is inspected rather than taken on trust.
 *
 * v0.2 removes the semantic-frame block and puts the model's actual input and
 * output in its place. That is a more honest view than v0.1 offered — the frame
 * string was a *rule-based* artefact displayed where a reader would reasonably
 * expect to see what the neural model was given.
 */
export default function TraceView({
  trace,
  onLookup,
}: {
  trace: PipelineTrace;
  /**
   * Optional on purpose. `TraceView` is the research deliverable and has to
   * render correctly with no navigator attached — in a test, or anywhere the
   * Dictionary screen is not reachable. With no handler the glosses stay the
   * plain text they have always been.
   */
  onLookup?: (latin: string) => void;
}) {
  const isDvEn = trace.direction === 'dv-en';

  return (
    <div className="space-y-3">
      <Block title="Original" state={trace.stages.original}>
        <p className={hasThaana(trace.input) ? 'font-thaana' : ''}>{trace.input}</p>
      </Block>

      {isDvEn && (
        <Block title="Latin transliteration" state={trace.stages.transliteration}>
          {trace.latin || '—'}
        </Block>
      )}

      <Block title="Dictionary" state={trace.stages.dictionary}>
        {/* `englishGloss` and `latinValue` are the lexicon's own accessors. This
            block used to reimplement both inline, so the panel could disagree
            with every other consumer about what a word's gloss is — and the
            accessors sat unreferenced behind an `export *` barrel looking used. */}
        {trace.dictionary.length === 0
          ? '—'
          : trace.dictionary.map((w, i) => {
              const latin = latinValue(w);
              const rest = `${englishGloss(w)}${w.caseGloss ? ` (${w.caseGloss})` : ''}`;
              return (
                <span key={`${latin}-${i}`} className="block">
                  {/* The same lexicon this panel glosses from is browsable on the
                      Dictionary screen, so the headword is the link to it. */}
                  {onLookup ? (
                    <button
                      type="button"
                      onClick={() => onLookup(latin)}
                      className="underline decoration-dotted underline-offset-2 hover:text-brand-600"
                      title={`Look up ${latin} in the dictionary`}
                    >
                      {latin}
                    </button>
                  ) : (
                    latin
                  )}
                  {` → ${rest}`}
                </span>
              );
            })}
      </Block>

      <Block title="Model input" state={trace.stages.translation}>
        {/* Verbatim, prefix included. The task prefix is how one model serves
            both directions (R-2.5, R-3.1), so it belongs on screen. */}
        <p className="font-mono text-xs">{trace.modelInput || '—'}</p>
      </Block>

      <Block title="Model output" state={trace.stages.translation}>
        {trace.modelOutput ? (
          <p className={hasThaana(trace.modelOutput) ? 'font-thaana' : 'font-mono text-xs'}>
            {trace.modelOutput}
          </p>
        ) : trace.translation.status === 'error' ? (
          <p className="text-rose-700 dark:text-rose-300">{trace.translation.error ?? 'Model error.'}</p>
        ) : (
          'Not loaded. No translation is produced without the model — see About.'
        )}
      </Block>

      {!isDvEn && (
        <Block title="Back-transliteration" state={trace.stages.backTransliteration}>
          {trace.thaana ? <p className="font-thaana">{trace.thaana}</p> : '—'}
          {trace.thaanaPreserved?.length > 0 && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              {/* R-1.3: preserved segments are reported, never dropped silently. */}
              Unconverted: {trace.thaanaPreserved.join(', ')}
            </p>
          )}
        </Block>
      )}

      <Block title="Final translation" state={trace.stages.final}>
        {trace.output ? (
          <p className={hasThaana(trace.output) ? 'font-thaana' : ''}>{trace.output}</p>
        ) : (
          'Unavailable'
        )}
      </Block>
    </div>
  );
}
