export type Polarity = 'affirmative' | 'negative';

export type Tense = 'past' | 'present' | 'future' | 'present_continuous' | null;

/**
 * Written Dhivehi ends a past-tense clause in `eve`; spoken Dhivehi does not.
 * The realization corpus carries both, so the slot has to be in the frame --
 * otherwise one frame string maps to two different sentences and the model
 * cannot learn which to produce. See Context/TRAINING-DATA.md.
 */
export type Register = 'spoken' | 'written';

export type SemanticFrame = {
  subject: string | null;
  action: string | null;
  object: string | null;
  location: string | null;
  time: string | null;
  manner: string | null;
  reason: string | null;
  tense: Tense;
  polarity: Polarity;
  register: Register;
  residue: string[];
};

export const EMPTY_FRAME: SemanticFrame = {
  subject: null,
  action: null,
  object: null,
  location: null,
  time: null,
  manner: null,
  reason: null,
  tense: null,
  polarity: 'affirmative',
  register: 'spoken',
  residue: [],
};

export const FRAME_KEYS = [
  'subject',
  'action',
  'object',
  'location',
  'time',
  'manner',
  'reason',
  'tense',
  'polarity',
  'register',
] as const;
