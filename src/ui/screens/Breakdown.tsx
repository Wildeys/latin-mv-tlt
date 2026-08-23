import { useEffect, useState } from 'react';
import type { PipelineResult } from '../../core/pipeline/types';
import { loadLastResult } from '../../lib/lastTrace';
import TraceView from '../components/TraceView';

export default function Breakdown() {
  const [result, setResult] = useState<PipelineResult | null>(null);

  useEffect(() => {
    setResult(loadLastResult());
  }, []);

  if (!result) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-sm text-slate-500">
        Run a translation first. This page shows the last pipeline trace from this browser session.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {result.traces.map((trace, i) => (
        <div key={`${trace.input}-${i}`}>
          {result.traces.length > 1 && (
            <h2 className="text-sm font-semibold mb-3 text-slate-500">Sentence {i + 1}</h2>
          )}
          <TraceView trace={trace} />
        </div>
      ))}
    </div>
  );
}
