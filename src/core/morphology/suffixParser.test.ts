import { describe, expect, it } from 'vitest';
import { generate, parseSuffix } from './suffixParser';

describe('suffix parser', () => {
  it('lets kamah beat ah', () => {
    const parsed = parseSuffix('beynunkamah');
    expect(parsed.suffix).toBe('kamah');
    expect(parsed.root).toBe('beynun');
    expect(parsed.case).toBe('indefinite');
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
