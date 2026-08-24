import { useRef, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { latinToThaana } from '../../core/transliterator/latinToThaana';

const LATIN = /^[a-zA-Z']$/;
const THAANA = /[\u0780-\u07BF]/;

type Field = HTMLInputElement | HTMLTextAreaElement;

export type ThaanaImeState = {
  latin: string;
  start: number | null;
};

export function applyLatinKey(
  value: string,
  caret: number,
  end: number,
  key: string,
  state: ThaanaImeState,
): { value: string; caret: number; state: ThaanaImeState } {
  const composingEnd =
    state.start !== null ? state.start + latinToThaana(state.latin).length : null;
  const continuing = state.start !== null && caret === end && caret === composingEnd;

  const start = continuing ? state.start! : caret;
  const latin = (continuing ? state.latin : '') + key;
  const thaana = latinToThaana(latin);
  const before = value.slice(0, start);
  const after = value.slice(continuing ? caret : end);
  return {
    value: before + thaana + after,
    caret: before.length + thaana.length,
    state: { latin, start },
  };
}

export function applyImeBackspace(
  value: string,
  caret: number,
  state: ThaanaImeState,
): { value: string; caret: number; state: ThaanaImeState } | null {
  if (!state.latin || state.start === null) return null;
  const latin = state.latin.slice(0, -1);
  const thaana = latin ? latinToThaana(latin) : '';
  const before = value.slice(0, state.start);
  const after = value.slice(caret);
  return {
    value: before + thaana + after,
    caret: before.length + thaana.length,
    state: latin ? { latin, start: state.start } : { latin: '', start: null },
  };
}

export function useThaanaIme(enabled: boolean) {
  const state = useRef<ThaanaImeState>({ latin: '', start: null });
  const handledInsert = useRef(false);

  function reset() {
    state.current = { latin: '', start: null };
  }

  function onKeyDown(
    e: KeyboardEvent<Field>,
    value: string,
    onChange: (next: string) => void,
  ) {
    if (!enabled) return;
    if (THAANA.test(e.key)) {
      reset();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.nativeEvent.isComposing) return;
    if (LATIN.test(e.key)) return;

    const el = e.currentTarget;
    const caret = el.selectionStart ?? value.length;

    if (e.key === 'Backspace') {
      const next = applyImeBackspace(value, caret, state.current);
      if (!next) {
        reset();
        return;
      }
      e.preventDefault();
      state.current = next.state;
      onChange(next.value);
      requestAnimationFrame(() => el.setSelectionRange(next.caret, next.caret));
      return;
    }

    reset();
  }

  function insertLatin(
    el: Field,
    value: string,
    data: string,
    onChange: (next: string) => void,
  ) {
    const caret = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? caret;
    let v = value;
    let c = caret;
    let en = end;
    let s = state.current;
    for (const key of data) {
      if (!LATIN.test(key)) continue;
      const next = applyLatinKey(v, c, en, key, s);
      v = next.value;
      c = next.caret;
      en = next.caret;
      s = next.state;
    }
    state.current = s;
    onChange(v);
    requestAnimationFrame(() => el.setSelectionRange(c, c));
  }

  function onBeforeInput(
    e: FormEvent<Field>,
    value: string,
    onChange: (next: string) => void,
  ) {
    if (!enabled) return;
    const ne = e.nativeEvent as InputEvent;
    if (ne.isComposing) return;
    if (ne.inputType !== 'insertText' || !ne.data) return;
    if (![...ne.data].every((ch) => LATIN.test(ch))) return;
    e.preventDefault();
    handledInsert.current = true;
    insertLatin(e.currentTarget, value, ne.data, onChange);
    requestAnimationFrame(() => {
      handledInsert.current = false;
    });
  }

  function onChange(
    e: ChangeEvent<Field>,
    prev: string,
    setValue: (next: string) => void,
  ) {
    if (!enabled) {
      setValue(e.target.value);
      return;
    }
    if (handledInsert.current) return;
    const next = e.target.value;
    const el = e.target;
    const caret = el.selectionStart ?? next.length;

    if (next.length === prev.length + 1 && caret > 0) {
      const inserted = next[caret - 1] ?? '';
      if (LATIN.test(inserted)) {
        const without = next.slice(0, caret - 1) + next.slice(caret);
        const result = applyLatinKey(without, caret - 1, caret - 1, inserted, state.current);
        state.current = result.state;
        setValue(result.value);
        requestAnimationFrame(() => el.setSelectionRange(result.caret, result.caret));
        return;
      }
    }

    if (/[a-zA-Z']/.test(next) && !THAANA.test(next)) {
      setValue(next.replace(/[a-zA-Z']+/g, (run) => latinToThaana(run)));
      reset();
      return;
    }

    reset();
    setValue(next);
  }

  return { onKeyDown, onBeforeInput, onChange, reset };
}
