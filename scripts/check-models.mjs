/**
 * Enforce the runtime model budget in CI (R-3.4, R-3.13, NFR-13, AC-10).
 *
 * v0.1 shipped 307 MB of tracked ONNX, of which ~162 MB was never loaded: a
 * `decoder_with_past` graph the runtime never asks for, and a
 * `decoder_model_merged_quantized.onnx` that was a byte-identical copy of
 * `decoder_model_quantized.onnx`. Nothing caught that, because CI only built and
 * deployed. This script is the machine check that was missing.
 *
 * Two independent failures:
 *   1. total bytes over the budget (R-3.4);
 *   2. a graph present that the runtime never loads (R-3.13) — caught by name,
 *      because a duplicate that is *small* is still dead weight.
 *
 * Run via `npm run check:models`. Exit non-zero fails the deploy.
 */

import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modelsDir = join(root, 'public', 'models');

// R-3.4: ≤80 MB total INT8 for everything fetched at runtime, scoped to the
// model directory. The ONNX Runtime WASM (~21 MB, public/ort/) and the app
// bundle are reported separately — see REQUIREMENTS.md R-3.4.
const BUDGET_BYTES = 80_000_000;

// R-3.13: graphs the runtime never loads. `decoder_model_quantized` is the
// unmerged decoder — transformers.js asks for the *merged* graph, so shipping
// both means shipping one twice.
const FORBIDDEN = [
  { pattern: /decoder_with_past_model.*\.onnx$/, why: 'never loaded — the merged decoder carries the cache branch' },
  { pattern: /decoder_model_quantized\.onnx$/, why: 'unmerged duplicate — the runtime loads decoder_model_merged_quantized' },
];

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(full));
    else out.push(full);
  }
  return out;
}

// The budget is scoped to the v0.2 model. The v0.1 realization models are still
// on disk until M-8b (they are deleted only once the new model is verified in a
// browser), and failing on them would block CI for the whole migration — so they
// are reported as a warning that names the step which clears them.
const V2_MODEL = join(modelsDir, 'dv-en-translate');
const LEGACY = ['en-realize', 'dv-realize'];

let all;
try {
  all = walk(modelsDir);
} catch {
  console.log('check:models: public/models/ absent — nothing to check.');
  console.log('That is the expected state until the v0.2 model is trained (GAP-4).');
  process.exit(0);
}

const legacyBytes = all
  .filter((f) => LEGACY.some((d) => f.includes(join('models', d))))
  .reduce((n, f) => n + statSync(f).size, 0);

if (legacyBytes > 0) {
  console.warn(
    `check:models: WARNING — ${(legacyBytes / 1e6).toFixed(0)} MB of v0.1 realization models still present.`,
  );
  console.warn('  Removed by M-8b, after the v0.2 model is verified in a browser. Not counted below.\n');
}

let files;
try {
  files = walk(V2_MODEL);
} catch {
  console.log('check:models: public/models/dv-en-translate/ absent — nothing to check.');
  console.log('That is the expected state until the v0.2 model is trained (GAP-4).');
  process.exit(0);
}

if (files.length === 0) {
  console.log('check:models: dv-en-translate/ empty — nothing to check.');
  process.exit(0);
}

const problems = [];
let total = 0;

for (const file of files) {
  const size = statSync(file).size;
  total += size;
  const rel = relative(root, file);
  for (const { pattern, why } of FORBIDDEN) {
    if (pattern.test(file)) {
      problems.push(`  ${rel} (${(size / 1e6).toFixed(1)} MB) — ${why}`);
    }
  }
}

const sorted = files
  .map((f) => ({ rel: relative(V2_MODEL, f), size: statSync(f).size }))
  .sort((a, b) => b.size - a.size);

for (const { rel, size } of sorted) {
  console.log(`  ${(size / 1e6).toFixed(2).padStart(8)} MB  ${rel}`);
}
console.log(`  ${'-'.repeat(10)}`);
console.log(
  `  ${(total / 1e6).toFixed(2).padStart(8)} MB  total  (budget ${(BUDGET_BYTES / 1e6).toFixed(0)} MB)`,
);

let failed = false;

if (problems.length > 0) {
  console.error('\ncheck:models: FAIL — R-3.13, graphs shipped that the runtime never loads:');
  for (const p of problems) console.error(p);
  failed = true;
}

if (total > BUDGET_BYTES) {
  console.error(
    `\ncheck:models: FAIL — R-3.4, ${(total / 1e6).toFixed(1)} MB exceeds the ${(BUDGET_BYTES / 1e6).toFixed(0)} MB budget by ${((total - BUDGET_BYTES) / 1e6).toFixed(1)} MB.`,
  );
  console.error('See REQUIREMENTS.md R-3.2 for the contingency ladder (vocabulary trimming, q4 decoder).');
  failed = true;
}

if (failed) process.exit(1);

console.log('\ncheck:models: OK');
