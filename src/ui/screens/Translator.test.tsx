// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Translator from './Translator';
import { loadLastResult } from '../../lib/lastTrace';

/**
 * The whole-screen version of G1, exercised through the real pipeline rather
 * than a mock: under `MODE === 'test'` the runner short-circuits to `not_loaded`
 * before it imports ONNX Runtime (NFR-6), which is exactly the state a user hits
 * before the weights exist. The screen must refuse, and must refuse *visibly*.
 */
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe('Translator', () => {
  it('refuses rather than inventing a sentence when the model is not loaded', async () => {
    render(<Translator onOpenBreakdown={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

    expect(await screen.findByText(/Final translation: Unavailable/)).toBeTruthy();
    // The refusal shows its work: the exact string the model would have received.
    expect(
      screen.getByText(/^translate Dhivehi Latin to English: /),
    ).toBeTruthy();
  });

  it('switches direction, sample text and the model prefix together', async () => {
    render(<Translator onOpenBreakdown={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'English → Dhivehi' }));

    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(input.value).toBe('I will go to Male.');

    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    expect(await screen.findByText(/^translate English to Dhivehi Latin: /)).toBeTruthy();
  });

  it('saves the trace so the Breakdown can read it after a screen switch', async () => {
    render(<Translator onOpenBreakdown={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

    await waitFor(() => expect(loadLastResult()).not.toBeNull());
    const saved = loadLastResult();
    expect(saved?.available).toBe(false);
    expect(saved?.output).toBeNull();
    expect(saved?.traces[0].modelInput).toContain('translate Dhivehi Latin to English: ');
  });

  it('disables Translate on empty input, which feeds the R-5.4 guard', () => {
    render(<Translator onOpenBreakdown={() => {}} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '   ' } });
    expect((screen.getByRole('button', { name: 'Translate' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('converts Male Latin typing to Thaana in place (R-1.7)', () => {
    render(<Translator onOpenBreakdown={() => {}} />);
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '' } });

    // One Latin character appended per event, which is the shape the IME's
    // `onChange` fallback path detects (`next.length === prev.length + 1`).
    for (const key of ['a', 'h', 'a', 'r', 'e', 'n']) {
      fireEvent.change(input, { target: { value: input.value + key } });
    }

    // The user typed QWERTY Latin and the field holds Thaana — no OS layout
    // change, and no Latin left behind.
    expect(input.value).toMatch(/[ހ-޿]/);
    expect(input.value).not.toMatch(/[a-zA-Z]/);
  });

  it('leaves the English direction alone — the IME is dv-en only', () => {
    render(<Translator onOpenBreakdown={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'English → Dhivehi' }));
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: 'hello' } });
    expect(input.value).toBe('hello');
  });
});
