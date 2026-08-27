import { BarChart3, BookOpen, Info, Languages, MessageSquare, Moon, SplitSquareVertical, Star, Sun } from 'lucide-react';
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
  { id: 'dictionary', icon: BookOpen },
  { id: 'chat', icon: MessageSquare },
  { id: 'feedback', icon: Star },
  { id: 'benchmarks', icon: BarChart3 },
  { id: 'about', icon: Info },
];

export default function MobileNav({ active, onNavigate, dark, onToggleDark }: Props) {
  return (
    <div className="md:hidden flex items-center justify-between px-3 py-2 bg-slate-900 text-white">
      <span className="text-sm font-semibold flex-shrink-0">latin-mv-tlt</span>
      {/* Seven screens plus the theme toggle is eight 32px buttons; with the
          brand label that overflows a 360px viewport. Scrolling the button strip
          degrades gracefully as screens are added, where truncating the label
          would not. `scroll-thin` is the existing class in index.css. */}
      <div className="flex items-center gap-1 min-w-0 overflow-x-auto scroll-thin">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <button
              key={it.id}
              onClick={() => onNavigate(it.id)}
              className={`p-2 rounded-md flex-shrink-0 ${active === it.id ? 'bg-brand-600' : 'text-slate-300'}`}
            >
              <Icon className="w-4 h-4" />
            </button>
          );
        })}
        <button onClick={onToggleDark} className="p-2 text-slate-300 flex-shrink-0">
          {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
