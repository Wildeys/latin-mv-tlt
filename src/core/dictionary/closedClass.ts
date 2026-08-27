/**
 * High-frequency English function words the bilingual dictionary often misses.
 *
 * A curated entry OVERRIDES the 16k bilingual lexicon, so a wrong entry here is
 * worse than no entry: the lookup never gets to consult the real dictionary.
 * Four were removed for that reason, each of them an open-class content word
 * pointing at a Dhivehi form that means something else:
 *
 *   work  → kurun  — `kurun` is "to do/make", not "to work"
 *   stay  → huri   — `huri` is "was / is present", not "to stay"
 *   never → nu     — `nu` is the negative prefix; "never" is not a bare negator
 *   exist → ulee   — a finite form, where every neighbouring verb is a lemma
 *
 * They now fall through to the bilingual dictionary. Replacements need a native
 * speaker rather than a guess, so none were invented — see Context/QUALITY.md.
 */
export const ENGLISH_TO_LATIN: Record<string, string> = {
  i: 'aharen',
  me: 'aharen',
  my: 'aharenge',
  we: 'aharemen',
  us: 'aharemen',
  you: 'kaley',
  // `eyna` is gender-neutral in Dhivehi; both English pronouns collapse onto it,
  // and the reverse gloss says so rather than picking one.
  he: 'eyna',
  she: 'eyna',
  they: 'emeehun',
  them: 'emeehun',
  self: 'thimaa',
  this: 'mi',
  that: 'ey',
  one: 'ek',
  which: 'kon',
  what: 'kon',
  not: 'nu',
  also: 'ves',
  although: 'namaves',
  when: 'iru',
  now: 'adhu',
  later: 'fahun',
  go: 'dhaa',
  going: 'dhaa',
  went: 'dhiya',
  gone: 'dhiya',
  come: 'ann',
  live: 'ulhun',
  drink: 'bonun',
  give: 'dhinun',
  sleep: 'nidun',
  look: 'belun',
  take: 'gann',
  buy: 'gathun',
  find: 'hoadhun',
  read: 'kiyun',
  write: 'liyun',
  male: 'male',
  malé: 'male',
  maldives: 'raajje',
  addu: 'addu',
  hulhumale: 'hulhumale',
  hulhumalé: 'hulhumale',
  today: 'miadhu',
  yesterday: 'iyye',
  tomorrow: 'maadhamaa',
  water: 'fen',
  house: 'ge',
  home: 'ge',
  person: 'meehu',
  people: 'meehun',
  food: 'kei',
  book: 'foiy',
  fish: 'mas',
  say: 'bunun',
  eat: 'keun',
  see: 'belun',
  know: 'engun',
};

export const LATIN_TO_ENGLISH: Record<string, string> = {
  aharen: 'I',
  aharenge: 'my',
  aharemen: 'we',
  ahah: 'to me',
  kaley: 'you',
  eyna: 'he/she',
  emeehun: 'they',
  thimaa: 'self',
  thimange: 'own',
  thibaa: 'you',
  mi: 'this',
  e: 'that',
  ey: 'that',
  thi: 'that',
  thiya: 'that',
  ek: 'one',
  kon: 'which',
  nu: 'not',
  nuun: 'no',
  neth: 'there is not',
  noonee: 'if not',
  eve: 'they say',
  ves: 'also',
  namaves: 'although',
  iru: 'when',
  maa: 'when',
  gai: 'in',
  ah: 'to',
  dhaa: 'go',
  dhaan: 'go',
  dhaanan: 'go',
  dhiya: 'go',
  dhiyun: 'go',
  ann: 'come',
  annan: 'come',
  ulhun: 'live',
  ulee: 'live',
  huri: 'was',
  vanee: 'is',
  bonun: 'drink',
  dhinun: 'give',
  nidun: 'sleep',
  gann: 'take',
  gathun: 'buy',
  hoadhun: 'find',
  kurun: 'do',
  kiyun: 'read',
  liyun: 'write',
  male: 'Male',
  maale: 'Male',
  raajje: 'Maldives',
  addu: 'Addu',
  hulhumale: 'Hulhumale',
  miadhu: 'today',
  iyye: 'yesterday',
  maadhamaa: 'tomorrow',
  adhu: 'now',
  fahun: 'later',
  fen: 'water',
  ge: 'house',
  meehu: 'person',
  meehun: 'people',
  kei: 'food',
  foiy: 'book',
  mas: 'fish',
  bunun: 'say',
  keun: 'eat',
  belun: 'look',
  engun: 'know',
};

/**
 * English keys that deliberately do NOT round-trip through LATIN_TO_ENGLISH.
 *
 * Dhivehi genuinely collapses these — one pronoun for `I`/`me`, one verb lemma
 * for `go`/`going`/`went`, one noun for `house`/`home` — so the reverse map can
 * only carry one gloss. Listing them makes the asymmetry a recorded decision
 * instead of an accident: `closedClass.test.ts` fails on any round-trip failure
 * that is not named here, which is what stopped `work → kurun → do` from sitting
 * in the table unnoticed.
 */
export const COLLAPSED_ENGLISH = new Set([
  'me',        // → aharen → I
  'us',        // → aharemen → we
  'them',      // → emeehun → they
  'what',      // → kon → which
  'going',     // → dhaa → go
  'went',      // → dhiya → go
  'gone',      // → dhiya → go
  'home',      // → ge → house
  'see',       // → belun → look
  'malé',      // → male → Male   (accent folded)
  'hulhumalé', // → hulhumale → Hulhumale
]);

/*
 * `LOCATION_LATIN`, `SUBJECT_LATIN` and `PARTICLE_LATIN` used to live here.
 * They classified words into semantic-frame slots — location, subject, particle
 * — and nothing has read them since `src/core/frames/` was deleted in the v0.2
 * migration. `export *` in the barrel kept them looking used.
 */
