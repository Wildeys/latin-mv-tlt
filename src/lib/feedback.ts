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

/**
 * Quote one CSV cell, and neutralise spreadsheet formula injection.
 *
 * A correction beginning `=`, `+`, `-`, `@` or a control character is executed as
 * a formula when the export is opened in Excel, Sheets or Numbers — the standard
 * CSV injection vector, and this file is *designed* to be opened in a
 * spreadsheet. Prefixing an apostrophe forces the cell to text; the leading
 * quote is visible in the cell but the value is preserved verbatim.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function csv(value: string): string {
  const safe = FORMULA_LEAD.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function downloadFeedbackCsv() {
  const blob = new Blob([exportFeedbackCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'latin-mv-tlt-feedback.csv';
  // Firefox requires the anchor to be in the document before a synthetic click
  // does anything at all, and both Firefox and Safari read the blob
  // asynchronously — revoking on the next line cancelled the download that had
  // just been started. Revoke on a later task instead.
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
