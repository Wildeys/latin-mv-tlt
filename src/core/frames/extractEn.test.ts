import { describe, expect, it } from 'vitest';
import { extractEnFrame } from './extractEn';

/**
 * Regression cases. Every one of these was measured against the real module
 * before the fix and produced the "was" value in the comment.
 */
describe('English frame extractor regressions', () => {
  it('does not read a noun ending in -ed as past tense', () => {
    // was: tense = past, because `need` ends in "ed"
    expect(extractEnFrame('I need water').tense).toBe('present');
    expect(extractEnFrame('the red bed').tense).toBe('present');
  });

  it('still detects a genuine -ed past tense', () => {
    expect(extractEnFrame('I walked to Male').tense).toBe('past');
  });

  it('skips the article after a preposition', () => {
    // was: location = "The"
    expect(extractEnFrame('I came from the store').location).toBe('Store');
  });

  it('treats to + verb as an infinitive, not a place', () => {
    // was: location = "Sleep"
    expect(extractEnFrame('I want to sleep').location).toBeNull();
  });

  it('keeps the first time word and leaves the second in residue', () => {
    // was: time = "tomorrow", and "today" vanished entirely
    const frame = extractEnFrame('I go to Male today tomorrow');
    expect(frame.time).toBe('today');
    expect(frame.residue).toContain('tomorrow');
  });

  it('prefers the goal over the source for the location slot', () => {
    // was: location = "Addu", object = "male"
    const frame = extractEnFrame('I go to Male from Addu');
    expect(frame.location).toBe('Male');
  });

  it('emits plain ASCII place names so the frame matches the corpus', () => {
    expect(extractEnFrame('I will go to Malé.').location).toBe('Male');
    expect(extractEnFrame('They will go to Hulhumalé.').location).toBe('Hulhumale');
    expect(extractEnFrame('She lives in the Maldives.').location).toBe('Maldives');
  });

  it('marks every frame as spoken register', () => {
    expect(extractEnFrame('I will go to Male.').register).toBe('spoken');
  });
});
