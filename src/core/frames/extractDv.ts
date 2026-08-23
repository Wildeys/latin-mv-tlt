import { LOCATION_LATIN, SUBJECT_LATIN } from '../dictionary/closedClass';
import { englishGloss, type WordTranslation } from '../dictionary';
import { parseSuffix } from '../morphology/suffixParser';
import { EMPTY_FRAME, type SemanticFrame, type Tense } from './types';

const TIME_LATIN = new Set(['miadhu', 'iyye', 'maadhamaa', 'adhu', 'fahun']);
const TENSE_FROM_SUFFIX: Record<string, Tense> = {
  anan: 'future',
  vani: 'future',
  vaane: 'future',
  nna: 'present_continuous',
  vanee: 'present_continuous',
  fi: 'past',
  vejje: 'past',
  ee: 'present',
  ey: 'present',
};

function foldTense(suffixes: string[], parsedTense?: string): Tense {
  if (parsedTense === 'future' || parsedTense === 'past' || parsedTense === 'present_continuous') {
    return parsedTense;
  }
  for (const suffix of suffixes) {
    if (suffix in TENSE_FROM_SUFFIX) return TENSE_FROM_SUFFIX[suffix];
  }
  return null;
}

export function extractDvFrame(words: string[], lookups: WordTranslation[]): SemanticFrame {
  const frame: SemanticFrame = { ...EMPTY_FRAME, residue: [] };
  const assigned = new Set<number>();

  for (let i = 0; i < words.length; i += 1) {
    const surface = words[i].toLowerCase();
    const lookup = lookups[i];
    const latin = (lookup?.stem || lookup?.transliteration || surface).toLowerCase();
    const suffixes = lookup?.suffixes ?? [];
    const parsed = parseSuffix(surface);
    const gloss = lookup ? englishGloss(lookup).replace(/^\[unknown:\s*|\]$/g, '') : latin;
    const unknown = !lookup || lookup.confidence === 'low';

    if (surface.startsWith('nu') && surface.length > 3) {
      frame.polarity = 'negative';
    }

    if (!frame.subject && (SUBJECT_LATIN.has(latin) || /^(i|he|she|we|they|you)$/i.test(gloss))) {
      frame.subject = unknown ? latin : gloss;
      assigned.add(i);
      continue;
    }

    if (!frame.location && (LOCATION_LATIN.has(latin) || suffixes.some((s) => s === 'gai' || s === 'ah' || s === 'ga'))) {
      frame.location = unknown ? latin : gloss;
      if (!frame.tense) frame.tense = foldTense(suffixes, parsed.tense);
      assigned.add(i);
      continue;
    }

    if (!frame.time && TIME_LATIN.has(latin)) {
      frame.time = unknown ? latin : gloss;
      assigned.add(i);
      continue;
    }

    const tense = foldTense(suffixes, parsed.tense);
    const looksVerbal =
      Boolean(tense) ||
      /un$|aan$|ee$|ey$|jje$/.test(surface) ||
      lookup?.translations[0]?.pos === 'verb';
    if (!frame.action && looksVerbal) {
      frame.action = unknown ? (lookup?.stem || latin) : gloss.split(' ')[0];
      if (tense) frame.tense = tense;
      assigned.add(i);
    }
  }

  if (!frame.object) {
    for (let i = 0; i < words.length; i += 1) {
      if (assigned.has(i)) continue;
      const lookup = lookups[i];
      const pos = lookup?.translations[0]?.pos ?? '';
      if (pos === 'noun' || pos === 'proper') {
        frame.object = lookup ? englishGloss(lookup) : words[i];
        assigned.add(i);
        break;
      }
    }
  }

  for (let i = 0; i < words.length; i += 1) {
    if (!assigned.has(i)) frame.residue.push(words[i]);
  }

  return frame;
}
