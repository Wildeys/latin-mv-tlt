export type HonorificEntry = {
  latin: string;
  thaana: string;
  english: string[];
  register: string;
  kind: string;
  plainForm: string | null;
};

export const REGISTERS = ['reverential', 'respectful', 'informal'] as const;

let lexicon: Record<string, HonorificEntry> | null = null;

export async function loadHonorifics(url = './data/honorifics.json'): Promise<Record<string, HonorificEntry>> {
  if (lexicon) return lexicon;
  const response = await fetch(url);
  const rows = (await response.json()) as HonorificEntry[];
  lexicon = Object.fromEntries(rows.map((row) => [row.latin.toLowerCase(), row]));
  return lexicon;
}

export function loadHonorificsSync(rows: HonorificEntry[]): Record<string, HonorificEntry> {
  lexicon = Object.fromEntries(rows.map((row) => [row.latin.toLowerCase(), row]));
  return lexicon;
}

export function detectRegister(words: string[]): string {
  const table = lexicon ?? {};
  const found = new Set(
    words
      .map((w) => table[w.trim().toLowerCase()]?.register)
      .filter((r): r is string => Boolean(r)),
  );
  for (const register of REGISTERS) {
    if (found.has(register)) return register;
  }
  return 'neutral';
}

export function lookupHonorific(word: string): HonorificEntry | undefined {
  return lexicon?.[word.trim().toLowerCase()];
}
