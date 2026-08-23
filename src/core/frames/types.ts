export type Polarity = 'affirmative' | 'negative';

export type Tense = 'past' | 'present' | 'future' | 'present_continuous' | null;

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
] as const;
