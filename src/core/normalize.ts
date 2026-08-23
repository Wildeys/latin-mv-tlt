const ZERO_WIDTH = /[\u200B\u200C\u200D\uFEFF]/g;

export function normalise(text: string): string {
  if (!text) return text;
  return text.normalize('NFC').replace(ZERO_WIDTH, '').replace(/\u00A0/g, ' ');
}

export const normalize = normalise;
