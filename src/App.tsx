import { useEffect, useState } from 'react';
import { loadDictionary } from './core/dictionary/lookup';
import { loadHonorifics } from './core/morphology/honorifics';
import { useDarkMode } from './lib/theme';
import MobileNav from './ui/components/MobileNav';
import Sidebar from './ui/components/Sidebar';
import TopBar from './ui/components/TopBar';
import type { Screen } from './ui/screens';
import About from './ui/screens/About';
import Benchmarks from './ui/screens/Benchmarks';
import Breakdown from './ui/screens/Breakdown';
import Chat from './ui/screens/Chat';
import Feedback from './ui/screens/Feedback';
import Translator from './ui/screens/Translator';

export default function App() {
  const [screen, setScreen] = useState<Screen>('translator');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { dark, toggle } = useDarkMode();

  useEffect(() => {
    Promise.all([loadDictionary(), loadHonorifics()])
      .then(() => setReady(true))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex text-slate-900 dark:text-slate-100">
      <Sidebar active={screen} onNavigate={setScreen} dark={dark} onToggleDark={toggle} />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileNav active={screen} onNavigate={setScreen} dark={dark} onToggleDark={toggle} />
        <TopBar active={screen} />
        <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-6xl w-full mx-auto">
          {!ready && !error && <p className="text-sm text-slate-500">Loading dictionary…</p>}
          {error && <p className="text-sm text-red-600">Failed to load data: {error}</p>}
          {ready && screen === 'translator' && <Translator onOpenBreakdown={() => setScreen('breakdown')} />}
          {ready && screen === 'breakdown' && <Breakdown />}
          {ready && screen === 'chat' && <Chat />}
          {ready && screen === 'feedback' && <Feedback />}
          {ready && screen === 'benchmarks' && <Benchmarks />}
          {screen === 'about' && <About />}
        </main>
      </div>
    </div>
  );
}
