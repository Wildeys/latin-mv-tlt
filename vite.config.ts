import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Serve `public/ort/*.mjs` verbatim during `vite dev`.
 *
 * ONNX Runtime loads its WASM glue with a dynamic `import()` of
 * `${wasmPaths}ort-wasm-simd-threaded.jsep.mjs` (see the `Oa`/`Qp` pair in
 * @huggingface/transformers' dist bundle), and `src/core/translate/runner.ts`
 * points wasmPaths at `${BASE_URL}ort/` so the runtime is served from our own
 * origin rather than jsDelivr (§1.2, NFR-2, NFR-3).
 *
 * In dev that request ends in `.mjs`, so Vite's transform middleware claims it,
 * resolves it inside publicDir, and refuses:
 *
 *     Failed to load url /ort/ort-wasm-simd-threaded.jsep.mjs — this file is in
 *     /public and will be copied as-is during build without going through the
 *     plugin transforms, and therefore should not be imported from source code.
 *
 * Vite is right about its own rule and wrong about this file: it is not source,
 * it is a prebuilt asset that must reach the browser byte-for-byte. `npm run
 * build` already gets this right — public/ is copied without transforms — so
 * this is `apply: 'serve'` only, and production behaviour is untouched.
 *
 * Registered directly in `configureServer` rather than in a returned callback,
 * because that is what puts it *ahead* of the transform middleware that errors.
 */
function serveOrtModules(): Plugin {
  const dir = fileURLToPath(new URL('./public/ort/', import.meta.url))
  return {
    name: 'serve-ort-modules',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Basename only, so this cannot be walked out of public/ort/.
        const name = (req.url ?? '').split('?')[0].match(/\/ort\/(ort-[\w.-]+\.mjs)$/)?.[1]
        if (!name) return next()
        const file = join(dir, name)
        if (!existsSync(file)) return next()
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        createReadStream(file).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), serveOrtModules()],
  base: '/latin-mv-tlt/',
})
