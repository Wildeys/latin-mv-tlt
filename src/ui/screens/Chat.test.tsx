// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Chat from './Chat';

/**
 * R-6.3 at screen level, through the real pipeline rather than a mock: under
 * `MODE === 'test'` the runner short-circuits to `not_loaded` before importing
 * ONNX Runtime (NFR-6), which is the state a user hits before the weights exist.
 *
 * The claim Chat makes is stronger than the Translator's. The Translator must
 * refuse to invent a sentence; Chat must additionally send *nothing* — the
 * architecture's promise is that only English ever leaves the device, and with
 * no translation there is no English to send.
 */
const KEYED = JSON.stringify({
  provider: 'api',
  apiUrl: 'https://example.invalid/v1',
  model: 'test-model',
  apiKey: 'sk-test',
  remember: false,
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'hello' } }] }),
  }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function send(text: string) {
  const input = screen.getByLabelText('Message');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

describe('Chat', () => {
  it('sends nothing to the LLM when the translation model is not loaded', async () => {
    sessionStorage.setItem('latin-mv-tlt:llm-session', KEYED);
    render(<Chat />);
    send('aharen');

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/translation model is not loaded/);
    // The whole point: no English was produced, so no request was made.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses before translating when there is no API key, and still calls nothing', async () => {
    render(<Chat />); // default settings: provider 'api', empty key
    send('aharen');

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/No API key/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not leave the composer stuck after a failed send', async () => {
    sessionStorage.setItem('latin-mv-tlt:llm-session', KEYED);
    render(<Chat />);
    send('aharen');

    await screen.findByRole('alert');
    // `busy` used to have no path back when a request never settled, and the
    // only recovery was a page reload. Send must return.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy());
  });

  it('converts Male Latin typing to Thaana in the composer (R-1.7)', () => {
    render(<Chat />);
    const input = screen.getByLabelText('Message') as HTMLInputElement;
    for (const key of ['a', 'h', 'a', 'r', 'e', 'n']) {
      fireEvent.change(input, { target: { value: input.value + key } });
    }
    expect(input.value).toMatch(/[ހ-޿]/);
    expect(input.value).not.toMatch(/[a-zA-Z]/);
  });

  it('keeps the API key out of the settings form as plain text', () => {
    render(<Chat />);
    fireEvent.click(screen.getByRole('button', { name: 'Model settings' }));
    const key = screen.getByLabelText('API key') as HTMLInputElement;
    expect(key.type).toBe('password');
  });

  it('disables Send on an empty draft', () => {
    render(<Chat />);
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
