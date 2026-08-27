// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Dictionary from './Dictionary';
import { loadDictionaryFromData } from '../../core/dictionary/lookup';
import type { DictionaryEntry } from '../../core/dictionary/types';

const FIXTURE: DictionaryEntry[] = [
  { latin: 'fen', english: ['water'], pos: 'noun', frequency: 300, freqSource: 'corpus.tsv' },
  { latin: 'fenu', english: ['a kind of water plant'], pos: 'noun', frequency: 50 },
  { latin: 'fengandu', english: ['a body of water'], pos: 'unknown', frequency: 50 },
  { latin: 'male', english: ['Male'], pos: 'proper', frequency: 50 },
  { latin: 'gadha', english: ['hard'], pos: 'adjective', frequency: 50 },
];

beforeEach(() => loadDictionaryFromData(FIXTURE));
afterEach(cleanup);

function type(value: string) {
  fireEvent.change(screen.getByLabelText('Search the lexicon'), { target: { value } });
}

describe('Dictionary', () => {
  it('shows an idle state with the live corpus size and no table', () => {
    render(<Dictionary />);
    expect(screen.getByText(/5 entries indexed/)).toBeTruthy();
    expect(document.querySelector('table')).toBeNull();
  });

  it('finds a headword and labels the side that matched', () => {
    render(<Dictionary />);
    type('fen');
    expect(document.querySelector('table')).not.toBeNull();
    expect(screen.getAllByText('Latin').length).toBeGreaterThan(0);
    expect(screen.getByText('water')).toBeTruthy();
  });

  it('finds a multi-word English gloss and labels it as an English match', () => {
    render(<Dictionary />);
    type('plant');
    expect(screen.getByText('a kind of water plant')).toBeTruthy();
    expect(screen.getAllByText('English').length).toBeGreaterThan(0);
  });

  it('never puts .font-thaana on a table cell (the RTL trap)', () => {
    const { container } = render(<Dictionary />);
    type('fen');
    const thaana = container.querySelectorAll('table .font-thaana');
    expect(thaana.length).toBeGreaterThan(0);
    for (const node of thaana) {
      // `.font-thaana` carries direction:rtl + text-align:right. On a <td> that
      // flips the whole column; on an inline <bdi> it isolates the run instead.
      expect(node.tagName).toBe('BDI');
      expect(node.closest('td')).not.toBe(node);
    }
  });

  it('shows frequency only where a source counted it', () => {
    const { container } = render(<Dictionary />);
    type('fen');
    const rows = [...container.querySelectorAll('tbody tr')];
    const cells = rows.map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent));
    const fen = cells.find((c) => c[0] === 'fen');
    const fenu = cells.find((c) => c[0] === 'fenu');
    expect(fen?.at(-1)).toBe('300'); // freqSource: corpus.tsv
    expect(fenu?.at(-1)).toBe('—'); // placeholder 50, no source
  });

  it('renders an unknown POS as a dash rather than the word "unknown"', () => {
    const { container } = render(<Dictionary />);
    type('fengandu');
    const row = container.querySelector('tbody tr');
    expect(row?.textContent).not.toContain('unknown');
  });

  it('states the true total when the list is truncated', () => {
    const many: DictionaryEntry[] = Array.from({ length: 80 }, (_, i) => ({
      latin: `fen${String(i).padStart(3, '0')}`,
      english: ['water'],
      pos: 'noun',
      frequency: 1,
    }));
    loadDictionaryFromData(many);
    const { container } = render(<Dictionary />);
    type('fen');
    expect(screen.getByText(/Showing 50 of 80 matches/)).toBeTruthy();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(50);
  });

  it('explains a miss by stemming the query instead of showing nothing', () => {
    render(<Dictionary />);
    type('malegai'); // male + locative gai
    expect(screen.getByText(/is not a headword/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'male' })).toBeTruthy();
  });

  it('distinguishes the no-results state from the idle state', () => {
    render(<Dictionary />);
    type('zzzq');
    expect(screen.getByText(/No entry matches/)).toBeTruthy();
    expect(screen.queryByText(/entries indexed/)).toBeNull();
  });

  it('leaves Latin alone in Latin mode and converts it in Thaana mode', () => {
    render(<Dictionary />);
    const input = screen.getByLabelText('Search the lexicon') as HTMLInputElement;

    // Latin mode: the IME is off, so an English query survives — this is the
    // half of the search that an always-on IME would make unreachable.
    type('water');
    expect(input.value).toBe('water');

    fireEvent.click(screen.getByRole('button', { name: 'Thaana (IME)' }));
    for (const key of ['f', 'e', 'n']) {
      fireEvent.change(input, { target: { value: input.value + key } });
    }
    expect(input.value).toMatch(/[ހ-޿]/);
    expect(input.value).not.toMatch(/[a-zA-Z]/);
  });

  it('clears the query and the table', () => {
    render(<Dictionary />);
    type('fen');
    expect(document.querySelector('table')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect((screen.getByLabelText('Search the lexicon') as HTMLInputElement).value).toBe('');
    expect(document.querySelector('table')).toBeNull();
  });
});
