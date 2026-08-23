# latin-mv-tlt

Browser-only **Dhivehi–English** translation through a Latin intermediate representation, semantic frames, and small sentence-realization models. The LLM is optional.

Research notes live in [`Context/`](Context/PROJECT.md).

## Quick start

```powershell
cd latin-mv-tlt
python tools/export_dictionary.py
python tools/export_honorifics.py
python tools/build_frame_pairs.py
npm install
npm test
npm run dev
```

Open the local Vite URL. Translator and Breakdown work before any T5 is trained. Fluent output stays **Unavailable** until `VITE_EN_REALIZE_MODEL` / `VITE_DV_REALIZE_MODEL` point at exported Hugging Face models. See [`Context/TRAINING.md`](Context/TRAINING.md).

## Screens

Translator (main artefact) · Sentence Breakdown (viva) · AI Chat (demo) · Feedback · Benchmarks · About

## Deploy

`npm run build` writes static files to `dist/`. GitHub Pages can host that folder (`base` is `./`).
