export type SuffixParse = {
  input: string;
  root: string;
  suffix: string | null;
  case?: string;
  tense?: string;
  english?: string;
};

export type StemAnalysis = {
  root: string;
  suffixes: string[];
  englishHints: string[];
};

const NOUN_SUFFIXES: Record<string, { case: string; english: string }> = {
  ge: { case: 'genitive', english: 'of' },
  gey: { case: 'genitive', english: 'of' },
  ah: { case: 'dative', english: 'to' },
  ga: { case: 'locative', english: 'on/in' },
  eh: { case: 'ablative', english: 'from' },
  un: { case: 'nominative', english: '' },
  kamah: { case: 'indefinite', english: 'some' },
};

const VERB_SUFFIXES: Record<string, { tense: string }> = {
  nna: { tense: 'present_continuous' },
  fi: { tense: 'past' },
  vani: { tense: 'future' },
  un: { tense: 'verbal_noun' },
};

export const STEM_SUFFIXES: [string, string][] = [
  ['thakuge', 'of'],
  ['thakah', 'to'],
  ['thakun', 'from'],
  ['thakaai', 'and'],
  ['thakee', ''],
  ['thaku', ''],
  ['thah', ''],
  ['tha', ''],
  ['kamaai', 'and'],
  ['kamuge', 'of'],
  ['kamah', 'to'],
  ['kamun', 'from'],
  ['kamee', ''],
  ['kan', ''],
  ['kohdhehvai', ''],
  ['dhehvai', ''],
  ['dhehvi', ''],
  ['vamun', ''],
  ['veyiru', 'when'],
  ['veemaa', 'if'],
  ['vanee', ''],
  ['vaane', ''],
  ['vejje', ''],
  ['vaa', ''],
  ['vee', ''],
  ['vun', ''],
  ['vi', ''],
  ['ve', ''],
  ['kollun', ''],
  ['kolli', ''],
  ['koh', ''],
  ['fulhun', ''],
  ['fulhu', ''],
  ['eve', ''],
  ['gai', 'in'],
  ['gey', 'of'],
  ['ge', 'of'],
  ['ah', 'to'],
  ['ash', 'to'],
  ['aai', 'and'],
  ['un', 'from'],
  ['in', 'from'],
  ['ai', ''],
  ['aku', 'a'],
  ['akee', 'is'],
  ['ek', 'a'],
  ['eh', 'a'],
  ['ee', ''],
  ['ey', ''],
];

const STEM_BY_LEN = [...STEM_SUFFIXES].sort((a, b) => b[0].length - a[0].length);
const NOUN_BY_LEN = Object.entries(NOUN_SUFFIXES).sort((a, b) => b[0].length - a[0].length);
const VERB_BY_LEN = Object.entries(VERB_SUFFIXES).sort((a, b) => b[0].length - a[0].length);

const LETTER_VARIANTS: [string, string][] = [
  ['q', 'g'],
  ['kh', 'h'],
  ['gh', 'g'],
  ['dhh', 'dh'],
];
const MUTATIONS: [string, string][] = [
  ['m', 'n'],
  ['h', 's'],
];

const MIN_STEM_LEN = 5;
const MAX_STRIP_DEPTH = 3;
const SUFFIX_MIN_STEM: Record<string, number> = {
  fulhu: 2,
  fulhun: 2,
  kolhu: 2,
  kolhun: 2,
  thakuge: 3,
  thakah: 3,
  thakun: 3,
  thakaai: 3,
  thaku: 3,
  kamaai: 3,
  kamuge: 3,
  kamah: 3,
  kamun: 3,
  kohdhehvai: 3,
  dhehvai: 3,
  veyiru: 3,
  vamun: 3,
};

export const LATIN_INFLECTION_SUFFIXES = [
  'kamah',
  'vani',
  'nna',
  'gey',
  'ge',
  'ah',
  'ga',
  'eh',
  'un',
  'in',
  'fi',
  'anan',
  'ee',
];

function minStemFor(suffix: string): number {
  return SUFFIX_MIN_STEM[suffix] ?? MIN_STEM_LEN;
}

export function parseSuffix(word: string): SuffixParse {
  const wordLower = word.toLowerCase();

  for (const [suffix, info] of NOUN_BY_LEN) {
    if (wordLower.endsWith(suffix) && wordLower.length > suffix.length) {
      return {
        input: word,
        root: wordLower.slice(0, -suffix.length),
        suffix,
        ...info,
      };
    }
  }

  for (const [suffix, info] of VERB_BY_LEN) {
    if (wordLower.endsWith(suffix) && wordLower.length > suffix.length) {
      return {
        input: word,
        root: wordLower.slice(0, -suffix.length),
        suffix,
        ...info,
      };
    }
  }

  return { input: word, root: wordLower, suffix: null };
}

export function parseWordList(words: string[]): SuffixParse[] {
  return words.map(parseSuffix);
}

function desandhi(word: string): string[] {
  const out: string[] = [];
  if (word.endsWith('ey')) out.push(word.slice(0, -2) + 'e');
  if (word.endsWith('ee')) out.push(word.slice(0, -2) + 'i');
  if (word.endsWith('aa')) out.push(word.slice(0, -2) + 'a');
  if (word.endsWith('oo')) out.push(word.slice(0, -2) + 'u');
  if (
    word.length >= 2 &&
    word.at(-1) === word.at(-2) &&
    /[a-z]/i.test(word.at(-1) ?? '') &&
    !'aeiou'.includes(word.at(-1) ?? '')
  ) {
    out.push(word.slice(0, -1));
  }
  return out;
}

function spellingVariants(word: string): string[] {
  const seen = new Set<string>([word]);
  const out = [word];
  const emit = (candidate: string) => {
    if (candidate && !seen.has(candidate)) {
      seen.add(candidate);
      out.push(candidate);
    }
  };
  for (const [src, dst] of LETTER_VARIANTS) {
    if (word.includes(src)) emit(word.replaceAll(src, dst));
  }
  for (const [src, dst] of MUTATIONS) {
    if (word.endsWith(src)) emit(word.slice(0, -src.length) + dst);
  }
  for (const candidate of desandhi(word)) emit(candidate);
  if (word && !'aeiou'.includes(word.at(-1) ?? '')) emit(word + 'un');
  return out;
}

export function stemWord(
  word: string,
  known: (latin: string) => boolean,
  maxDepth = MAX_STRIP_DEPTH,
): StemAnalysis | null {
  const cleaned = (word || '').trim().toLowerCase();
  if (!cleaned) return null;

  for (const variant of spellingVariants(cleaned)) {
    if (known(variant)) return { root: variant, suffixes: [], englishHints: [] };
  }

  let frontier: Array<[string, string[], string[]]> = [[cleaned, [], []]];
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next: Array<[string, string[], string[]]> = [];
    for (const [current, suffixes, hints] of frontier) {
      for (const [suffix, hint] of STEM_BY_LEN) {
        if (!current.endsWith(suffix)) continue;
        const candidate = current.slice(0, -suffix.length);
        if (candidate.length < minStemFor(suffix)) continue;
        const newSuffixes = [...suffixes, suffix];
        const newHints = hint ? [...hints, hint] : hints;
        for (const variant of spellingVariants(candidate)) {
          if (known(variant)) {
            return { root: variant, suffixes: newSuffixes, englishHints: newHints };
          }
        }
        next.push([candidate, newSuffixes, newHints]);
      }
    }
    if (!next.length) break;
    frontier = next;
  }
  return null;
}

export function generate(stem: string, suffixes: string[] = LATIN_INFLECTION_SUFFIXES): Set<string> {
  const forms = new Set<string>();
  const base = (stem || '').trim();
  if (!base) return forms;
  for (const suffix of suffixes) {
    if (suffix) forms.add(base + suffix);
  }
  forms.delete(base);
  return forms;
}
