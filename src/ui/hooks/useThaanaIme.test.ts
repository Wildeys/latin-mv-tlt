import { describe, expect, it } from 'vitest';
import { latinToThaana } from '../../core/transliterator/latinToThaana';
import { applyImeBackspace, applyLatinKey, type ThaanaImeState } from './useThaanaIme';

describe('Male Latin IME', () => {
  it('converts aharen to Thaana as each letter is typed', () => {
    let value = '';
    let caret = 0;
    let state: ThaanaImeState = { latin: '', start: null };
    for (const key of 'aharen') {
      const next = applyLatinKey(value, caret, caret, key, state);
      value = next.value;
      caret = next.caret;
      state = next.state;
    }
    expect(value).toBe(latinToThaana('aharen'));
    expect(value).toMatch(/[\u0780-\u07BF]/);
    expect(value).not.toMatch(/[a-z]/);
  });

  it('starts a new word after the caret moves', () => {
    const first = applyLatinKey('', 0, 0, 'a', { latin: '', start: null });
    const spaced = `${first.value} `;
    const second = applyLatinKey(spaced, spaced.length, spaced.length, 'm', first.state);
    expect(second.value.endsWith(latinToThaana('m'))).toBe(true);
  });

  it('backspace undoes composing Latin, not a Thaana code point', () => {
    let value = '';
    let caret = 0;
    let state: ThaanaImeState = { latin: '', start: null };
    for (const key of 'ah') {
      const next = applyLatinKey(value, caret, caret, key, state);
      value = next.value;
      caret = next.caret;
      state = next.state;
    }
    const afterH = value;
    const undone = applyImeBackspace(value, caret, state);
    expect(undone).not.toBeNull();
    expect(undone!.value).toBe(latinToThaana('a'));
    expect(undone!.value).not.toBe(afterH);
  });
});
