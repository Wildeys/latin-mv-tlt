import type { LoadProgress, TranslationResult, TranslationStatus } from './types';

/**
 * The v0.2 translation model: one seq2seq graph, both directions, selected by
 * task prefix (R-3.1).
 *
 * This is a refactor of `src/core/realization/runner.ts`, not a rewrite. Its
 * loader, status machine, single-in-flight dedup, test short-circuit and
 * single-thread WASM handling are the parts of v0.1 that worked, and R-3.3's
 * traceability note asks for them to carry over. What changed:
 *
 *   - one model instead of two, so eight module-level slots become four;
 *   - `@xenova/transformers` v2 → `@huggingface/transformers` v3;
 *   - the KV-cache monkey-patch is gone (see below);
 *   - the ONNX Runtime WASM is served from our own origin, not a CDN;
 *   - download progress is exposed, because 80 MB of silence is a defect (R-6.10).
 *
 * On the deleted monkey-patch: v0.1 shipped a *copy* of `decoder_model_quantized`
 * under the name `decoder_model_merged_quantized`, because the fp32 Optimum merge
 * was ~159 MB. That graph has no `use_cache_branch`, so the runner patched
 * `PreTrainedModel.prototype.runBeam` to stop the library feeding it a KV cache.
 * Three things retire that hack: `runBeam` no longer exists in v3; the export now
 * quantizes *after* merging, so the real merged decoder is ~42 MB rather than
 * 159 MB; and `tools/export_onnx.py` asserts `use_cache_branch` is present before
 * it will write the model at all.
 */

const IS_TEST = import.meta.env.MODE === 'test';

/** R-3.1: one model, not one per direction. */
const MODEL_ID = 'dv-en-translate';

/** R-3.5: max sequence length 128, greedy decoding. */
const MAX_NEW_TOKENS = 128;

type Generator = (text: string) => Promise<string>;

let envConfigured = false;
let status: TranslationStatus = 'not_loaded';
let generate: Generator | null = null;
let loading: Promise<TranslationStatus> | null = null;
let lastError: string | undefined;

// ---------------------------------------------------------------- progress

const progressListeners = new Set<(p: LoadProgress | null) => void>();
let lastProgress: LoadProgress | null = null;

/** Subscribe to weight-download progress (R-6.10). Returns an unsubscribe fn. */
export function onLoadProgress(listener: (p: LoadProgress | null) => void): () => void {
  progressListeners.add(listener);
  listener(lastProgress);
  return () => progressListeners.delete(listener);
}

function emitProgress(p: LoadProgress | null) {
  lastProgress = p;
  for (const listener of progressListeners) listener(p);
}

// ---------------------------------------------------------------- loader

async function loadPipeline(): Promise<Generator> {
  // Dynamic import keeps ONNX Runtime out of the initial bundle, so the app
  // shell and the transliterator are usable before any of it downloads (R-1.4).
  const mod = await import('@huggingface/transformers');

  if (!envConfigured) {
    // R-3.6: local only. No third-party model fetch at runtime, ever.
    mod.env.allowLocalModels = true;
    mod.env.allowRemoteModels = false;
    mod.env.localModelPath = `${import.meta.env.BASE_URL}models/`;

    if (mod.env.backends?.onnx?.wasm) {
      const wasm = mod.env.backends.onnx.wasm;

      // R-3.11: Cursor/Electron and many localhost pages have no
      // SharedArrayBuffer. Multi-threaded ORT then fails to create a session.
      wasm.numThreads = 1;
      wasm.proxy = false;

      // Without this the library points wasmPaths at
      // https://cdn.jsdelivr.net/npm/@huggingface/transformers@<version>/dist/,
      // which would make the first translation depend on a third-party CDN —
      // contradicting §1.2, NFR-2 and NFR-3. scripts/copy-ort.mjs vendors the
      // files into public/ort/ at build time.
      wasm.wasmPaths = `${import.meta.env.BASE_URL}ort/`;
    }

    envConfigured = true;
  }

  const pipe = await mod.pipeline('text2text-generation', MODEL_ID, {
    // v3 replaced v2's `quantized: true`. 'q8' resolves to the same
    // `*_quantized.onnx` filenames, so the on-disk layout is unchanged.
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number; progress?: number }) => {
      if (p.status === 'progress' && p.file) {
        emitProgress({
          file: p.file,
          loaded: p.loaded ?? 0,
          total: p.total ?? 0,
          progress: Math.round(p.progress ?? 0),
        });
      }
    },
  });

  emitProgress(null);

  return async (text: string) => {
    const out = await pipe(text, {
      max_new_tokens: MAX_NEW_TOKENS,
      // R-3.5 greedy, and NFR-7: with no sampling the model is reproducible,
      // which is what lets a published BLEU number be re-derived.
      num_beams: 1,
      do_sample: false,
    });
    const first = Array.isArray(out) ? out[0] : out;
    return String((first as { generated_text?: string }).generated_text ?? first ?? '').trim();
  };
}

// ---------------------------------------------------------------- status machine

/**
 * Load the model if it is not loaded. Concurrent callers share one in-flight
 * promise (R-3.7) — without this, two sentences translated at once would each
 * start a download.
 *
 * Never rejects: failures land in the returned status with `lastError` set, so
 * callers do not need a try/catch to stay correct.
 */
export async function ensureTranslationModel(): Promise<TranslationStatus> {
  if (IS_TEST) return 'not_loaded';
  if (generate) return 'ready';
  if (loading) return loading;

  status = 'loading';
  loading = (async () => {
    try {
      generate = await loadPipeline();
      status = 'ready';
      lastError = undefined;
    } catch (err) {
      status = 'error';
      lastError = err instanceof Error ? err.message : String(err);
      emitProgress(null);
    }
    return status;
  })();

  try {
    return await loading;
  } finally {
    // Cleared so a later call retries after an error. `generate` is still null
    // in that case, so the retry starts from scratch.
    loading = null;
  }
}

export function getTranslationStatus(): TranslationStatus {
  return status;
}

export function getTranslationError(): string | undefined {
  return lastError;
}

export function getConfiguredModel(): string {
  return MODEL_ID;
}

// ---------------------------------------------------------------- inference

/**
 * Run the model over an already-prefixed input (see `./prefixes`).
 *
 * Takes the full prefixed string rather than (text, direction) so that the exact
 * bytes handed to the model are decided in one place and can be shown verbatim
 * on the Breakdown screen (R-6.2).
 *
 * Under `MODE === 'test'` this returns `not_loaded` without importing the
 * library at all — that short-circuit is what makes NFR-6 true (tests touch no
 * model and no network), so it must come before the dynamic import, not after.
 */
export async function translateText(prefixedInput: string): Promise<TranslationResult> {
  if (IS_TEST) {
    return { status: 'not_loaded', text: null, modelId: MODEL_ID };
  }

  const current = await ensureTranslationModel();
  if (current !== 'ready' || !generate) {
    return { status: current, text: null, modelId: MODEL_ID, error: lastError };
  }

  try {
    const text = await generate(prefixedInput);
    return { status: 'ready', text, modelId: MODEL_ID };
  } catch (err) {
    return {
      status: 'error',
      text: null,
      modelId: MODEL_ID,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
