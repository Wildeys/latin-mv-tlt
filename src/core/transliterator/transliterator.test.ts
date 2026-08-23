import { describe, expect, it } from 'vitest';
import { latinToThaana } from './latinToThaana';
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
});
