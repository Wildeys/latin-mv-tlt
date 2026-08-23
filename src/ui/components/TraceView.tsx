import type { ReactNode } from 'react';
import type { PipelineTrace } from '../../core/pipeline/types';
import { serializeFrame } from '../../core/frames/serialize';

function Badge({ state }: { state: string }) {
  const label =
    state === 'done' ? 'Done' : state === 'not_loaded' ? 'Not loaded' : state === 'unavailable' ? 'Unavailable' : 'Empty';
  const cls =
    state === 'done'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
      : state === 'not_loaded' || state === 'unavailable'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  return <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>;
}

function Block({ title, state, children }: { title: string; state: string; children: ReactNode }) {
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

export default function TraceView({ trace }: { trace: PipelineTrace }) {
  const frame = trace.direction === 'en-dv' ? trace.latinFrame : trace.englishFrame;
  return (
    <div className="space-y-3">
      <Block title="Original" state={trace.stages.original}>
        <p className={trace.direction === 'dv-en' ? 'font-thaana text-lg' : ''} dir={trace.direction === 'dv-en' ? 'rtl' : 'ltr'}>
          {trace.input}
        </p>
      </Block>
      <Block title="Latin" state={trace.stages.transliteration}>
        {trace.latin || '—'}
      </Block>
      <Block title="Dictionary" state={trace.stages.dictionary}>
        {trace.dictionary.length === 0
          ? '—'
          : trace.dictionary.map((w) => {
              const gloss = w.translations[0]?.english[0] ?? '';
              const latin = w.stem || w.transliteration || w.input;
              return `${latin} → ${gloss}${w.caseGloss ? ` (${w.caseGloss})` : ''}`;
            }).join('\n')}
      </Block>
      <Block title="Semantic frame" state={trace.stages.frame}>
        <p className="font-mono text-xs">{trace.frameString || '—'}</p>
        {trace.latinFrameString && (
          <p className="font-mono text-xs mt-2 text-slate-500">Latin slots: {trace.latinFrameString}</p>
        )}
        {frame && frame.residue.length > 0 && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            Residue (unassigned): {frame.residue.join(', ')}
          </p>
        )}
        {frame && (
          <pre className="mt-2 text-[11px] font-mono text-slate-500 overflow-x-auto">
            {JSON.stringify({ ...frame, frameString: undefined }, null, 2)}
          </pre>
        )}
      </Block>
      <Block title="Realization model" state={trace.stages.realization}>
        {trace.realization.status === 'ready'
          ? trace.realization.text
          : 'Not loaded. The frame is the current output of the research pipeline.'}
      </Block>
      <Block title="Final translation" state={trace.stages.final}>
        {trace.output ?? 'Unavailable'}
      </Block>
      <p className="text-[11px] text-slate-500">
        Serialized frame: {serializeFrame(trace.englishFrame)}
      </p>
    </div>
  );
}
