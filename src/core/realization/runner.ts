import type { RealizationResult, RealizationStatus } from './types';

const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env ?? {};
const EN_MODEL = env.VITE_EN_REALIZE_MODEL || '';
const DV_MODEL = env.VITE_DV_REALIZE_MODEL || '';

type Generator = (text: string) => Promise<string>;

let enStatus: RealizationStatus = EN_MODEL ? 'not_loaded' : 'not_configured';
let dvStatus: RealizationStatus = DV_MODEL ? 'not_loaded' : 'not_configured';
let enGenerate: Generator | null = null;
let dvGenerate: Generator | null = null;
let enLoading: Promise<RealizationStatus> | null = null;
let dvLoading: Promise<RealizationStatus> | null = null;
let enError: string | undefined;
let dvError: string | undefined;

export function getEnglishRealizationStatus(): RealizationStatus {
  return enStatus;
}

export function getDhivehiRealizationStatus(): RealizationStatus {
  return dvStatus;
}

export function getConfiguredModels() {
  return { english: EN_MODEL || null, dhivehi: DV_MODEL || null };
}

async function loadPipeline(modelId: string): Promise<Generator> {
  const mod = await import('@xenova/transformers');
  const pipe = await mod.pipeline('text2text-generation', modelId);
  return async (text: string) => {
    const out = await pipe(text, { max_new_tokens: 64 });
    const first = Array.isArray(out) ? out[0] : out;
    return String((first as { generated_text?: string }).generated_text ?? first ?? '').trim();
  };
}

export async function ensureEnglishModel(): Promise<RealizationStatus> {
  if (!EN_MODEL) return 'not_configured';
  if (enGenerate) return 'ready';
  // Await the in-flight load rather than returning 'loading'. Returning early
  // made a concurrent caller silently produce no output.
  if (enLoading) return enLoading;
  enStatus = 'loading';
  enLoading = (async () => {
    try {
      enGenerate = await loadPipeline(EN_MODEL);
      enStatus = 'ready';
      enError = undefined;
    } catch (err) {
      enStatus = 'error';
      enError = err instanceof Error ? err.message : String(err);
    }
    return enStatus;
  })();
  try {
    return await enLoading;
  } finally {
    enLoading = null;
  }
}

export async function ensureDhivehiModel(): Promise<RealizationStatus> {
  if (!DV_MODEL) return 'not_configured';
  if (dvGenerate) return 'ready';
  if (dvLoading) return dvLoading;
  dvStatus = 'loading';
  dvLoading = (async () => {
    try {
      dvGenerate = await loadPipeline(DV_MODEL);
      dvStatus = 'ready';
      dvError = undefined;
    } catch (err) {
      dvStatus = 'error';
      dvError = err instanceof Error ? err.message : String(err);
    }
    return dvStatus;
  })();
  try {
    return await dvLoading;
  } finally {
    dvLoading = null;
  }
}

export async function realizeEnglish(frameString: string): Promise<RealizationResult> {
  if (!EN_MODEL) {
    return { status: 'not_configured', text: null, modelId: null };
  }
  const status = await ensureEnglishModel();
  if (status !== 'ready' || !enGenerate) {
    return { status, text: null, modelId: EN_MODEL, error: enError };
  }
  try {
    const text = await enGenerate(frameString);
    return { status: 'ready', text, modelId: EN_MODEL };
  } catch (err) {
    return {
      status: 'error',
      text: null,
      modelId: EN_MODEL,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function realizeDhivehiLatin(frameString: string): Promise<RealizationResult> {
  if (!DV_MODEL) {
    return { status: 'not_configured', text: null, modelId: null };
  }
  const status = await ensureDhivehiModel();
  if (status !== 'ready' || !dvGenerate) {
    return { status, text: null, modelId: DV_MODEL, error: dvError };
  }
  try {
    const text = await dvGenerate(frameString);
    return { status: 'ready', text, modelId: DV_MODEL };
  } catch (err) {
    return {
      status: 'error',
      text: null,
      modelId: DV_MODEL,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
