import type { RealizationResult, RealizationStatus } from './types';

const IS_TEST = import.meta.env.MODE === 'test';
const EN_MODEL = 'en-realize';
const DV_MODEL = 'dv-realize';

type Generator = (text: string) => Promise<string>;

let envConfigured = false;
let enStatus: RealizationStatus = IS_TEST ? 'not_loaded' : 'not_loaded';
let dvStatus: RealizationStatus = IS_TEST ? 'not_loaded' : 'not_loaded';
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
  return { english: EN_MODEL, dhivehi: DV_MODEL };
}

type Seq2SeqModel = {
  decoder_merged_session?: { inputNames: string[] };
  runBeam: (beam: { prev_model_outputs: unknown }) => Promise<unknown>;
};

function patchDecoderWithoutKvCache(mod: typeof import('@xenova/transformers')) {
  // Transformers.js seq2seq always fetches decoder_model_merged. The Optimum
  // merge is ~159 MB (GitHub + wasm session-create fail), so we ship
  // decoder_model under that filename. That graph has no use_cache_branch, so
  // later steps must keep the full decoder_input_ids instead of the last token.
  const proto = mod.PreTrainedModel.prototype as unknown as Seq2SeqModel;
  const originalRunBeam = proto.runBeam;
  proto.runBeam = async function patchedRunBeam(this: Seq2SeqModel, beam) {
    const names = this.decoder_merged_session?.inputNames;
    if (names && !names.includes('use_cache_branch')) {
      beam.prev_model_outputs = null;
    }
    return originalRunBeam.call(this, beam);
  };
}

async function loadPipeline(modelId: string): Promise<Generator> {
  const mod = await import('@xenova/transformers');
  if (!envConfigured) {
    mod.env.allowLocalModels = true;
    mod.env.allowRemoteModels = false;
    mod.env.localModelPath = `${import.meta.env.BASE_URL}models/`;
    if (mod.env.backends?.onnx?.wasm) {
      // Cursor/Electron and many localhost pages have no SharedArrayBuffer.
      // Multi-thread ORT then fails with "Can't create a session".
      mod.env.backends.onnx.wasm.numThreads = 1;
      mod.env.backends.onnx.wasm.proxy = false;
    }
    patchDecoderWithoutKvCache(mod);
    envConfigured = true;
  }
  const pipe = await mod.pipeline('text2text-generation', modelId, { quantized: true });
  return async (text: string) => {
    const out = await pipe(text, { max_new_tokens: 64 });
    const first = Array.isArray(out) ? out[0] : out;
    return String((first as { generated_text?: string }).generated_text ?? first ?? '').trim();
  };
}

export async function ensureEnglishModel(): Promise<RealizationStatus> {
  if (IS_TEST) return 'not_loaded';
  if (enGenerate) return 'ready';
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
  if (IS_TEST) return 'not_loaded';
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
  if (IS_TEST) {
    return { status: 'not_loaded', text: null, modelId: EN_MODEL };
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
  if (IS_TEST) {
    return { status: 'not_loaded', text: null, modelId: DV_MODEL };
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
