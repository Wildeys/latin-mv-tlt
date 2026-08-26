import { describe, expect, it } from 'vitest';
import { buildModelInput, DV_EN_PREFIX, EN_DV_PREFIX, PREFIXES, prefixFor } from './prefixes';
import { getConfiguredModel, getTranslationStatus, translateText } from './runner';

/**
 * R-2.5. These constants are shared between the browser pipeline and the Python
 * corpus builder (which reads them via `node tools/transliterate.mjs --prefixes`),
 * so a change here silently changes what the model was trained to expect. The
 * assertions are deliberately literal: they exist to make an accidental edit
 * fail loudly rather than degrade the model with no error anywhere.
 */
describe('task prefixes', () => {
  it('pins the exact literals, separator included', () => {
    expect(DV_EN_PREFIX).toBe('translate Dhivehi Latin to English: ');
    expect(EN_DV_PREFIX).toBe('translate English to Dhivehi Latin: ');
  });

  it('ends each prefix with the T5 separator', () => {
    // Two characters of drift between corpus and runtime is enough to hurt
    // quality, and it produces no error at any layer.
    for (const prefix of [DV_EN_PREFIX, EN_DV_PREFIX]) {
      expect(prefix.endsWith(': ')).toBe(true);
    }
  });

  it('distinguishes the two directions', () => {
    expect(prefixFor('dv-en')).not.toBe(prefixFor('en-dv'));
    expect(PREFIXES['dv-en']).toBe(DV_EN_PREFIX);
    expect(PREFIXES['en-dv']).toBe(EN_DV_PREFIX);
  });

  it('concatenates without inserting or trimming anything', () => {
    expect(buildModelInput('dv-en', 'aharen maleah dhaanan')).toBe(
      'translate Dhivehi Latin to English: aharen maleah dhaanan',
    );
  });
});

/**
 * NFR-6: tests touch no model and no network. The guarantee is the
 * `MODE === 'test'` short-circuit in the runner, which returns before the
 * dynamic `import('@huggingface/transformers')` — so ONNX Runtime is never even
 * loaded. That short-circuit was untested until now, which meant the property
 * the whole suite depends on rested on nothing.
 */
describe('translation runner under MODE=test', () => {
  it('reports not_loaded without loading anything', async () => {
    const result = await translateText('translate Dhivehi Latin to English: aharen');
    expect(result.status).toBe('not_loaded');
    expect(result.text).toBeNull();
    expect(result.modelId).toBe(getConfiguredModel());
  });

  it('leaves the module-level status untouched', async () => {
    await translateText('anything');
    // A 'loading' state here would mean the short-circuit ran too late and a
    // load had already been kicked off.
    expect(getTranslationStatus()).toBe('not_loaded');
  });
});
