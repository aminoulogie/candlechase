import { useEffect, useState } from 'react';
import type { Drill } from './engine/codec';
import { loadLibrary } from './data/load';
import type { Library } from './data/load';
import { pickDrills } from './game/pick';
import { getState, update } from './game/store';
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
import { Lab } from './ui/screens/Lab';
import { Me } from './ui/screens/Me';
import { Odds } from './ui/screens/Odds';

type Tab = 'train' | 'rules' | 'odds' | 'lab' | 'me' | 'log';

const ROUND: Record<StartOpts['mode'], number> = { spot: 15, replay: 6, checklist: 8, place: 8, quiz: 10 };

interface Session extends StartOpts {
  drills: Drill[];
}

const TABS: { id: Tab; label: string; icon: JSX.Element }[] = [
  { id: 'train', label: 'Train', icon: <path d="M4 18l5-6 4 3 7-9" /> },
  { id: 'rules', label: 'Rules', icon: <path d="M6 4h12v16H6zM9 9h6M9 13h6M9 17h3" /> },
  { id: 'odds', label: 'Odds', icon: <path d="M5 20V10M12 20V4M19 20v-7" /> },
  { id: 'lab', label: 'Lab', icon: <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" /> },
  { id: 'me', label: 'Me', icon: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" /> },
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
        {tab === 'odds' && (
          <Odds
            lib={lib}
            onTryInLab={(p) => {
              update(() => ({ labPreset: p }));
              setTab('lab');
            }}
          />
        )}
        {tab === 'lab' && <Lab lib={lib} />}
        {tab === 'me' && <Me onOpenLog={() => setTab('log')} />}
        {tab === 'log' && <Log onBack={() => setTab('me')} />}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id || (tab === 'log' && t.id === 'me') ? 'tab on' : 'tab'} onClick={() => setTab(t.id)}>
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
