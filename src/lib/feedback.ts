export type FeedbackRow = {
  id: string;
  createdAt: string;
  original: string;
  generated: string;
  meaning: number;
  naturalness: number;
  correction: string;
  direction: string;
};

const KEY = 'latin-mv-tlt:feedback';

export function loadFeedback(): FeedbackRow[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]') as FeedbackRow[];
  } catch {
    return [];
  }
}

export function saveFeedback(row: Omit<FeedbackRow, 'id' | 'createdAt'>) {
  const next: FeedbackRow = {
    ...row,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const all = [...loadFeedback(), next];
  localStorage.setItem(KEY, JSON.stringify(all));
  return next;
}

export function exportFeedbackCsv(): string {
  const rows = loadFeedback();
  const header = 'id,createdAt,direction,original,generated,meaning,naturalness,correction';
  const body = rows.map((r) =>
    [
      r.id,
      r.createdAt,
      r.direction,
      csv(r.original),
      csv(r.generated),
      r.meaning,
      r.naturalness,
      csv(r.correction),
    ].join(','),
  );
  return [header, ...body].join('\n');
}

function csv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function downloadFeedbackCsv() {
  const blob = new Blob([exportFeedbackCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'latin-mv-tlt-feedback.csv';
  a.click();
  URL.revokeObjectURL(url);
}
