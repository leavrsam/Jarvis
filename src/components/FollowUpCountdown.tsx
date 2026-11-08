// Shown while Jarvis keeps listening after a reply (no wake word needed): a ring that empties as
// the window runs out, so everyone in the room can see whether he's still listening.
import React, { useEffect, useState } from 'react';

export const FollowUpCountdown: React.FC<{ endsAt: number; totalMs: number }> = ({ endsAt, totalMs }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [endsAt]);
  const left = Math.max(0, endsAt - now);
  if (left <= 0) return null;
  const fraction = left / totalMs;
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <div className="absolute z-30 left-1/2 -translate-x-1/2 bottom-[150px] sm:bottom-[160px] pointer-events-none animate-in fade-in duration-200">
      <div className="flex items-center gap-2.5 pl-1.5 pr-3.5 py-1.5 rounded-full border border-cyan-400/60 bg-black/75 backdrop-blur-md shadow-[0_0_24px_rgba(34,211,238,0.25)]">
        <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(34,211,238,0.2)" strokeWidth="3" />
          <circle
            cx="18"
            cy="18"
            r={r}
            fill="none"
            stroke="rgb(34,211,238)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - fraction)}
            transform="rotate(-90 18 18)"
          />
          <text x="18" y="22" textAnchor="middle" fontSize="11" fill="rgb(165,243,252)" fontFamily="monospace">
            {Math.ceil(left / 1000)}
          </text>
        </svg>
        <span className="font-orbitron text-[11px] tracking-[0.18em] text-cyan-200">STILL LISTENING · GO AHEAD</span>
      </div>
    </div>
  );
};
