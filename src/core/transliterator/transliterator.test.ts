import { describe, expect, it } from 'vitest';
import { latinToThaana, latinToThaanaDetailed } from './latinToThaana';
import { transliterateThaana } from './thaanaToLatin';

describe('transliterator', () => {
  it('round-trips known Latin words', () => {
    for (const latin of ['meehu', 'gey', 'fani']) {
      const thaana = latinToThaana(latin);
      expect(transliterateThaana(thaana)).toBe(latin);
    }
  });

  it('round-trips a short sentence', () => {
    const latin = 'meehu gey';
    expect(transliterateThaana(latinToThaana(latin))).toBe(latin);
  });

  it('uses native haa and noonu for aharen', () => {
    const thaana = latinToThaana('aharen');
    expect(thaana).toContain('ހ');
    expect(thaana).not.toContain('ޙ');
    expect(thaana).toContain('ނ');
    expect(thaana).not.toContain('ޱ');
    expect(transliterateThaana(thaana)).toBe('aharen');
  });

  it('maps known words', () => {
    expect(latinToThaana('dhivehi')).toBe('ދިވެހި');
    expect(latinToThaana('fani')).toBe('ފަނި');
  });

  const sukunForms: Record<string, string> = {
    'ރަށް': 'rah',
    'ވަރަށް': 'varah',
    'ދަތް': 'dhaiy',
    'އަތްފައި': 'aiyfai',
    'އެއް': 'eh',
    'ބައްޓެއް': 'batteh',
    'ބަސް': 'bas',
    'ކަން': 'kan',
    'ގެއަށް': 'geah',
  };

  it('handles sukun forms', () => {
    for (const [thaana, expected] of Object.entries(sukunForms)) {
      expect(transliterateThaana(thaana)).toBe(expected);
    }
  });

  it('does not emit doubled-sibilant artifacts', () => {
    for (const thaana of Object.keys(sukunForms)) {
      const latin = transliterateThaana(thaana);
      expect(latin).not.toContain('shsh');
      expect(latin).not.toContain('thiy');
    }
  });

  it('does not silently delete unknown characters', () => {
    const hello = latinToThaanaDetailed('hello, world!');
    expect(hello.thaana).toContain(',');
    expect(hello.thaana).toContain('!');
    expect(hello.thaana).toContain('ޥ');
    expect(hello.thaana).not.toContain('w');

    const mixed = latinToThaanaDetailed('abc123');
    expect(mixed.thaana).toContain('c');
    expect(mixed.thaana).toContain('123');
    expect(mixed.preserved).toEqual(expect.arrayContaining(['c', '1', '2', '3']));
  });

  it('folds accented place names before conversion', () => {
    expect(latinToThaana('Malé')).toBe(latinToThaana('male'));
    expect(latinToThaanaDetailed('Malé').preserved).toEqual([]);
  });

  it('maps Arabic-loan q and lists leftover Latin letters', () => {
    const q = latinToThaanaDetailed('naquluvun');
    expect(q.thaana).toContain('ޤ');
    expect(q.preserved).toEqual([]);
    expect(latinToThaanaDetailed('taxi').preserved).toContain('x');
  });
});
