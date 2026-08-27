import { createReadStream, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Directories under `public/` that hold prebuilt assets rather than SPA routes:
 * model weights and their JSON sidecars, the ONNX Runtime bundle, and the
 * dictionary data. Every URL under these is a file or it is nothing.
 */
const ASSET_ROOTS = ['models', 'ort', 'data']

/**
 * Make `vite dev` serve `public/{models,ort,data}/` the way a static host does:
 * bytes for files that exist, 404 for files that do not.
 *
 * Two dev-only defects live here, and they share a fix.
 *
 * 1. ONNX Runtime loads its WASM glue with a dynamic `import()` of
 *    `${wasmPaths}ort-wasm-simd-threaded.jsep.mjs`, and
 *    `src/core/translate/runner.ts` points wasmPaths at `${BASE_URL}ort/` so the
 *    runtime is served from our own origin rather than jsDelivr (§1.2, NFR-2,
 *    NFR-3). That request ends in `.mjs`, so Vite's transform middleware claims
 *    it, resolves it inside publicDir, and refuses:
 *
 *      Failed to load url /ort/ort-wasm-simd-threaded.jsep.mjs — this file is in
 *      /public and will be copied as-is during build without going through the
 *      plugin transforms, and therefore should not be imported from source code.
 *
 *    Vite is right about its own rule and wrong about this file: it is not
 *    source, it is a prebuilt asset that must reach the browser byte-for-byte.
 *
 * 2. Worse, and the reason this plugin grew past ORT: Vite's SPA fallback
 *    answers *any* unmatched dev URL with `index.html` and status **200**,
 *    including `/models/<id>/config.json`. transformers.js treats
 *    `status === 404` as the only signal that a local file is absent
 *    (`getModelFile` in @huggingface/transformers), so a 200 means "found" and
 *    the HTML is handed to `JSON.parse`:
 *
 *      Unexpected token '<', "<!doctype "... is not valid JSON
 *
 *    which surfaces in the UI as `Final translation: Unavailable`. The failure
 *    also persists: `getModelFile` caches any 200 into the `transformers-cache`
 *    Cache Storage, so one fetch made while a weight file was still missing
 *    poisons that URL for every later reload, even once the file is on disk.
 *
 * Both are dev-server artefacts. `npm run build` already gets this right —
 * public/ is copied verbatim and GitHub Pages 404s missing files — so this is
 * `apply: 'serve'` only and production behaviour is untouched.
 *
 * Registered directly in `configureServer` rather than in a returned callback,
 * because that is what puts it *ahead* of the transform and SPA-fallback
 * middlewares. That ordering is also why the base prefix is still on `req.url`
 * here: Vite's own baseMiddleware has not run yet.
 */
function servePublicAssets(): Plugin {
  const publicDir = fileURLToPath(new URL('./public/', import.meta.url))
  let base = '/'

  return {
    name: 'serve-public-assets',
    apply: 'serve',
    configResolved(config) {
      base = config.base
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let pathname: string
        try {
          pathname = decodeURIComponent((req.url ?? '').split('?')[0])
        } catch {
          return next() // Malformed percent-encoding; not ours to answer.
        }

        const rel = pathname.startsWith(base)
          ? pathname.slice(base.length)
          : pathname.replace(/^\/+/, '')
        const segments = rel.split('/')

        if (!ASSET_ROOTS.includes(segments[0])) return next()
        // No traversal out of public/, and no empty segments to confuse join().
        if (segments.some((s) => s === '..' || s === '.' || s === '')) return next()

        const file = join(publicDir, rel)
        if (!existsSync(file) || !statSync(file).isFile()) {
          // The point of the whole plugin: a real 404, not the SPA shell.
          res.statusCode = 404
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          return res.end(`404 Not Found: ${pathname}\n`)
        }

        // Only `.mjs` needs intercepting (defect 1). Everything else falls
        // through to Vite's static handler, which already sets the right
        // Content-Type and — for the ~70 MB of .onnx weights — honours Range.
        if (!rel.endsWith('.mjs')) return next()

        res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        createReadStream(file).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), servePublicAssets()],
  base: '/latin-mv-tlt/',
})
