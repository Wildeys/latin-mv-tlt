// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Breakdown from './Breakdown';
import { saveLastResult } from '../../lib/lastTrace';
import type { PipelineResult, PipelineTrace } from '../../core/pipeline/types';
import type { WordTranslation } from '../../core/dictionary/types';

/**
 * The screen around `TraceView`. `TraceView.test.tsx` already pins what a single
 * trace renders; what is untested here is the screen's own three jobs — reading
 * the session trace, splitting a multi-sentence result, and handing a clicked
 * headword to the Dictionary.
 */
function word(latin: string, english: string): WordTranslation {
  return {
    input: latin,
    sourceLang: 'dhivehi',
    translations: [{ latin, english: [english], pos: 'noun', frequency: 1, matchType: 'exact' }],
    transliteration: null,
    confidence: 'high',
    fallbackUsed: null,
  };
}

function trace(over: Partial<PipelineTrace> = {}): PipelineTrace {
  return {
    direction: 'dv-en',
    input: 'އަހަރެން މާލެއަށް ދާނަން',
    latin: 'aharen maleah dhaanan',
    thaana: null,
    thaanaPreserved: [],
    dictionary: [],
    modelInput: 'translate Dhivehi Latin to English: aharen maleah dhaanan',
    modelOutput: null,
    translation: { status: 'not_loaded', text: null, modelId: 'dv-en-translate' },
    output: null,
    register: 'neutral',
    stages: {
      original: 'done',
      transliteration: 'done',
      dictionary: 'empty',
      translation: 'not_loaded',
      backTransliteration: 'empty',
      final: 'unavailable',
    },
    ...over,
  };
}

function seed(traces: PipelineTrace[]) {
  const result: PipelineResult = {
    input: traces.map((t) => t.input).join(' '),
    output: null,
    available: false,
    traces,
  };
  saveLastResult(result);
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe('Breakdown', () => {
  it('asks for a translation rather than rendering an empty trace', () => {
    render(<Breakdown />);
    expect(screen.getByText(/Run a translation first/)).toBeTruthy();
    // Nothing from a trace should be on screen — not even an empty stage badge.
    expect(screen.queryByText('Model input')).toBeNull();
  });

  it('renders one trace per sentence and numbers them only when there is more than one', () => {
    seed([trace()]);
    const single = render(<Breakdown />);
    expect(screen.queryByText('Sentence 1')).toBeNull();
    expect(single.container.querySelectorAll('section').length).toBeGreaterThan(0);
    cleanup();

    seed([trace(), trace({ input: 'ދެވަނަ ޖުމްލަ', latin: 'dhevana jumla' })]);
    render(<Breakdown />);
    expect(screen.getByText('Sentence 1')).toBeTruthy();
    expect(screen.getByText('Sentence 2')).toBeTruthy();
  });

  it('hands a clicked headword to the Dictionary', () => {
    seed([trace({ dictionary: [word('fen', 'water')], stages: { ...trace().stages, dictionary: 'done' } })]);
    const onLookup = vi.fn();
    render(<Breakdown onLookup={onLookup} />);

    fireEvent.click(screen.getByRole('button', { name: 'fen' }));
    expect(onLookup).toHaveBeenCalledWith('fen');
  });

  it('still renders the glosses as plain text with no navigator attached (R-6.2)', () => {
    seed([trace({ dictionary: [word('fen', 'water')], stages: { ...trace().stages, dictionary: 'done' } })]);
    const { container } = render(<Breakdown />);

    // The panel is the deliverable; the link into the Dictionary is an extra.
    expect(container.textContent).toContain('fen → water');
    expect(screen.queryByRole('button', { name: 'fen' })).toBeNull();
  });
});
