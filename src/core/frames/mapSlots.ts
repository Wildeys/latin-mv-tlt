import { translateWord } from '../dictionary/lookup';
import { ENGLISH_TO_LATIN } from '../dictionary/closedClass';
import { EMPTY_FRAME, type SemanticFrame } from './types';

const TENSE_KEEP = new Set(['past', 'present', 'future', 'present_continuous']);

function mapValue(english: string | null): string | null {
  if (!english) return null;
  const key = english.trim().toLowerCase();
  if (key in ENGLISH_TO_LATIN) return ENGLISH_TO_LATIN[key];
  const hit = translateWord(english, 'english');
  if (hit.confidence === 'high') {
    return hit.transliteration || hit.translations[0]?.latin || null;
  }
  return english;
}

export function mapEnglishFrameToLatin(frame: SemanticFrame): SemanticFrame {
  return {
    ...EMPTY_FRAME,
    subject: mapValue(frame.subject),
    action: mapValue(frame.action),
    object: mapValue(frame.object),
    location: mapValue(frame.location),
    time: mapValue(frame.time),
    manner: mapValue(frame.manner),
    reason: mapValue(frame.reason),
    tense: frame.tense && TENSE_KEEP.has(frame.tense) ? frame.tense : frame.tense,
    polarity: frame.polarity,
    residue: frame.residue.map((token) => mapValue(token) ?? token),
  };
}
