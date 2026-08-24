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

/**
 * Kept in step with ACTION_EXTRACT in tools/build_frame_pairs.py. The two
 * tables must agree or the model is trained on frame strings the app never
 * produces -- src/core/frames/crosscheck.test.ts enforces it.
 */
const ACTION_LEMMAS: Record<string, string> = {
  go: 'go',
  goes: 'go',
  going: 'go',
  went: 'go',
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
  stay: 'stay',
  stays: 'stay',
  stayed: 'stay',
  walk: 'walk',
  walks: 'walk',
  walked: 'walk',
  give: 'give',
  gives: 'give',
  gave: 'give',
  take: 'take',
  takes: 'take',
  took: 'take',
  buy: 'buy',
  buys: 'buy',
  bought: 'buy',
  find: 'find',
  finds: 'find',
  found: 'find',
  read: 'read',
  reads: 'read',
  write: 'write',
  writes: 'write',
  wrote: 'write',
};

function tokenizeEnglish(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .split(/[^a-zA-Z0-9áéíóúàèäöüñ'-]+/)
    .filter(Boolean);
}

/**
 * Words ending in `-ed` that are not past-tense verbs. Without this, "I need
 * water" and "the red bed" were both read as past tense.
 */
const NON_PAST_ED = new Set([
  'need',
  'red',
  'bed',
  'seed',
  'feed',
  'deed',
  'indeed',
  'speed',
  'hundred',
  'sacred',
  'shed',
  'sled',
  'wed',
  'greed',
  'creed',
  'breed',
  'freed',
  'agreed',
  'ted',
  'led',
  'fed',
]);

function looksPastEd(token: string): boolean {
  return token.length > 3 && token.endsWith('ed') && !NON_PAST_ED.has(token);
}

function detectTense(tokens: string[]): Tense {
  const joined = tokens.join(' ');
  if (tokens.includes('will') || joined.includes('going to') || tokens.includes('gonna')) {
    return 'future';
  }
  if (tokens.some((t) => ['did', 'was', 'were', 'went', 'saw', 'ate', 'came', 'said', 'knew'].includes(t))) {
    return 'past';
  }
  if (tokens.some(looksPastEd)) return 'past';
  if (tokens.includes('am') || tokens.includes('is') || tokens.includes('are')) return 'present';
  return 'present';
}

/**
 * Verbs a bare `to` can be an infinitive marker for. `to sleep` is not a place,
 * even though `sleep` is absent from ACTION_LEMMAS.
 */
const KNOWN_VERBS = new Set([
  ...Object.keys(ACTION_LEMMAS),
  'sleep',
  'sleeps',
  'slept',
  'stay',
  'stays',
  'stayed',
  'work',
  'works',
  'worked',
  'read',
  'reads',
  'write',
  'writes',
  'wrote',
  'take',
  'takes',
  'took',
  'give',
  'gives',
  'gave',
  'buy',
  'buys',
  'bought',
  'find',
  'finds',
  'found',
  'walk',
  'walks',
  'walked',
  'look',
  'looks',
  'looked',
  'want',
  'wants',
  'wanted',
  'need',
  'needs',
  'be',
  'do',
  'get',
  'gets',
  'got',
  'make',
  'makes',
  'made',
]);

/**
 * Place words that name a location on their own, with no preposition. Mirrors
 * the bare-place branch in tools/build_frame_pairs.py:extract_en.
 */
const BARE_PLACES = new Set([
  'home',
  'male',
  'malé',
  'hulhumale',
  'hulhumalé',
  'maldives',
  'addu',
]);

/** First token at or after `start` that carries content, skipping articles. */
function nextContentToken(tokens: string[], start: number): number {
  for (let i = start; i < tokens.length && i < start + 3; i += 1) {
    if (!SKIP.has(tokens[i])) return i;
  }
  return -1;
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

  // First time word wins, like the subject and action loops above. Without the
  // guard and the break, "today tomorrow" kept `tomorrow` and swallowed
  // `today` out of the residue as well.
  for (let i = 0; i < tokens.length; i += 1) {
    if (TIME_WORDS.has(tokens[i]) && !frame.time) {
      frame.time = tokens[i];
      assigned.add(i);
      break;
    }
  }

  // A goal (`to X`) outranks a source (`from X`): in "I go to Male from Addu"
  // the location is Male. `to` is only a location marker when what follows is
  // not a verb, so "I want to sleep" keeps an empty location slot.
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] !== 'to' || frame.location) continue;
    const target = nextContentToken(tokens, i + 1);
    if (target < 0 || KNOWN_VERBS.has(tokens[target])) continue;
    frame.location = capitalizePlace(tokens[target]);
    assigned.add(i);
    assigned.add(target);
    break;
  }

  for (let i = 0; i < tokens.length; i += 1) {
    if (!LOCATION_PREPS.has(tokens[i]) || tokens[i] === 'to' || frame.location) continue;
    // Skip the article: "from the store" is a location of `store`, not `the`.
    const target = nextContentToken(tokens, i + 1);
    if (target < 0) continue;
    frame.location = capitalizePlace(tokens[target]);
    assigned.add(i);
    assigned.add(target);
    break;
  }

  // A bare place word is still a location: "We came home", "I went Male".
  // Without this the slot stayed empty unless a preposition introduced it.
  for (let i = 0; i < tokens.length; i += 1) {
    if (frame.location || assigned.has(i) || !BARE_PLACES.has(tokens[i])) continue;
    frame.location = capitalizePlace(tokens[i]);
    assigned.add(i);
    break;
  }

  if (!frame.object) {
    for (let i = 0; i < tokens.length; i += 1) {
      if (assigned.has(i) || SKIP.has(tokens[i]) || SUBJECTS.has(tokens[i])) continue;
      if (ACTION_LEMMAS[tokens[i]]) continue;
      // A second time word is not an object. Let it fall through to residue.
      if (TIME_WORDS.has(tokens[i]) || LOCATION_PREPS.has(tokens[i])) continue;
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

/**
 * Slot values stay plain ASCII so the frame string the model sees matches the
 * training corpus exactly. See Context/DATA.md.
 */
function capitalizePlace(word: string): string {
  // `home` is a common noun and the corpus slot value is lowercase.
  if (word === 'home') return 'home';
  if (word === 'male' || word === 'malé') return 'Male';
  if (word === 'hulhumale' || word === 'hulhumalé') return 'Hulhumale';
  if (word === 'maldives') return 'Maldives';
  return word.charAt(0).toUpperCase() + word.slice(1);
}
