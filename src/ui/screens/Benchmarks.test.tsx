// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import Benchmarks from './Benchmarks';
import { loadDictionaryFromData } from '../../core/dictionary/lookup';
import type { DictionaryEntry, DictionaryStats } from '../../core/dictionary/types';

const FIXTURE: DictionaryEntry[] = [
  { latin: 'fen', english: ['water'], pos: 'noun', frequency: 300, freqSource: 'corpus.tsv' },
  { latin: 'male', english: ['Male'], pos: 'proper', frequency: 50 },
  { latin: 'gadha', english: ['hard'], pos: 'adjective', frequency: 50 },
];

/** The shape the shipped `dictionary_stats.json` actually has. */
const STATS: DictionaryStats = {
  shippedBefore: 2,
  shippedAfter: 2,
  frequencyUpdatedFromCorpus: 1,
  source: 'C:\\Users\\Someone\\Desktop\\dhivehi\\dhivehi_dictionary.db',
};

beforeEach(() => {
  // No benchmarks.json in the test environment; the screen must still render.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => null })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Benchmarks', () => {
  it('reports the live entry count even when the stats file has none of the build-script keys', async () => {
    // The regression this pins: the live rows were keyed on `rawDbRows`,
    // `finalExportedEntries` and five siblings, none of which the shipped stats
    // file carries — so every row was filtered out and the DICTIONARY group
    // rendered empty while DESIGN.md claimed it showed live counters.
    loadDictionaryFromData(FIXTURE, STATS);
    render(<Benchmarks />);

    expect(screen.getByText('Entries indexed (live)')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('DICTIONARY').length).toBeGreaterThan(0));
    const row = screen.getByText('Entries indexed (live)').closest('tr');
    expect(row?.textContent).toContain(String(FIXTURE.length));
  });

  it('renders the counters the stats file does carry', () => {
    loadDictionaryFromData(FIXTURE, STATS);
    render(<Benchmarks />);
    expect(screen.getByText('Frequencies counted from corpus')).toBeTruthy();
  });

  it('never renders the build machine\u2019s absolute path', () => {
    loadDictionaryFromData(FIXTURE, STATS);
    const { container } = render(<Benchmarks />);
    expect(container.textContent).not.toContain('C:\\Users');
    expect(container.textContent).not.toContain('dhivehi_dictionary.db');
  });

  it('says so when the stats file disagrees with the shipped lexicon', () => {
    // The real file reports 15,302 against 15,528 shipped. Showing both numbers
    // with no explanation would leave the reader to guess which is real.
    loadDictionaryFromData(FIXTURE, { ...STATS, shippedAfter: 999 });
    render(<Benchmarks />);
    expect(screen.getByText(/build-script figures are stale/)).toBeTruthy();
  });

  it('shows no staleness note when the two agree', () => {
    loadDictionaryFromData(FIXTURE, { ...STATS, shippedAfter: FIXTURE.length });
    render(<Benchmarks />);
    expect(screen.queryByText(/build-script figures are stale/)).toBeNull();
  });

  it('still renders with no stats file at all', () => {
    loadDictionaryFromData(FIXTURE);
    render(<Benchmarks />);
    expect(screen.getByText('Entries indexed (live)')).toBeTruthy();
    expect(screen.queryByText(/build-script figures are stale/)).toBeNull();
  });
});
