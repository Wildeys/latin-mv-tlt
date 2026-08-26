/**
 * Remove the bundler's duplicate copy of the ONNX Runtime WASM from `dist/`.
 *
 * Two copies otherwise ship. `scripts/copy-ort.mjs` vendors the runtime into
 * `public/ort/`, and Vite *also* emits a content-hashed copy into `dist/assets/`
 * because onnxruntime-web references it via `new URL(..., import.meta.url)`.
 *
 * Only one is ever fetched. `src/core/translate/runner.ts` pins
 *
 *     env.backends.onnx.wasm.wasmPaths = `${BASE_URL}ort/`
 *
 * and ORT treats a string wasmPaths as a directory prefix — it concatenates the
 * unhashed filename onto it. So the request always goes to `/ort/…`, and the
 * hashed asset is dead weight: ~21 MB of it, which is the same class of problem
 * R-3.13 exists to prevent.
 *
 * The pin is what makes this safe. Do not delete this script's counterpart in
 * runner.ts without deleting this too, or the app will 404 looking for a WASM
 * that the bundler no longer emits.
 */

import { readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'dist', 'assets');
const vendored = join(root, 'dist', 'ort');

// Refuse to prune unless the copy we actually serve is present.
try {
  const served = readdirSync(vendored).filter((f) => f.endsWith('.wasm'));
  if (served.length === 0) throw new Error('no wasm in dist/ort/');
} catch (err) {
  console.error(`prune-ort: dist/ort/ is not usable (${err.message}); leaving dist/assets/ alone.`);
  process.exit(1);
}

let files;
try {
  files = readdirSync(assets);
} catch {
  process.exit(0);
}

let freed = 0;
for (const file of files) {
  if (!/^ort-wasm.*\.wasm$/.test(file)) continue;
  const full = join(assets, file);
  freed += statSync(full).size;
  rmSync(full);
  console.log(`prune-ort: removed duplicate ${file}`);
}

if (freed > 0) {
  console.log(`prune-ort: freed ${(freed / 1e6).toFixed(1)} MB (served from dist/ort/ instead)`);
}
