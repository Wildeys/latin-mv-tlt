import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  test: {
    /**
     * Node is the default on purpose (NFR-6): the core suite must be able to run
     * with no DOM, and a jsdom default would hide an accidental `window` or
     * `document` reference inside `src/core/**`.
     *
     * The component suites opt in per file with a `// @vitest-environment jsdom`
     * docblock on line 1. They still touch no model and no network — the
     * runner's MODE==='test' short-circuit returns before ONNX Runtime is
     * imported, so the Translator tests exercise the real pipeline in its
     * not-loaded state, which is exactly the state they are there to assert.
     */
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
