/**
 * Run the exported model under Node, before it ever reaches a browser.
 *
 *     node tools/smoke_translate.mjs "aharen maleah dhaanan"
 *     node tools/smoke_translate.mjs --en "I will go to Male."
 *
 * The value is that it uses the *same* package and the *same* local-only
 * settings as `src/core/translate/runner.ts`, so a broken export fails here in
 * seconds instead of as a blank screen in devtools. It is the last gate before
 * M-8b deletes the v0.1 models.
 *
 * What it cannot check: the WASM backend path. Node resolves ONNX Runtime
 * differently from the browser, so a green run here does not prove
 * `public/ort/` is wired correctly — only `npm run dev` does that.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_ID = 'dv-en-translate';
const modelDir = join(root, 'public', 'models', MODEL_ID);

if (!existsSync(modelDir)) {
  console.error(`No model at public/models/${MODEL_ID}/.`);
  console.error('Train it (tools/train_translate.py) and export it (tools/export_onnx.py) first.');
  process.exit(1);
}

const args = process.argv.slice(2);
const enToDv = args[0] === '--en';
const text = (enToDv ? args.slice(1) : args).join(' ') || 'aharen maleah dhaanan';

const { env, pipeline } = await import('@huggingface/transformers');

// Same guarantees as the browser runner: local only, nothing fetched (R-3.6).
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = join(root, 'public', 'models');

// Read the prefixes from the same source the corpus builder uses, so this cannot
// smoke-test a prefix the model was never trained on (R-2.5).
const { execFileSync } = await import('node:child_process');
const prefixes = JSON.parse(
  execFileSync('node', [join(root, 'tools', 'transliterate.mjs'), '--prefixes'], {
    encoding: 'utf-8',
    cwd: root,
  }),
);

const prefix = enToDv ? prefixes['en-dv'] : prefixes['dv-en'];
const input = prefix + text;

console.log(`model   ${MODEL_ID}`);
console.log(`input   ${input}`);

const t0 = Date.now();
const pipe = await pipeline('text2text-generation', MODEL_ID, { dtype: 'q8' });
const loaded = Date.now();

const out = await pipe(input, { max_new_tokens: 128, num_beams: 1, do_sample: false });
const done = Date.now();

const first = Array.isArray(out) ? out[0] : out;
const generated = String(first?.generated_text ?? '').trim();

console.log(`output  ${generated || '(empty)'}`);
console.log(`\nload ${loaded - t0} ms · generate ${done - loaded} ms`);

if (!generated) {
  console.error('\nEmpty output. Check the export: a decoder without use_cache_branch');
  console.error('produces garbage or nothing from the second token onward.');
  process.exit(1);
}

if (enToDv) {
  const { execFileSync: exec } = await import('node:child_process');
  const thaana = exec('node', [join(root, 'tools', 'transliterate.mjs'), '--la2th', generated], {
    encoding: 'utf-8',
    cwd: root,
  }).trim();
  console.log(`thaana  ${thaana}`);
}
