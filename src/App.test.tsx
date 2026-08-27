// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DictionaryEntry } from './core/dictionary/types';

/**
 * R-6.9 at the shell level, and the one contract About carries: while the
 * dictionary is loading or has failed, the data screens are withheld — but
 * About, which needs no data, stays reachable. A user whose network dropped
 * must still be able to read what the app claims to do.
 */
const FIXTURE: DictionaryEntry[] = [
  { latin: 'fen', english: ['water'], pos: 'noun', frequency: 300, freqSource: 'corpus.tsv' },
  { latin: 'aharen', english: ['I', 'me'], pos: 'pronoun', frequency: 900, freqSource: 'corpus.tsv' },
  { latin: 'male', english: ['Male'], pos: 'proper', frequency: 50 },
];

/**
 * A fresh module graph per test. `loadDictionary` memoises both `loaded` and the
 * in-flight promise on module state, and the never-settling stub below leaves
 * that promise pending forever — which would make every later `loadDictionary()`
 * await it and hang. Importing App after `resetModules` isolates each case.
 */
async function mount() {
  const { default: App } = await import('./App');
  return render(<App />);
}

function stubFetch(handler: (url: string) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => handler(String(url))),
  );
}

/** Resolves the dictionary, 404s everything else (honorifics, benchmarks). */
function stubLoaded() {
  stubFetch((url) =>
    url.includes('dictionary.json')
      ? { ok: true, json: async () => FIXTURE }
      : { ok: false, status: 404, statusText: 'Not Found', json: async () => null },
  );
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('App shell (R-6.9)', () => {
  it('withholds the data screens while the dictionary is still loading', async () => {
    stubFetch(() => new Promise(() => {})); // never settles
    await mount();

    expect(screen.getByText('Loading dictionary…')).toBeTruthy();
    // Translator is the default screen and must not render against an empty index.
    expect(screen.queryByRole('button', { name: 'Translate' })).toBeNull();
  });

  it('shows the failure and still withholds the data screens', async () => {
    stubFetch(() => ({ ok: false, status: 404, statusText: 'Not Found', json: async () => null }));
    await mount();

    expect(await screen.findByText(/Failed to load data/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Translate' })).toBeNull();

    // Every data screen, not just the one that happened to be open.
    for (const name of ['Breakdown', 'Dictionary', 'AI Chat', 'Feedback', 'Benchmarks']) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(screen.getByText(/Failed to load data/)).toBeTruthy();
    }
  });

  it('keeps About reachable when the dictionary has failed', async () => {
    stubFetch(() => ({ ok: false, status: 404, statusText: 'Not Found', json: async () => null }));
    await mount();
    await screen.findByText(/Failed to load data/);

    fireEvent.click(screen.getByRole('button', { name: 'About' }));
    expect(screen.getByText('Research idea')).toBeTruthy();
  });

  it('opens the data screens once the dictionary has loaded', async () => {
    stubLoaded();
    await mount();

    expect(await screen.findByRole('button', { name: 'Translate' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dictionary' }));
    expect(screen.getByText(/3 entries indexed/)).toBeTruthy();
  });

  it('carries a gloss clicked on the Breakdown into the Dictionary search', async () => {
    stubLoaded();
    await mount();
    await screen.findByRole('button', { name: 'Translate' });

    // The model is not loaded under MODE==='test', so this is the refusal path —
    // which is precisely when the glosses are the only analysis on offer.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'aharen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    await screen.findByText(/Final translation: Unavailable/);

    fireEvent.click(screen.getByRole('button', { name: 'View sentence breakdown' }));
    fireEvent.click(await screen.findByRole('button', { name: 'aharen' }));

    // Landed on the Dictionary, already searched.
    const search = screen.getByLabelText('Search the lexicon') as HTMLInputElement;
    expect(search.value).toBe('aharen');
    await waitFor(() => expect(screen.getByText('I · me')).toBeTruthy());
  });

  it('clears a pending lookup when the user navigates by hand', async () => {
    stubLoaded();
    await mount();
    await screen.findByRole('button', { name: 'Translate' });

    fireEvent.click(screen.getByRole('button', { name: 'Dictionary' }));
    expect((screen.getByLabelText('Search the lexicon') as HTMLInputElement).value).toBe('');
  });
});
