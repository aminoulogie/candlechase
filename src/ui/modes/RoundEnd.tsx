import type { ReactNode } from 'react';

export function RoundEnd({ title, ok, total, xp, onExit, children }: { title: string; ok: number; total: number; xp: number; onExit: () => void; children?: ReactNode }) {
  const pct = total ? Math.round((ok / total) * 100) : 0;
  const line = pct >= 90 ? 'Sharp. Keep the streak going.' : pct >= 80 ? 'At mastery pace.' : pct >= 60 ? 'Getting there. The misses will come back for review.' : 'Rough round — that is what practice is for. Every miss is queued for review.';
  return (
    <div className="round-end">
      <div className="re-title">{title} done</div>
      <div className="re-score">
        <span className="big">{ok}</span>
        <span className="of">/ {total}</span>
      </div>
      <div className="re-pct">{pct}% · {xp >= 0 ? '+' : ''}{xp} XP</div>
      <p className="re-line">{line}</p>
      {children}
      <button className="btn primary wide" onClick={onExit}>Back to training</button>
    </div>
  );
}
