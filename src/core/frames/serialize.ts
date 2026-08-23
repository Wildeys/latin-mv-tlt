import { FRAME_KEYS, type SemanticFrame } from './types';

export function serializeFrame(frame: SemanticFrame): string {
  const parts: string[] = [];
  for (const key of FRAME_KEYS) {
    const value = frame[key];
    if (value === null || value === undefined || value === '') continue;
    parts.push(`${key.toUpperCase()}=${value}`);
  }
  return parts.join(' | ');
}

export function deserializeFrame(text: string): Partial<SemanticFrame> {
  const out: Partial<SemanticFrame> = {};
  for (const part of text.split('|')) {
    const [rawKey, ...rest] = part.split('=');
    if (!rawKey || !rest.length) continue;
    const key = rawKey.trim().toLowerCase() as keyof SemanticFrame;
    const value = rest.join('=').trim();
    if (key === 'residue') continue;
    if (key === 'polarity') {
      out.polarity = value === 'negative' ? 'negative' : 'affirmative';
    } else if (key === 'tense') {
      out.tense = value as SemanticFrame['tense'];
    } else {
      (out as Record<string, string>)[key] = value;
    }
  }
  return out;
}
