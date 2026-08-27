// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import TraceView from './TraceView';
import type { PipelineTrace } from '../../core/pipeline/types';

/**
 * R-6.2 and G1. The Breakdown is a first-class deliverable, and the promise it
 * makes is that a missing model produces *nothing* rather than something
 * plausible. Until jsdom was added, every one of those commitments was verified
 * by reading the file.
 */
function trace(over: Partial<PipelineTrace> = {}): PipelineTrace {
  return {
    direction: 'dv-en',
    input: 'އަހަރެން މާލެއަށް ދާނަން',
    latin: 'aharen maleah dhaanan',
    thaana: 'އަހަރެން މާލެއަށް ދާނަން',
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

afterEach(cleanup);

describe('TraceView', () => {
  it('shows the model input verbatim, prefix included (R-6.2)', () => {
    render(<TraceView trace={trace()} />);
    expect(
      screen.getByText('translate Dhivehi Latin to English: aharen maleah dhaanan'),
    ).toBeTruthy();
  });

  it('reports Unavailable and invents no sentence when the model is absent (R-3.9)', () => {
    const { container } = render(<TraceView trace={trace()} />);
    // Twice: the stage badge and the final-translation body.
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Not loaded\./)).toBeTruthy();
    // The English gloss of the input must not appear anywhere as a final answer.
    expect(container.textContent).not.toContain('I will go to Male');
  });

  it('surfaces the underlying error rather than rendering it as not-loaded (R-5.3)', () => {
    render(
      <TraceView
        trace={trace({
          translation: {
            status: 'error',
            text: null,
            modelId: 'dv-en-translate',
            error: 'no available backend found',
          },
          stages: { ...trace().stages, translation: 'error' },
        })}
      />,
    );
    expect(screen.getByText('no available backend found')).toBeTruthy();
    expect(screen.getAllByText('Error').length).toBeGreaterThan(0);
  });

  it('lists preserved segments instead of dropping them (R-1.3)', () => {
    render(
      <TraceView
        trace={trace({
          direction: 'en-dv',
          thaana: 'މާލެ 2024',
          thaanaPreserved: ['2024', '%'],
          stages: { ...trace().stages, backTransliteration: 'done' },
        })}
      />,
    );
    expect(screen.getByText(/Unconverted: 2024, %/)).toBeTruthy();
  });

  it('shows the Latin block on dv-en and the back-transliteration block on en-dv', () => {
    const dv = render(<TraceView trace={trace()} />);
    expect(dv.container.textContent).toContain('Latin transliteration');
    expect(dv.container.textContent).not.toContain('Back-transliteration');
    cleanup();

    const en = render(<TraceView trace={trace({ direction: 'en-dv' })} />);
    expect(en.container.textContent).toContain('Back-transliteration');
    expect(en.container.textContent).not.toContain('Latin transliteration');
  });

  it('renders Thaana with the Thaana font and English without it (NFR-10)', () => {
    const { container } = render(
      <TraceView
        trace={trace({
          output: 'އަހަރެން',
          stages: { ...trace().stages, final: 'done' },
        })}
      />,
    );
    const thaanaNodes = container.querySelectorAll('.font-thaana');
    expect(thaanaNodes.length).toBeGreaterThan(0);
    for (const node of thaanaNodes) {
      expect(node.textContent).toMatch(/[ހ-޿]/);
    }
  });
});
