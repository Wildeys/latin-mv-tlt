import { BarChart3, BookOpen, Info, Languages, MessageSquare, Moon, SplitSquareVertical, Star, Sun } from 'lucide-react';
import type { Screen } from '../screens';

type Props = {
  active: Screen;
  onNavigate: (s: Screen) => void;
  dark: boolean;
  onToggleDark: () => void;
};

const items: { id: Screen; label: string; icon: typeof Languages }[] = [
  { id: 'translator', label: 'Translator', icon: Languages },
  { id: 'breakdown', label: 'Breakdown', icon: SplitSquareVertical },
  { id: 'dictionary', label: 'Dictionary', icon: BookOpen },
  { id: 'chat', label: 'AI Chat', icon: MessageSquare },
  { id: 'feedback', label: 'Feedback', icon: Star },
  { id: 'benchmarks', label: 'Benchmarks', icon: BarChart3 },
  { id: 'about', label: 'About', icon: Info },
];

export default function Sidebar({ active, onNavigate, dark, onToggleDark }: Props) {
  return (
    <aside className="hidden md:flex w-64 flex-shrink-0 bg-slate-900 text-slate-100 flex-col h-screen sticky top-0">
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center">
            <Languages className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-tight">latin-mv-tlt</h1>
            <p className="text-[11px] text-slate-400 leading-tight">Dhivehi–English pipeline</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {items.map((it) => {
          const Icon = it.icon;
          const isActive = active === it.id;
          return (
            <button
              key={it.id}
              onClick={() => onNavigate(it.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {it.label}
            </button>
          );
        })}
      </nav>
      <div className="px-3 py-4 border-t border-slate-800">
        <button
          onClick={onToggleDark}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {dark ? 'Light mode' : 'Dark mode'}
        </button>
      </div>
    </aside>
  );
}
