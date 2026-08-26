import type { Screen } from '../screens';

const SUB: Record<Screen, string> = {
  translator: 'Main artefact — Dhivehi ↔ English through a Latin intermediate representation',
  breakdown: 'Viva view — source, Latin, glosses, model input and raw model output',
  chat: 'Demo — translator wraps an optional LLM',
  feedback: 'Native-speaker ratings stored on this device',
  benchmarks: 'Pipeline metrics only. Empty cells are not yet measured.',
  about: 'Research idea, architecture, and limits',
};

export default function TopBar({ active }: { active: Screen }) {
  return (
    <header className="hidden md:block px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/80 backdrop-blur">
      <p className="text-xs uppercase tracking-wide text-slate-500">{active}</p>
      <p className="text-sm text-slate-700 dark:text-slate-300 mt-0.5">{SUB[active]}</p>
    </header>
  );
}
