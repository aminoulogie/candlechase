import { useEffect, useState } from 'react';
import type { Drill } from './engine/codec';
import { loadLibrary } from './data/load';
import type { Library } from './data/load';
import { pickDrills } from './game/pick';
import { getState } from './game/store';
import { Loading } from './ui/common';
import { Checklist } from './ui/modes/Checklist';
import { Place } from './ui/modes/Place';
import { Quiz } from './ui/modes/Quiz';
import { Replay } from './ui/modes/Replay';
import { Spot } from './ui/modes/Spot';
import { Home } from './ui/screens/Home';
import type { StartOpts } from './ui/screens/Home';
import { Log } from './ui/screens/Log';
import { Rules } from './ui/screens/Rules';
import { Stats } from './ui/screens/Stats';

type Tab = 'train' | 'rules' | 'stats' | 'log';

const ROUND: Record<StartOpts['mode'], number> = { spot: 15, replay: 6, checklist: 8, place: 8, quiz: 10 };

interface Session extends StartOpts {
  drills: Drill[];
}

const TABS: { id: Tab; label: string; icon: JSX.Element }[] = [
  { id: 'train', label: 'Train', icon: <path d="M4 18l5-6 4 3 7-9" /> },
  { id: 'rules', label: 'Rules', icon: <path d="M6 4h12v16H6zM9 9h6M9 13h6M9 17h3" /> },
  { id: 'stats', label: 'Stats', icon: <path d="M5 20V10M12 20V4M19 20v-7" /> },
  { id: 'log', label: 'Live log', icon: <path d="M5 5h14v14H5zM8 10l3 3 5-5" /> },
];

export function App() {
  const [lib, setLib] = useState<Library | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('train');
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    loadLibrary().then(setLib, (e) => setError(String(e)));
  }, []);

  if (error)
    return (
      <div className="fatal">
        <b>Could not load the market data.</b>
        <span>{error}</span>
        <button className="btn primary" onClick={() => location.reload()}>Try again</button>
      </div>
    );
  if (!lib) return <Loading text="Loading 5 years of candles…" />;

  if (session) {
    const exit = () => setSession(null);
    const p = { drills: session.drills, onExit: exit };
    if (!session.drills.length)
      return (
        <div className="fatal">
          <b>No drills left for this mode right now.</b>
          <button className="btn primary" onClick={exit}>Back</button>
        </div>
      );
    switch (session.mode) {
      case 'spot':
        return <Spot {...p} title={session.review ? 'Review' : 'Spot it'} />;
      case 'quiz':
        return <Quiz {...p} />;
      case 'replay':
        return <Replay {...p} />;
      case 'checklist':
        return <Checklist {...p} />;
      case 'place':
        return <Place {...p} />;
    }
  }

  const start = (o: StartOpts) => setSession({ ...o, drills: pickDrills(lib, getState(), o.mode, ROUND[o.mode], o.review) });

  return (
    <div className="app">
      <main className="main">
        {tab === 'train' && <Home lib={lib} onStart={start} />}
        {tab === 'rules' && <Rules />}
        {tab === 'stats' && <Stats lib={lib} />}
        {tab === 'log' && <Log />}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'tab on' : 'tab'} onClick={() => setTab(t.id)}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {t.icon}
            </svg>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
