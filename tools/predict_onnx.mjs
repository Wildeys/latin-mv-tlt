/**
 * Generate predictions for a corpus split with the exported ONNX model (M-10).
 *
 *     node tools/predict_onnx.mjs --in evaluation/test_sample.jsonl \
 *                                 --out evaluation/predictions.jsonl
 *     node tools/predict_onnx.mjs --in ... --out ... --shard 0/4     # one of four
 *     node tools/predict_onnx.mjs --merge evaluation/predictions.shard-*.jsonl \
 *                                 --out evaluation/predictions.jsonl
 *     node tools/predict_onnx.mjs --in ... --out ... --check         # coverage only
 *
 * `tools/smoke_translate.mjs` proves the export loads; this produces the
 * thousands of outputs `tools/evaluate.py` needs to turn it into a BLEU number.
 * It deliberately shares that script's environment - local models only, nothing
 * fetched - and `src/core/translate/runner.ts`'s generation settings, because a
 * score produced with different decoding describes a system nobody uses.
 *
 * Two hazards it is built around:
 *
 *   - the corpus rows are *already prefixed*. smoke_translate.mjs prepends a
 *     prefix to raw user text; doing that here would send the model
 *     "translate ... : translate ... : sentence", which it has never seen and
 *     would silently score as a bad model rather than a bad harness. Every input
 *     is checked against the prefixes tools/transliterate.mjs reports, and a row
 *     carrying zero or two of them stops the run.
 *   - evaluate.py refuses to score a partial set, so a run interrupted at 90%
 *     is worth nothing unless it can resume. Predictions are appended and
 *     flushed per row, and an existing output file is read back as a skip list.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_ID = 'dv-en-translate';

// Mirrors src/core/translate/runner.ts. Not imported: that module is TypeScript
// and browser-targeted, so the constants are restated with this pointer.
const MAX_NEW_TOKENS = 128;
const MAX_INPUT_TOKENS = 128;

// ------------------------------------------------------------------ args

function parseArgs(argv) {
  const args = { batch: 1 };
  const merge = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') args.check = true;
    else if (arg === '--merge') {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) merge.push(argv[++i]);
    } else if (arg.startsWith('--')) args[arg.slice(2)] = argv[++i];
    else merge.push(arg);
  }
  if (merge.length) args.merge = merge;
  return args;
}

const args = parseArgs(process.argv.slice(2));
const outPath = args.out ? join(root, args.out) : null;
if (!outPath) {
  console.error('--out is required');
  process.exit(2);
}

const readJsonl = (path) =>
  readFileSync(path, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

// ------------------------------------------------------------------ merge

/**
 * Per-direction latency, written from whatever rows are on hand.
 *
 * This lives on the merge path rather than the generate path because the run
 * that produces the reported numbers is sharded, and a shard only ever sees a
 * quarter of the rows. Every prediction row carries its own `ms`, so the merged
 * file is the one place the full distribution exists.
 */
function writeLatency(predictions, { shards }) {
  const byDirection = {};
  for (const direction of ['dv-en', 'en-dv']) {
    const values = predictions
      .filter((r) => r.direction === direction && !r.refused && typeof r.ms === 'number')
      .map((r) => r.ms)
      .sort((a, b) => a - b);
    if (!values.length) continue;
    const at = (q) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
    byDirection[direction] = {
      n: values.length,
      meanMs: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
      medianMs: at(0.5),
      p90Ms: at(0.9),
      p99Ms: at(0.99),
      samples: values,
    };
  }
  if (!Object.keys(byDirection).length) return;

  writeFileSync(
    join(root, 'evaluation', 'predict_latency.json'),
    JSON.stringify(
      {
        generatedBy: 'tools/predict_onnx.mjs',
        model: MODEL_ID,
        decoding: { max_new_tokens: MAX_NEW_TOKENS, num_beams: 1, do_sample: false },
        runtime: {
          node: process.version,
          platform: `${process.platform} ${process.arch}`,
          cpu: cpuModel(),
          concurrentShards: shards,
        },
        byDirection,
        note:
          'Node.js with the ONNX Runtime wasm backend on CPU — not browser latency, and not ' +
          'comparable to it. ' +
          (shards > 1
            ? `Measured with ${shards} shards running concurrently, so each row's wall-clock `
              + 'time is inflated by contention; the throughput of the run as a whole is not.'
            : 'Measured single-process.'),
      },
      null,
      2,
    ) + '\n',
  );
  console.log('wrote evaluation/predict_latency.json');
}

function cpuModel() {
  try {
    return execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

if (args.merge) {
  const seen = new Map();
  let duplicates = 0;
  for (const file of args.merge) {
    for (const row of readJsonl(join(root, file))) {
      if (seen.has(row.source)) duplicates += 1;
      else seen.set(row.source, row);
    }
  }
  const merged = [...seen.values()];
  writeFileSync(outPath, merged.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`merged ${args.merge.length} shards → ${relative(root, outPath)}`);
  console.log(`  ${merged.length} predictions, ${duplicates} duplicate sources dropped`);
  writeLatency(merged, { shards: args.merge.length });
  process.exit(0);
}

if (!args.in) {
  console.error('--in is required (a corpus JSONL with input/target/direction)');
  process.exit(2);
}

const inPath = join(root, args.in);
const rows = readJsonl(inPath);

// ------------------------------------------------------------------ prefixes

const prefixes = JSON.parse(
  execFileSync('node', [join(root, 'tools', 'transliterate.mjs'), '--prefixes'], {
    encoding: 'utf-8',
    cwd: root,
  }),
);
const prefixValues = Object.values(prefixes);

for (const [i, row] of rows.entries()) {
  const matches = prefixValues.filter((p) => row.input.startsWith(p));
  if (matches.length !== 1) {
    console.error(`row ${i}: input carries ${matches.length} task prefixes, expected exactly 1`);
    console.error(`  ${row.input.slice(0, 90)}`);
    console.error('Corpus rows are pre-prefixed by tools/build_translation_pairs.py.');
    console.error('Do not prepend another one — the model has never seen a doubled prefix.');
    process.exit(1);
  }
  const expected = prefixes[row.direction];
  if (expected && !row.input.startsWith(expected)) {
    console.error(`row ${i}: direction ${row.direction} but input carries the other prefix`);
    process.exit(1);
  }
}

// ------------------------------------------------------------------ shard + resume

let selected = rows;
let shardLabel = 'all';
if (args.shard) {
  const [index, total] = args.shard.split('/').map(Number);
  if (!Number.isInteger(index) || !Integer(total) || index < 0 || index >= total) {
    console.error(`--shard must be i/n with 0 <= i < n, got ${args.shard}`);
    process.exit(2);
  }
  selected = rows.filter((_, i) => i % total === index);
  shardLabel = `${index}/${total}`;
}
function Integer(n) {
  return Number.isInteger(n) && n > 0;
}
if (args.limit) selected = selected.slice(0, Number(args.limit));

const done = new Set();
if (existsSync(outPath)) {
  for (const row of readJsonl(outPath)) done.add(row.source);
}

const pending = selected.filter((row) => !done.has(row.input));

if (args.check) {
  const missing = selected.filter((row) => !done.has(row.input));
  console.log(`${relative(root, outPath)}: ${done.size} predictions on file`);
  console.log(`${relative(root, inPath)}: ${selected.length} rows required`);
  if (missing.length) {
    console.error(`\n${missing.length} rows have no prediction. evaluate.py would refuse to score.`);
    for (const row of missing.slice(0, 5)) console.error(`  ${row.input.slice(0, 80)}`);
    process.exit(1);
  }
  console.log('OK — every row has a prediction');
  process.exit(0);
}

console.log(`model   ${MODEL_ID}`);
console.log(`in      ${relative(root, inPath)}  (${rows.length} rows, shard ${shardLabel})`);
console.log(`out     ${relative(root, outPath)}`);
console.log(`todo    ${pending.length}  (${done.size} already predicted)`);

if (!pending.length) {
  console.log('nothing to do');
  process.exit(0);
}

// ------------------------------------------------------------------ model

const modelDir = join(root, 'public', 'models', MODEL_ID);
if (!existsSync(modelDir)) {
  console.error(`No model at public/models/${MODEL_ID}/. Export it first (tools/export_onnx.py).`);
  process.exit(1);
}

const { env, pipeline } = await import('@huggingface/transformers');
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = join(root, 'public', 'models');

const t0 = Date.now();
const pipe = await pipeline('text2text-generation', MODEL_ID, { dtype: 'q8' });
console.log(`load    ${Date.now() - t0} ms\n`);

// ------------------------------------------------------------------ generate

const latencies = { 'dv-en': [], 'en-dv': [] };
let refused = 0;
let empty = 0;
const started = Date.now();

for (const [i, row] of pending.entries()) {
  const encoded = pipe.tokenizer(row.input);
  const inputTokens = encoded.input_ids.dims.at(-1) ?? 0;

  let prediction = '';
  let wasRefused = false;
  const t = Date.now();

  if (inputTokens > MAX_INPUT_TOKENS) {
    // The browser runner throws here rather than letting the tokenizer truncate
    // (R-3.5). Recording the refusal keeps the row countable instead of silently
    // scoring a translation of half a sentence.
    wasRefused = true;
    refused += 1;
  } else {
    const out = await pipe(row.input, {
      max_new_tokens: MAX_NEW_TOKENS,
      num_beams: 1,
      do_sample: false,
    });
    const first = Array.isArray(out) ? out[0] : out;
    prediction = String(first?.generated_text ?? '').trim();
    if (!prediction) empty += 1;
  }

  const ms = Date.now() - t;
  if (!wasRefused) latencies[row.direction]?.push(ms);

  appendFileSync(
    outPath,
    JSON.stringify({
      source: row.input,
      prediction,
      direction: row.direction,
      domain: row.provenance?.domain ?? '',
      group: row.sampleGroup ?? '',
      inputTokens,
      ms,
      ...(wasRefused ? { refused: true } : {}),
    }) + '\n',
  );

  if ((i + 1) % 25 === 0 || i + 1 === pending.length) {
    const elapsed = (Date.now() - started) / 1000;
    const rate = (i + 1) / elapsed;
    const eta = Math.round((pending.length - i - 1) / rate);
    process.stdout.write(
      `\r  ${i + 1}/${pending.length}  ${rate.toFixed(2)} rows/s  eta ${Math.floor(eta / 60)}m${String(eta % 60).padStart(2, '0')}s   `,
    );
  }
}
process.stdout.write('\n');

console.log(`\ndone  ${pending.length} rows in ${Math.round((Date.now() - started) / 1000)} s`);
if (refused) console.log(`      ${refused} refused (input over ${MAX_INPUT_TOKENS} tokens)`);
if (empty) console.log(`      ${empty} empty generations`);

// ------------------------------------------------------------------ latency

// Single-process runs can report their own latency; sharded runs cannot see the
// other three quarters of the rows, so they leave it to --merge.
if (!args.shard) {
  writeLatency(readJsonl(outPath), { shards: 1 });
} else {
  console.log('sharded run — latency is written by --merge');
}
