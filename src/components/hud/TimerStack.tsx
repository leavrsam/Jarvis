// Countdown tiles for Jarvis's timers (SET_TIMER / CANCEL_TIMER). A ringing timer turns into an
// alert: "<label> is done" with a Dismiss button (tapping anywhere on it also dismisses).
import React, { useEffect, useState } from 'react';
import { BellRing, Timer, X } from 'lucide-react';
import { dismissTimer, formatRemaining, HudTimer, subscribeTimers } from '../../services/timers';

export const TimerStack: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [timers, setTimers] = useState<HudTimer[]>([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => subscribeTimers(setTimers), []);
  useEffect(() => {
    if (!timers.length) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [timers.length]);

  if (!timers.length) return null;
  // Ringing first, then soonest to finish
  const sorted = [...timers].sort((a, b) => (a.firedAt !== undefined) === (b.firedAt !== undefined) ? a.endsAt - b.endsAt : a.firedAt !== undefined ? -1 : 1);

  return (
    <div className={`pointer-events-none flex flex-wrap justify-center gap-3 ${className}`} aria-live="polite">
      {sorted.map((t) => {
        const ringing = t.firedAt !== undefined || t.endsAt <= now;
        const left = t.endsAt - now;
        const fraction = Math.min(1, Math.max(0, left / t.durationMs));
        const name = t.label.toLowerCase() === 'timer' ? 'Timer' : t.label.charAt(0).toUpperCase() + t.label.slice(1);
        if (ringing) {
          return (
            <button
              key={t.id}
              onClick={() => dismissTimer(t.id)}
              className="pointer-events-auto hud-panel !border-amber-300/80 px-5 py-3 min-w-[220px] text-left animate-pulse shadow-[0_0_40px_rgba(251,191,36,0.45)]"
              title="Dismiss"
            >
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-amber-300">
                <BellRing className="w-4 h-4" /> Time's up
              </div>
              <div className="mt-1 text-[22px] font-semibold text-amber-50 leading-tight">{name} is done</div>
              <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500 text-black text-[12px] font-bold">
                Dismiss
              </div>
            </button>
          );
        }
        return (
          <div key={t.id} className="pointer-events-auto hud-panel px-4 py-2.5 min-w-[150px]">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-amber-400 truncate max-w-[160px]">
                <Timer className="w-3.5 h-3.5 shrink-0" />
                {name}
              </span>
              <button onClick={() => dismissTimer(t.id)} className="p-0.5 text-amber-600 hover:text-amber-200" title={`Cancel ${name}`} aria-label={`Cancel ${name} timer`}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="font-orbitron text-[28px] leading-tight text-amber-100 tabular-nums">{formatRemaining(left)}</div>
            <div className="mt-1 h-[3px] rounded-full bg-amber-950/80 overflow-hidden">
              <div className="h-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" style={{ width: `${fraction * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};
