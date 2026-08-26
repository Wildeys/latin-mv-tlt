import { describe, expect, it } from 'vitest';
import { generate, parseSuffix } from './suffixParser';

describe('suffix parser', () => {
  it('lets kamah beat ah', () => {
    const parsed = parseSuffix('beynunkamah');
    // The point of the test: longest-suffix matching. `ah` is also a suffix, and
    // stripping it instead would leave the nonsense root `beynunkam`.
    expect(parsed.suffix).toBe('kamah');
    expect(parsed.root).toBe('beynun');
    // NOUN_SUFFIXES labels this `indefinite_dative` (kam + dative ah). The test
    // still expected the older `indefinite` and had been failing at HEAD before
    // the v0.2 migration began; the table is the more accurate of the two, so
    // the assertion moved rather than the morphology.
    expect(parsed.case).toBe('indefinite_dative');
  });

  it('parses genitive ge', () => {
    const parsed = parseSuffix('indhuge');
    expect(parsed.suffix).toBe('ge');
    expect(parsed.root).toBe('indhu');
    expect(parsed.english).toBe('of');
  });

  it('does not strip a standalone particle', () => {
    const parsed = parseSuffix('gey');
    expect(parsed.suffix).toBeNull();
    expect(parsed.root).toBe('gey');
  });

  it('generate adds case endings', () => {
    const forms = generate('indhu');
    expect(forms.has('indhuge')).toBe(true);
    expect(forms.has('indhuah')).toBe(true);
    expect(forms.has('indhu')).toBe(false);
  });
});
