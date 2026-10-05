import { useState } from 'react';
import { SYSTEMS } from '../../engine/systems';
import { SYSTEM_ORDER } from '../../engine/types';
import type { SystemId } from '../../engine/types';

export function Rules() {
  const [sys, setSys] = useState<SystemId>('ema');
  const def = SYSTEMS[sys];
  return (
    <div className="screen">
      <h1 className="screen-title">Rulebook</h1>
      <div className="seg">
        {SYSTEM_ORDER.map((s) => (
          <button key={s} className={s === sys ? 'seg-btn on' : 'seg-btn'} onClick={() => setSys(s)}>
            {SYSTEMS[s].name.replace(' Breakout', '').replace(' Divergence', ' Div')}
          </button>
        ))}
      </div>
      <section className="card">
        <div className="eyebrow">{def.family}</div>
        <div className={`focus-name sys-text-${sys}`}>{def.name}</div>
        <p className="focus-tag">{def.tagline}</p>
        <div className="legend">
          <span><i className="lg chart" /> Checked by the game</span>
          <span><i className="lg up" /> Upgrade</span>
          <span><i className="lg live" /> Live only</span>
        </div>
        <ol className="rulebook">
          {def.rules.map((r) => (
            <li key={r.id} className={`rb ${r.kind}${r.upgrade ? ' upgrade' : ''}`}>
              <div className="rule-title">
                {r.title}
                {r.upgrade ? <span className="mini">upgrade</span> : null}
                {r.kind === 'live' ? <span className="mini live">live only</span> : null}
              </div>
              <div className="rule-sub">{r.sub}</div>
              {r.precise ? <div className="precise">{r.precise}</div> : null}
            </li>
          ))}
        </ol>
        <p className="hint">
          {sys === 'ema'
            ? 'Rules 1–8 are your checklist, word for word. The three upgrades add a bigger-trend filter, trading hours, and where the stop goes.'
            : 'Drafted in the same style as your EMA checklist. Every drill uses exactly these numbers.'}
        </p>
      </section>
    </div>
  );
}
