import { describe, expect, it } from 'vitest';
import { COLLAPSED_ENGLISH, ENGLISH_TO_LATIN, LATIN_TO_ENGLISH } from './closedClass';

/**
 * The closed-class tables OVERRIDE the 16k bilingual lexicon (R-4.6), so a wrong
 * entry is worse than a missing one — the lookup never reaches the real
 * dictionary to be corrected.
 *
 * Nothing checked the two directions against each other, and `work → kurun` but
 * `kurun → do` sat in the table unnoticed as a result. These tests make every
 * asymmetry either impossible or declared.
 */

/** `he/she` glosses one gender-neutral Dhivehi pronoun; either half counts. */
function glossCovers(gloss: string, english: string): boolean {
  return gloss
    .toLowerCase()
    .split('/')
    .map((part) => part.trim())
    .includes(english.toLowerCase());
}

describe('closed-class tables', () => {
  it('gives every English entry a reverse gloss', () => {
    for (const [english, latin] of Object.entries(ENGLISH_TO_LATIN)) {
      expect(LATIN_TO_ENGLISH[latin], `${english} → ${latin} has no reverse gloss`).toBeDefined();
    }
  });

  it('round-trips every entry that is not a declared collapse', () => {
    const undeclared: string[] = [];
    for (const [english, latin] of Object.entries(ENGLISH_TO_LATIN)) {
      const back = LATIN_TO_ENGLISH[latin];
      if (!back || glossCovers(back, english)) continue;
      if (!COLLAPSED_ENGLISH.has(english)) undeclared.push(`${english} → ${latin} → ${back}`);
    }
    expect(undeclared).toEqual([]);
  });

  it('keeps the collapse list honest — no entry that actually round-trips', () => {
    for (const english of COLLAPSED_ENGLISH) {
      const latin = ENGLISH_TO_LATIN[english];
      expect(latin, `${english} is declared collapsed but is not in the table`).toBeDefined();
      const back = LATIN_TO_ENGLISH[latin];
      expect(
        back && glossCovers(back, english),
        `${english} round-trips and should not be declared a collapse`,
      ).toBeFalsy();
    }
  });

  it('no longer maps an English word onto a Dhivehi form that means something else', () => {
    // Each of these overrode the bilingual dictionary with a wrong answer.
    for (const removed of ['work', 'stay', 'never', 'exist']) {
      expect(ENGLISH_TO_LATIN[removed]).toBeUndefined();
    }
  });

  it('glosses the gender-neutral pronoun without picking a gender', () => {
    expect(ENGLISH_TO_LATIN.he).toBe('eyna');
    expect(ENGLISH_TO_LATIN.she).toBe('eyna');
    expect(LATIN_TO_ENGLISH.eyna).toBe('he/she');
  });
});
