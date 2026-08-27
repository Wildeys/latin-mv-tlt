import { describe, expect, it } from 'vitest';
import { latinToThaana, latinToThaanaDetailed } from './latinToThaana';
import { transliterateThaana, transliterateThaanaDetailed } from './thaanaToLatin';

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

// v0.2: the Thaana → Latin → Thaana direction. Under v0.1 the transliterator was
// one stage among many; under v0.2 every training pair passes through it, so its
// round-trip behaviour caps translation quality (REQUIREMENTS §6.8, R-1.8).
//
// Three forward rules had no inverse at all, which meant the reverse direction
// could not reproduce forms the forward direction routinely emits. Measured over
// data/dictionary_full.json these were ~11% of all entries; see
// tools/measure_roundtrip.py and evaluation/roundtrip_stats.json.
describe('transliterator round-trip (R-1.8)', () => {
  const cases: [string, string, string][] = [
    ['geminate', 'އައްޑޫ', 'addoo'],
    ['geminate after prenasalized stop', 'ހިނގައްޖެ', 'hin\'gajje'],
    ['prenasalized stop', 'ރަނގަޅު', 'ran\'galhu'],
    ['dative -ah word-final', 'މާލެއަށް', 'maaleah'],
    ['dative -ah before a consonant', 'ކަށްޑެވި', 'kahdevi'],
    ['sukun special iy', 'ފޮތް', 'foiy'],
    ['coda sh before a consonant', 'މަޝްހޫރު', 'mashhooru'],
    ['coda sh word-final', 'ކައިޝް', 'kaish'],
  ];

  for (const [name, thaana, latin] of cases) {
    it(`${name}: ${thaana} ↔ ${latin}`, () => {
      expect(transliterateThaana(thaana)).toBe(latin);
      expect(latinToThaana(latin)).toBe(thaana);
    });
  }

  it('does not read iy as ތް when a vowel follows', () => {
    // `dhiya` is ދިޔަ — the y is an onset carrying `a`, not a coda. Applying the
    // sukun-special inverse here would corrupt a very common word shape.
    expect(latinToThaana('dhiya')).toBe('ދިޔަ');
    expect(transliterateThaana('ދިޔަ')).toBe('dhiya');
  });

  it('does not read ey as ޭ when a vowel follows', () => {
    // ކެޔޮ is ke + yo, not ކޭ + އޮ. Greedy two-character vowel matching got this
    // wrong and swallowed the onset y.
    expect(latinToThaana('keyo')).toBe('ކެޔޮ');
    // …but a genuine ey digraph still maps to ޭ.
    expect(latinToThaana('mirey')).toBe('މިރޭ');
  });

  it('does not treat the d of dh as a geminate', () => {
    // `ddh` is ޑް + ދ, not a doubled ޑ. Without a longest-match guard the
    // geminate rule swallowed the d of every dh that followed one.
    expect(latinToThaana('addhu')).not.toContain('އް');
  });

  it('writes coda sh with sheenu and onset sh with shaviyani', () => {
    // ށ and ޝ both romanise to `sh`, but ށ under sukun reads out as `h`
    // (SUKUN_SPECIAL), so ށް can never be the inverse of a coda `sh` —
    // މަޝްހޫރު used to come back as `mahhooru`, a different word. Coda `sh` is
    // therefore ޝް, which is also the etymologically right letter: it occurs in
    // the Arabic loanwords sheenu exists to write.
    expect(latinToThaana('mashvaraa')).toContain('ޝް');
    expect(latinToThaana('mashvaraa')).not.toContain('ށް');

    // Onset `sh` keeps the native shaviyani, which round-trips correctly because
    // the sukun special does not apply when a vowel follows.
    expect(latinToThaana('shafeeu')).toBe('ށަފީއު');
    expect(transliterateThaana('ށަފީއު')).toBe('shafeeu');
  });

  it('reads the diacritic that follows a prenasalized stop (R-1.8)', () => {
    // The forward rule emitted the digraph and then jumped past the stop without
    // reading its sukun, so the sukun met the next iteration with no consonant in
    // front of it and was copied into the Latin as a raw U+07B0.
    expect(transliterateThaana('ނބް')).toBe("n'b");
    expect(transliterateThaanaDetailed('ނބް').preserved).toEqual([]);
    expect(transliterateThaana('އަނބު')).toBe("an'bu");
  });

  it('keeps prenasalized stops Latin-stable in both directions (R-1.8)', () => {
    for (const thaana of ['ނބް', 'ނދް', 'ނގް', 'ނޑް', 'އަނބު', 'އަނދު']) {
      const latin = transliterateThaana(thaana);
      expect(latin).not.toMatch(/[\u0780-\u07BF]/);
      // Latin stability is the property R-1.8 actually gates on.
      expect(transliterateThaana(latinToThaana(latin))).toBe(latin);
    }
  });

  it('reports unconverted Thaana characters (R-1.3)', () => {
    // The reverse direction has always reported preserved segments; the forward
    // direction used to drop unmapped characters silently, which made R-1.8's
    // failure taxonomy impossible to compute.
    expect(transliterateThaanaDetailed('އަހަރެން').preserved).toEqual([]);
  });
});
