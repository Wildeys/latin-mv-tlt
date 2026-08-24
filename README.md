# latin-mv-tlt

Browser-only **Dhivehi–English** translation through a Latin intermediate representation, semantic frames, and small sentence-realization models. The LLM is optional. Research notes: [`Context/PROJECT.md`](Context/PROJECT.md).

## Run locally

Need **Node.js 18+** (npm comes with it). If `npm` is missing, install from https://nodejs.org and reopen the terminal.

```powershell
cd C:\Users\Moham\Desktop\dhivehi\latin-mv-tlt
npm install
npm run dev
```

Open **http://localhost:5173/latin-mv-tlt/** — not the site root. `vite.config.ts` sets `base: '/latin-mv-tlt/'` for GitHub Pages, so the dev server serves the app under that path.

Translator and Breakdown work with the files already in `public/data/`. Fluent output stays **Unavailable** until you set `VITE_EN_REALIZE_MODEL` / `VITE_DV_REALIZE_MODEL` in a `.env` copied from [`.env.example`](.env.example). See [`Context/TRAINING.md`](Context/TRAINING.md).

## Other commands

```powershell
npm test
npm run build
npm run preview
```

`npm run preview` serves the production `dist/` build locally (same `/latin-mv-tlt/` path).

## Screens

Translator (main artefact) · Sentence Breakdown (viva) · AI Chat (demo) · Feedback · Benchmarks · About

## Deploy

`npm run build` writes static files to `dist/`. GitHub Pages hosts that folder; `base` is `/latin-mv-tlt/` (see `vite.config.ts`), which matches the project-pages URL.

## Optional data and training

You do **not** need to regenerate the dictionary or training pairs to start the UI. Those files are already in `public/data/` and `data/realize/`.

- Dictionary and frame pairs: [`Context/DATA.md`](Context/DATA.md)
- Colab T5 training: [`Context/TRAINING.md`](Context/TRAINING.md)
- Measured state: [`Context/STATUS.md`](Context/STATUS.md)
