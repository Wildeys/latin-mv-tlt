import { BarChart3, Info, Languages, MessageSquare, Moon, SplitSquareVertical, Star, Sun } from 'lucide-react';
import type { Screen } from '../screens';

type Props = {
  active: Screen;
  onNavigate: (s: Screen) => void;
  dark: boolean;
  onToggleDark: () => void;
};

const items: { id: Screen; icon: typeof Languages }[] = [
  { id: 'translator', icon: Languages },
  { id: 'breakdown', icon: SplitSquareVertical },
  { id: 'chat', icon: MessageSquare },
  { id: 'feedback', icon: Star },
  { id: 'benchmarks', icon: BarChart3 },
  { id: 'about', icon: Info },
];

export default function MobileNav({ active, onNavigate, dark, onToggleDark }: Props) {
  return (
    <div className="md:hidden flex items-center justify-between px-3 py-2 bg-slate-900 text-white">
      <span className="text-sm font-semibold">latin-mv-tlt</span>
      <div className="flex items-center gap-1">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <button
              key={it.id}
              onClick={() => onNavigate(it.id)}
              className={`p-2 rounded-md ${active === it.id ? 'bg-brand-600' : 'text-slate-300'}`}
            >
              <Icon className="w-4 h-4" />
            </button>
          );
        })}
        <button onClick={onToggleDark} className="p-2 text-slate-300">
          {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
