// Settings: what Jarvis does while he works out a reply (a soft tone, or nothing but the reactor)
import React, { useState } from 'react';
import { Waves } from 'lucide-react';
import { audioEngine, ThinkingCue } from '../services/audioEngine';

export const ThinkingCueSetting: React.FC = () => {
  const [cue, setCue] = useState<ThinkingCue>(() => audioEngine.getThinkingCue());
  const [previewing, setPreviewing] = useState(false);

  const choose = (next: ThinkingCue) => {
    audioEngine.setThinkingCue(next);
    setCue(next);
  };
  const preview = () => {
    if (previewing) return;
    setPreviewing(true);
    audioEngine.ensureContext();
    audioEngine.startThinkingCue();
    setTimeout(() => {
      audioEngine.stopThinkingCue();
      setPreviewing(false);
    }, 3000);
  };

  const opt = (value: ThinkingCue, label: string) => (
    <button
      onClick={() => choose(value)}
      className={`flex-1 py-2.5 px-3 rounded-lg border text-xs font-orbitron transition-colors ${
        cue === value ? 'border-amber-400 bg-amber-500/20 text-amber-100' : 'border-amber-800/60 bg-black/60 text-amber-400 hover:bg-amber-950/40'
      }`}
      aria-pressed={cue === value}
    >
      {label}
    </button>
  );

  return (
    <div className="p-3.5 rounded-xl border border-amber-900/60 bg-black/70 space-y-2.5">
      <div className="flex items-center space-x-1.5 text-xs font-orbitron text-amber-300">
        <Waves className="w-3.5 h-3.5 text-amber-400" />
        <span>WHILE THINKING</span>
      </div>
      <p className="text-[11px] text-amber-500/90 font-sans">
        If a reply takes more than a moment, a soft pulsing tone plays and stops the instant Jarvis starts talking. The reactor glows amber either way.
      </p>
      <div className="flex gap-2">
        {opt('tone', 'SOFT TONE')}
        {opt('off', 'SILENT')}
      </div>
      {cue === 'tone' && (
        <button onClick={preview} disabled={previewing} className="text-[11px] text-amber-300 underline underline-offset-2 disabled:opacity-50 font-sans">
          {previewing ? 'Playing…' : 'Preview (3 s)'}
        </button>
      )}
    </div>
  );
};
