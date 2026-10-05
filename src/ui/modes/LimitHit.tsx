import { money } from '../../game/account';
import { todayPnl, useGame } from '../../game/store';

export function LimitHit({ onExit }: { onExit: () => void }) {
  const s = useGame();
  return (
    <div className="round-end">
      <div className="re-title">Daily loss limit hit</div>
      <div className="re-score">
        <span className="big down-text">{money(todayPnl(s))}</span>
      </div>
      <p className="re-line">
        Today’s losses reached {s.settings.dailyLossPct}% of the account. Same rule as live: no more trades until tomorrow. Spot it, Checklist and
        the Exam are still open — they don’t trade.
      </p>
      <button className="btn primary wide" onClick={onExit}>Back to training</button>
    </div>
  );
}
