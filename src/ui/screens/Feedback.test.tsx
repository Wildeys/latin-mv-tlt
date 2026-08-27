// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import Feedback from './Feedback';
import { exportFeedbackCsv, loadFeedback } from '../../lib/feedback';
import { saveLastResult } from '../../lib/lastTrace';
import type { PipelineResult } from '../../core/pipeline/types';

const RESULT: PipelineResult = {
  input: 'I will go to Male.',
  output: 'އަހަރެން މާލެއަށް ދާނަން',
  available: true,
  traces: [
    {
      direction: 'en-dv',
      input: 'I will go to Male.',
      latin: 'aharen maleah dhaanan',
      thaana: 'އަހަރެން މާލެއަށް ދާނަން',
      thaanaPreserved: [],
      dictionary: [],
      modelInput: 'translate English to Dhivehi Latin: I will go to Male.',
      modelOutput: 'aharen maleah dhaanan',
      translation: { status: 'ready', text: 'aharen maleah dhaanan', modelId: 'en-dv-translate' },
      output: 'އަހަރެން މާލެއަށް ދާނަން',
      register: 'neutral',
      stages: {
        original: 'done',
        transliteration: 'done',
        dictionary: 'done',
        translation: 'done',
        backTransliteration: 'done',
        final: 'done',
      },
    },
  ],
};

/** The two scales are identical 1-5 controls; only the group label tells them apart. */
function rate(scale: string, n: number) {
  const group = screen.getByRole('radiogroup', { name: scale });
  fireEvent.click(within(group).getByRole('radio', { name: String(n) }));
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});

describe('Feedback', () => {
  it('prefills from the last trace so a rating is about what was actually produced', () => {
    saveLastResult(RESULT);
    render(<Feedback />);
    expect((screen.getByLabelText('Original') as HTMLTextAreaElement).value).toBe('I will go to Male.');
    expect((screen.getByLabelText('Generated') as HTMLTextAreaElement).value).toBe(
      'އަހަރެން މާލެއަށް ދާނަން',
    );
  });

  it('stores the rating on this device with the direction it was produced in', () => {
    saveLastResult(RESULT);
    render(<Feedback />);
    rate('How accurate is the meaning?', 5);
    fireEvent.click(screen.getByRole('button', { name: 'Save on this device' }));

    const rows = loadFeedback();
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe('en-dv');
    expect(rows[0].generated).toBe('އަހަރެން މާލެއަށް ދާނަން');
    expect(rows[0].meaning).toBe(5);
    expect(screen.getByRole('status').textContent).toContain('Saved locally');
  });

  it('clears the confirmation when a field changes, so it never describes stale text', () => {
    saveLastResult(RESULT);
    render(<Feedback />);
    fireEvent.click(screen.getByRole('button', { name: 'Save on this device' }));
    expect(screen.getByRole('status').textContent).toContain('Saved locally');

    // The confirmation used to latch: it stayed up while the text was edited
    // underneath it, so a second Save on changed text looked like a no-op and
    // wrote a silent duplicate.
    fireEvent.change(screen.getByLabelText('Generated'), { target: { value: 'something else' } });
    expect(screen.getByRole('status').textContent).not.toContain('Saved locally');
  });

  it('neutralises a correction that a spreadsheet would execute as a formula', () => {
    render(<Feedback />);
    fireEvent.change(screen.getByLabelText('Correct translation (optional)'), {
      target: { value: '=HYPERLINK("http://evil","click")' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save on this device' }));

    // The CSV is designed to be opened in Excel / Sheets / Numbers, which is
    // exactly what makes a leading `=` an injection vector.
    const csv = exportFeedbackCsv();
    expect(csv).toContain('"\'=HYPERLINK');
    expect(csv).not.toContain('"=HYPERLINK');
  });

  it('records nothing until Save is pressed', () => {
    render(<Feedback />);
    rate('How natural is the translation?', 1);
    expect(loadFeedback()).toHaveLength(0);
  });
});
