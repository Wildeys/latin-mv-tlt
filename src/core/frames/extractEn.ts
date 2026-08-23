import { EMPTY_FRAME, type SemanticFrame, type Tense } from './types';

const SUBJECTS = new Set(['i', 'you', 'he', 'she', 'we', 'they', 'it']);
const TIME_WORDS = new Set(['today', 'yesterday', 'tomorrow', 'now', 'later', 'tonight']);
const LOCATION_PREPS = new Set(['to', 'in', 'at', 'from', 'on']);
const SKIP = new Set([
  'the',
  'a',
  'an',
  'to',
  'of',
  'and',
  'will',
  'would',
  'shall',
  'be',
  'been',
  'being',
  'is',
  'am',
  'are',
  'was',
  'were',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'not',
  "n't",
  'going',
]);

const ACTION_LEMMAS: Record<string, string> = {
  go: 'go',
  goes: 'go',
  going: 'go',
  went: 'go',
  gone: 'go',
  come: 'come',
  comes: 'come',
  came: 'come',
  eat: 'eat',
  eats: 'eat',
  ate: 'eat',
  see: 'see',
  sees: 'see',
  saw: 'see',
  say: 'say',
  says: 'say',
  said: 'say',
  know: 'know',
  knows: 'know',
  knew: 'know',
  drink: 'drink',
  drinks: 'drink',
  drank: 'drink',
  live: 'live',
  lives: 'live',
  lived: 'live',
};

function tokenizeEnglish(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .split(/[^a-zA-Z0-9áéíóúàèäöüñ'-]+/)
    .filter(Boolean);
}

function detectTense(tokens: string[]): Tense {
  const joined = tokens.join(' ');
  if (tokens.includes('will') || joined.includes('going to') || tokens.includes('gonna')) {
    return 'future';
  }
  if (tokens.some((t) => ['did', 'was', 'were', 'went', 'saw', 'ate', 'came', 'said', 'knew'].includes(t))) {
    return 'past';
  }
  if (tokens.some((t) => t.endsWith('ed'))) return 'past';
  if (tokens.includes('am') || tokens.includes('is') || tokens.includes('are')) return 'present';
  return 'present';
}

export function extractEnFrame(text: string): SemanticFrame {
  const tokens = tokenizeEnglish(text);
  const frame: SemanticFrame = { ...EMPTY_FRAME, residue: [] };
  const assigned = new Set<number>();

  if (tokens.some((t) => t === 'not' || t === "n't" || t === 'never' || t.endsWith("n't"))) {
    frame.polarity = 'negative';
    tokens.forEach((t, i) => {
      if (t === 'not' || t === "n't" || t === 'never' || t.endsWith("n't")) assigned.add(i);
    });
  }

  frame.tense = detectTense(tokens);
  tokens.forEach((t, i) => {
    if (['will', 'would', 'shall', 'did', 'going', 'gonna'].includes(t)) assigned.add(i);
  });

  for (let i = 0; i < tokens.length; i += 1) {
    if (SUBJECTS.has(tokens[i]) && !frame.subject) {
      const display = tokens[i] === 'i' ? 'I' : tokens[i];
      frame.subject = display;
      assigned.add(i);
      break;
    }
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const lemma = ACTION_LEMMAS[tokens[i]];
    if (lemma && !frame.action) {
      frame.action = lemma;
      assigned.add(i);
      break;
    }
  }

  for (let i = 0; i < tokens.length; i += 1) {
    if (TIME_WORDS.has(tokens[i])) {
      frame.time = tokens[i];
      assigned.add(i);
    }
    if (LOCATION_PREPS.has(tokens[i]) && tokens[i + 1] && tokens[i] !== 'to') {
      frame.location = capitalizePlace(tokens[i + 1]);
      assigned.add(i);
      assigned.add(i + 1);
    }
  }

  // "to Malé" / "to Male" is a location, not an infinitive, when followed by a noun-like token
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] === 'to' && tokens[i + 1] && !ACTION_LEMMAS[tokens[i + 1]] && !frame.location) {
      frame.location = capitalizePlace(tokens[i + 1]);
      assigned.add(i);
      assigned.add(i + 1);
    }
  }

  if (!frame.object) {
    for (let i = 0; i < tokens.length; i += 1) {
      if (assigned.has(i) || SKIP.has(tokens[i]) || SUBJECTS.has(tokens[i])) continue;
      if (ACTION_LEMMAS[tokens[i]]) continue;
      frame.object = tokens[i];
      assigned.add(i);
      break;
    }
  }

  for (let i = 0; i < tokens.length; i += 1) {
    if (!assigned.has(i) && !SKIP.has(tokens[i])) frame.residue.push(tokens[i]);
  }

  return frame;
}

function capitalizePlace(word: string): string {
  if (word === 'male' || word === 'malé') return 'Malé';
  return word.charAt(0).toUpperCase() + word.slice(1);
}
