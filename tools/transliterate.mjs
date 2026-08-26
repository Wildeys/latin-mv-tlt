/**
 * Node CLI over the project's *own* transliterator (R-2.2).
 *
 * R-2.2 requires that the training corpus be normalised by the same code that
 * normalises input at inference time — "not a third-party romanizer, so training
 * and inference Latin are byte-identical in convention". The corpus builder is
 * Python and the transliterator is TypeScript, so something has to bridge them.
 *
 * A Python reimplementation would satisfy the letter of R-2.2 and break its
 * intent: two implementations drift, and the drift is silent — it shows up as
 * degraded BLEU months later, not as an error. So this file bundles the real
 * `src/core/transliterator/` in memory and calls it. There is no generated file
 * to go stale, and no second copy of the rules to keep in sync.
 *
 * `node --experimental-strip-types` will not work here: the modules use
 * extensionless specifiers (`from './mappings'`) which Node's ESM resolver
 * rejects. esbuild resolves them.
 *
 * Modes
 *   (default)      NDJSON server on stdin/stdout — see PROTOCOL below
 *   --prefixes     print the canonical T5 task prefixes as JSON (R-2.5)
 *   --variants     print the many-to-one Thaana fold used by R-1.8's metric
 *   --selftest     fixed vectors + the SHA-256 of the bundled source
 *   --th2la TEXT   one-shot Thaana → Latin
 *   --la2th TEXT   one-shot Latin → Thaana
 *
 * PROTOCOL (default mode). One JSON object per line in, one per line out, in
 * the order received. A long-lived process, not one spawn per row: the corpus is
 * ~92k pairs and process startup would dominate the build.
 *
 *   in   {"id": 1, "mode": "th2la", "text": "އަހަރެން"}
 *   out  {"id": 1, "latin": "aharen"}
 *
 *   in   {"id": 2, "mode": "la2th", "text": "aharen"}
 *   out  {"id": 2, "thaana": "…", "preserved": []}
 *
 * On a per-row failure the line carries {"id": N, "error": "..."} rather than
 * killing the stream — the caller decides whether to quarantine (R-2.8) or abort.
 */

import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Bundle a TS entrypoint in memory and import it. Returns [module, sourceHash]. */
async function loadBundled(entry) {
  const esbuild = await import('esbuild');
  const result = await esbuild.build({
    entryPoints: [join(root, entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    write: false,
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  const hash = createHash('sha256').update(code).digest('hex');
  const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  return [mod, hash];
}

const [translit, translitHash] = await loadBundled('src/core/transliterator/index.ts');

const args = process.argv.slice(2);
const flag = args[0];

// ---------------------------------------------------------------- --prefixes

if (flag === '--prefixes') {
  const [prefixes] = await loadBundled('src/core/translate/prefixes.ts');
  // Emitted for tools/build_translation_pairs.py so the corpus and the app
  // cannot disagree on the prefix literal (R-2.5).
  process.stdout.write(JSON.stringify(prefixes.PREFIXES, null, 2) + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------- --variants

if (flag === '--variants') {
  // R-1.2 mandates exactly one romanization, which forces Thaana → Latin to be
  // many-to-one: the Arabic-derived letters share a Latin form with their native
  // counterparts (ޘ/ތ both read `th`, ޙ/ހ both read `h`, …). No inverse rule can
  // recover which was written, so a Thaana → Latin → Thaana round trip can never
  // be exact for a word containing one.
  //
  // R-1.8's metric therefore compares *normalised* Thaana. The fold below is
  // derived from THAANA_CONSONANTS rather than typed out, so it cannot fall out
  // of step with the mapping it describes. The first member of each group is the
  // canonical form (the mapping is insertion-ordered, and the native letters are
  // listed first).
  const groups = {};
  for (const [thaana, latin] of Object.entries(translit.THAANA_CONSONANTS)) {
    (groups[latin] ??= []).push(thaana);
  }
  const fold = {};
  const collisions = {};
  for (const [latin, members] of Object.entries(groups)) {
    if (members.length < 2) continue;
    collisions[latin] = members;
    const [canonical, ...rest] = members;
    for (const variant of rest) fold[variant] = canonical;
  }
  process.stdout.write(JSON.stringify({ fold, collisions }, null, 2) + '\n');
  process.exit(0);
}

// ---------------------------------------------------------------- --selftest

if (flag === '--selftest') {
  // Fixed vectors, not a substitute for src/core/transliterator/transliterator.test.ts.
  // The point is provenance: corpus_stats.json records this hash, so it is always
  // answerable which revision of the rules normalised a given corpus (R-2.7).
  const vectors = [
    ['އަހަރެން', 'aharen'],
    ['މާލެ', 'maale'],
  ];
  let ok = true;
  for (const [thaana, expected] of vectors) {
    const got = translit.transliterateThaana(thaana);
    const pass = got === expected;
    if (!pass) ok = false;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${thaana} → ${got}${pass ? '' : ` (expected ${expected})`}`);
  }
  console.log(`\ntransliterator sha256: ${translitHash}`);
  process.exit(ok ? 0 : 1);
}

// ---------------------------------------------------------------- one-shot

if (flag === '--th2la' || flag === '--la2th') {
  const text = args.slice(1).join(' ');
  if (flag === '--th2la') {
    process.stdout.write(translit.transliterateThaana(text) + '\n');
  } else {
    const { thaana, preserved } = translit.latinToThaanaDetailed(text);
    process.stdout.write(thaana + '\n');
    if (preserved.length) process.stderr.write(`preserved: ${preserved.join(' ')}\n`);
  }
  process.exit(0);
}

if (flag === '--hash') {
  process.stdout.write(translitHash + '\n');
  process.exit(0);
}

if (flag && flag !== '--server') {
  process.stderr.write(`unknown flag: ${flag}\n`);
  process.stderr.write('modes: --prefixes --variants --selftest --hash --th2la TEXT --la2th TEXT (default: NDJSON server)\n');
  process.exit(2);
}

// ---------------------------------------------------------------- NDJSON server

// Announce the hash before any row, so the caller can record provenance without
// a second process.
process.stdout.write(JSON.stringify({ ready: true, sha256: translitHash }) + '\n');

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of rl) {
  if (!line.trim()) continue;
  let req;
  try {
    req = JSON.parse(line);
  } catch (err) {
    process.stdout.write(JSON.stringify({ id: null, error: `bad json: ${err.message}` }) + '\n');
    continue;
  }
  try {
    if (req.mode === 'th2la') {
      process.stdout.write(
        JSON.stringify({ id: req.id, latin: translit.transliterateThaana(req.text ?? '') }) + '\n',
      );
    } else if (req.mode === 'la2th') {
      const { thaana, preserved } = translit.latinToThaanaDetailed(req.text ?? '');
      process.stdout.write(JSON.stringify({ id: req.id, thaana, preserved }) + '\n');
    } else {
      process.stdout.write(JSON.stringify({ id: req.id, error: `unknown mode: ${req.mode}` }) + '\n');
    }
  } catch (err) {
    process.stdout.write(JSON.stringify({ id: req.id, error: String(err?.message ?? err) }) + '\n');
  }
}
