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
import Dictionary from './ui/screens/Dictionary';
import Feedback from './ui/screens/Feedback';
import Translator from './ui/screens/Translator';

export default function App() {
  const [screen, setScreen] = useState<Screen>('translator');
  // Seeds the Dictionary's search box when a gloss is clicked on the Breakdown.
  // A field of App state rather than a route param: DD-16 keeps this app on a
  // single-state screen switch, and one string is cheaper than a router.
  const [lookup, setLookup] = useState('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { dark, toggle } = useDarkMode();

  // Navigating by hand clears any pending lookup, so the Dictionary opens on its
  // empty state rather than re-running a search the user has moved on from.
  function navigate(next: Screen) {
    setLookup('');
    setScreen(next);
  }

  function openDictionary(latin: string) {
    setLookup(latin);
    setScreen('dictionary');
  }

  useEffect(() => {
    // Honorifics only drive register detection. A failure there must not blank
    // the whole app, so only the dictionary is treated as required.
    loadDictionary()
      .then(() => loadHonorifics().catch(() => undefined))
      .then(() => setReady(true))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex text-slate-900 dark:text-slate-100">
      <Sidebar active={screen} onNavigate={navigate} dark={dark} onToggleDark={toggle} />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileNav active={screen} onNavigate={navigate} dark={dark} onToggleDark={toggle} />
        <TopBar active={screen} />
        <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-6xl w-full mx-auto">
          {!ready && !error && <p className="text-sm text-slate-500">Loading dictionary…</p>}
          {error && <p className="text-sm text-red-600">Failed to load data: {error}</p>}
          {ready && screen === 'translator' && <Translator onOpenBreakdown={() => navigate('breakdown')} />}
          {ready && screen === 'breakdown' && <Breakdown onLookup={openDictionary} />}
          {/* Inside the `ready` gate: the index is empty until loadDictionary()
              resolves, and R-6.9 requires a dictionary failure to withhold the
              data screens rather than render "0 entries indexed". */}
          {ready && screen === 'dictionary' && <Dictionary initialQuery={lookup} />}
          {ready && screen === 'chat' && <Chat />}
          {ready && screen === 'feedback' && <Feedback />}
          {ready && screen === 'benchmarks' && <Benchmarks />}
          {screen === 'about' && <About />}
        </main>
      </div>
    </div>
  );
}
